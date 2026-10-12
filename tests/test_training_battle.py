"""HTTP checks for empty scene preparation and isolated authoritative training."""
from concurrent.futures import ThreadPoolExecutor
import copy
import sqlite3
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_mobile_host as fixtures
import test_shared_battle as existing
import shared_battle


class TrainingBattleHTTP(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    sheet = existing.SharedBattleHTTP.sheet
    party = existing.SharedBattleHTTP.party
    command = existing.SharedBattleHTTP.command
    database = existing.SharedBattleHTTP.database

    def snapshot(self, training=False):
        with self.database() as db:
            tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            return {table: db.execute('SELECT * FROM ' + table + ' ORDER BY rowid').fetchall()
                    for table in tables if training or not table.startswith('training_')}

    def training_setup(self, kind='training-start', command_id='training-open', expected=None, **extras):
        view = self.gm_client.request(self.path)[1]
        body = dict(id=command_id, expectedVersion=(view['battle']['version'] if view['battle'] else 0)
                    if expected is None else expected, type=kind, **extras)
        result = self.gm_client.request(self.path, 'POST', body, csrf=self.gm_identity['csrf'])
        return result, body

    def enter_training(self):
        self.path += '/training'
        result, _ = self.training_setup()
        self.assertEqual(result[0], 200, result)
        if result[1]['battle']['phase'] == 'preparation':
            with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
                result, _ = self.command('start')
            self.assertEqual(result[0], 200, result)
        return result[1]

    def test_empty_get_and_zero_one_actor_preparation_are_readable_but_cannot_start(self):
        self.gm_client, self.gm_identity = self.gm()
        campaign = self.campaign(self.gm_client, self.gm_identity)
        self.path = f"/api/campaigns/{campaign['id']}/battle"
        untouched = self.snapshot(training=True)
        for _ in range(2):
            result = self.gm_client.request(self.path)
            self.assertEqual(result[0], 200, result)
            self.assertIsNone(result[1]['battle'])
        self.assertEqual(untouched, self.snapshot(training=True))
        tiles = [[{'type': 'floor'} for _ in range(8)] for _ in range(6)]
        tiles[0][0] = dict(type='wall')
        tiles[0][1] = dict(type='door', open=False)
        props = [dict(id='crate', type='crate', x=5, y=3, w=1, h=1, cover=True)]
        body = dict(id='empty-map', expectedVersion=0, type='prepare', name='Empty editable map',
                    width=8, height=6, tileMeters=2, actors=[], tiles=tiles, props=props)
        result = self.gm_client.request(self.path, 'POST', body, csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0], 200, result)
        state = result[1]['battle']['scene']
        self.assertEqual((state['actors'], state['tiles'], state['props']), ([], tiles, props))
        saved = self.snapshot(training=True)
        failed, _ = self.command('start')
        self.assertEqual(failed[0], 409, failed)
        self.assertEqual(saved, self.snapshot(training=True))
        cid = self.sheet(self.gm_client, self.gm_identity, 'Solo map marker')
        actor = dict(characterId=cid, version=1, x=2, y=2, team='crew', hidden=False, sprite=0,
                     weapon=None, armor={z: 0 for z in shared_battle.ZONES}, combatSense=0)
        body.update(id='one-actor-map', expectedVersion=1, actors=[actor])
        result = self.gm_client.request(self.path, 'POST', body, csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0], 200, result)
        saved = self.snapshot(training=True)
        failed, _ = self.command('start')
        self.assertEqual(failed[0], 409, failed)
        self.assertEqual(saved, self.snapshot(training=True))
        moved, _ = self.command('place', actorId='character-' + str(cid), x=3, y=4)
        self.assertEqual(moved[0], 200, moved)
        self.assertEqual(moved[1]['battle']['scene']['actors'][0]['x'], 3)
        self.assertEqual(moved[1]['battle']['scene']['tiles'], tiles)
        self.assertEqual(self.command('finish')[0][0], 200)
        body.update(id='edit-ended-map', expectedVersion=4, actors=[], name='Edited map')
        result = self.gm_client.request(self.path, 'POST', body, csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0], 200, result)
        self.assertEqual(result[1]['battle']['scene']['props'], props)

    def test_start_requires_fresh_sheets_and_prepare_keeps_parameter_validation(self):
        self.party(count=1, hidden=False)
        player, identity, cid = self.players[0]
        sheet = player.request(f'/api/characters/{cid}')[1]
        data = copy.deepcopy(sheet['data']); data['stats']['REF'] = 2
        result = player.request(f'/api/characters/{cid}', 'PUT',
                                dict(version=sheet['version'], data=data, reason='Changed before start'), csrf=identity['csrf'])
        self.assertEqual(result[0], 200, result)
        saved = self.snapshot(training=True)
        self.assertEqual(self.command('start')[0][0], 409)
        self.assertEqual(saved, self.snapshot(training=True))
        body = copy.deepcopy(self.prepare_body); body.update(id='bad-one-actor', expectedVersion=1)
        body['actors'] = [body['actors'][-1]]
        body['actors'][0]['weapon']['damageDice'] = 0
        self.assertEqual(self.gm_client.request(self.path, 'POST', body, csrf=self.gm_identity['csrf'])[0], 400)
        self.assertEqual(saved, self.snapshot(training=True))
        body.update(id='too-many-actors', actors=[body['actors'][0]] * 13)
        self.assertEqual(self.gm_client.request(self.path, 'POST', body, csrf=self.gm_identity['csrf'])[0], 400)
        self.assertEqual(saved, self.snapshot(training=True))

    def test_training_same_engine_shot_confirm_dedup_restart_reset_and_real_database_unchanged(self):
        with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            self.party(count=1, hidden=False)
            real_path = self.path
            real_view = self.gm_client.request(real_path)[1]
            self.path += '/training'
            untouched = self.snapshot()
            initial = self.gm_client.request(self.path)
            self.assertEqual(initial[0], 200, initial)
            self.assertTrue(initial[1]['training'])
            self.assertEqual(initial[1]['options']['characters'], [])
            self.assertEqual(initial[1]['options']['npcTemplates'], shared_battle.NPC_TEMPLATES)
            self.assertIsNone(initial[1]['battle'])
            with self.database() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM training_battles').fetchone()[0], 0)
            with patch.object(shared_battle, 'persist_combat_effects', side_effect=AssertionError('Real persistence called')):
                state, opening = self.training_setup()
                self.assertEqual(state[0], 200, state)
                scene = state[1]['battle']['scene']
                self.assertEqual(scene['phase'], 'preparation')
                self.assertEqual(len(scene['actors']), 4)
                self.assertTrue(state[1]['demoCompatible'])
                self.assertTrue(all(a['characterId'] < 0 for a in scene['actors']))
                started, _ = self.command('start')
                self.assertEqual(started[0], 200, started)
                scene = started[1]['battle']['scene']
                actor_id = scene['currentActorId']
                target_id = next(a['id'] for a in scene['actors'] if a['id'] != actor_id)
                command_fields = dict(actorId=actor_id, targetId=target_id, location='torso')
                expected_scene = copy.deepcopy(scene)
                expected_command = existing.canonical_action(dict(type='shoot', **command_fields, turnToTarget=False))
                expected_event = shared_battle.resolve_fire_action(expected_scene, dict(expected_command, id='expected'), lambda: .5)
                expected_event.pop('_visualEvents'); expected_event['from'] = expected_event.pop('from_')
                declared, declaration = self.command('declare-shot', **command_fields)
                self.assertEqual(declared[0], 200, declared)
                self.assertEqual(declared[1]['battle']['scene']['actors'], scene['actors'])
                confirmed, confirmation = self.command('confirm', declarationId=declaration['id'])
                self.assertEqual(confirmed[0], 200, confirmed)
                actual_event = confirmed[1]['receipt']['event']
                self.assertEqual({k: v for k, v in actual_event.items() if k not in ['id', 'round']}, expected_event)
                self.assertEqual(confirmed[1]['battle']['scene']['actors'], expected_scene['actors'])
                self.assertEqual(self.snapshot(), untouched)
                self.assertEqual(self.gm_client.request(real_path)[1], real_view)
                saved = self.snapshot(training=True)
                duplicate = self.gm_client.request(self.path + '/commands', 'POST', confirmation, csrf=self.gm_identity['csrf'])
                self.assertEqual(duplicate[0], 200, duplicate)
                self.assertTrue(duplicate[1]['duplicate'])
                self.assertEqual(duplicate[1]['receipt'], confirmed[1]['receipt'])
                self.assertEqual(self.snapshot(training=True), saved)
                self.assertEqual(self.command('confirm', declarationId=declaration['id'])[0][0], 409)
                self.assertEqual(self.snapshot(training=True), saved)
                visible = self.gm_client.request(self.path)[1]
                fixtures.mobile_host.stop(); self.start(username='', password='')
                self.assertEqual(self.gm_client.request(self.path)[1], visible)
                duplicate = self.gm_client.request(self.path + '/commands', 'POST', confirmation, csrf=self.gm_identity['csrf'])
                self.assertTrue(duplicate[1]['duplicate'])
                self.assertEqual(self.snapshot(training=True), saved)
                reopened, _ = self.training_setup(command_id='reopen-training')
                self.assertEqual(reopened[0], 200, reopened)
                self.assertEqual(reopened[1]['battle'], visible['battle'])
                self.assertEqual(self.command('finish')[0][0], 200)
                ended = self.gm_client.request(self.path)[1]['battle']
                reopened, _ = self.training_setup(command_id='reopen-ended')
                self.assertEqual(reopened[1]['battle'], ended)
                reset, reset_body = self.training_setup('training-reset', 'reset-training')
                self.assertEqual(reset[0], 200, reset)
                self.assertNotEqual(reset[1]['battle']['id'], ended['id'])
                self.assertEqual(reset[1]['battle']['version'], ended['version'] + 1)
                self.assertEqual(reset[1]['battle']['phase'], 'preparation')
                for actor in reset[1]['battle']['scene']['actors']:
                    self.assertEqual((actor['wounds'], actor['weapon']['ammo'], actor['shots']), (0, 8 if actor['team'] == 'crew' else 35, 0))
                saved_reset = self.snapshot(training=True)
                duplicate = self.gm_client.request(self.path, 'POST', reset_body, csrf=self.gm_identity['csrf'])
                self.assertTrue(duplicate[1]['duplicate'])
                self.assertEqual(self.snapshot(training=True), saved_reset)
                stale, _ = self.training_setup('training-reset', 'stale-reset', expected=ended['version'])
                self.assertEqual(stale[0], 409, stale)
                self.assertEqual(self.snapshot(training=True), saved_reset)
                self.assertEqual(self.snapshot(), untouched)
                self.assertEqual(self.gm_client.request(real_path)[1], real_view)
            with self.database() as db:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_training_auth_csrf_namespace_ownership_and_forged_fields(self):
        self.party(count=1, hidden=False)
        real_path = self.path
        player, identity, cid = self.players[0]
        outsider, outsider_identity = self.player('training-outsider')
        self.assertEqual(player.request('/api/mode', 'POST', {'mode': 'gm'}, csrf=identity['csrf'])[0], 200)
        self.assertEqual(outsider.request('/api/mode', 'POST', {'mode': 'gm'}, csrf=outsider_identity['csrf'])[0], 200)
        self.path += '/training'
        untouched = self.snapshot(training=True)
        for client, user in [(player, identity), (outsider, outsider_identity)]:
            self.assertEqual(client.request(self.path)[0], 403)
            result = client.request(self.path, 'POST', dict(id='forbidden', expectedVersion=0, type='training-start'), csrf=user['csrf'])
            self.assertEqual(result[0], 403, result)
        anon = fixtures.HTTPClient(self.port)
        self.assertEqual(anon.request(self.path)[0], 401)
        setup = dict(id='csrf-missing', expectedVersion=0, type='training-start')
        self.assertEqual(self.gm_client.request(self.path, 'POST', setup)[0], 403)
        self.assertEqual(self.snapshot(training=True), untouched)
        state, _ = self.training_setup()
        self.assertEqual(state[0], 200, state)
        untouched = self.snapshot(training=True)
        forged, _ = self.training_setup('training-reset', 'forged-role', role='gm')
        self.assertEqual(forged[0], 400, forged)
        real_body = dict(self.prepare_body, id='real-prepare-in-training', expectedVersion=state[1]['battle']['version'])
        self.assertEqual(self.gm_client.request(self.path, 'POST', real_body, csrf=self.gm_identity['csrf'])[0], 400)
        self.assertEqual(self.gm_client.request(real_path, 'POST', dict(id='training-in-real', expectedVersion=1, type='training-reset'), csrf=self.gm_identity['csrf'])[0], 400)
        battle = state[1]['battle']; actor = 'ray'
        target = next(a['id'] for a in battle['scene']['actors'] if a['id'] != actor)
        forged_shot, _ = self.command('declare-shot', actorId=actor, targetId=target, location='torso', roll=10, damage=999)
        self.assertEqual(forged_shot[0], 400, forged_shot)
        real_actor = 'character-' + str(cid)
        self.assertEqual(self.command('declare-shot', actorId=real_actor, targetId=actor, location='torso')[0][0], 404)
        for client, user in [(player, identity), (outsider, outsider_identity)]:
            body = dict(id='forbidden-confirm', battleId=battle['id'], expectedVersion=battle['version'], type='confirm', declarationId='none')
            self.assertEqual(client.request(self.path + '/commands', 'POST', body, csrf=user['csrf'])[0], 403)
        self.assertEqual(self.snapshot(training=True), untouched)

    def test_training_pending_reset_reject_and_turn_guards(self):
        with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            self.party(count=1, hidden=False)
            untouched = self.snapshot()
            state = self.enter_training()['battle']
            actor = state['scene']['currentActorId']
            target = next(a['id'] for a in state['scene']['actors'] if a['id'] != actor)
            declared, declaration = self.command('declare-shot', actorId=actor, targetId=target, location='torso')
            self.assertEqual(declared[0], 200, declared)
            self.assertEqual(self.command('end', actorId=actor)[0][0], 409)
            self.assertEqual(self.command('finish')[0][0], 409)
            self.assertEqual(self.command('reject', declarationId=declaration['id'])[0][0], 200)
            self.assertEqual(self.command('end', actorId=actor)[0][0], 200)
            self.assertEqual(self.command('declare-shot', actorId=actor, targetId=target, location='torso')[0][0], 409)
            next_actor = self.gm_client.request(self.path)[1]['battle']['scene']['currentActorId']
            declared, declaration = self.command('declare', action=dict(type='end', actorId=next_actor))
            self.assertEqual(declared[0], 200, declared)
            old_battle = declared[1]['battle']
            reset, _ = self.training_setup('training-reset', 'reset-pending')
            self.assertEqual(reset[0], 200, reset)
            self.assertEqual(reset[1]['battle']['pending'], [])
            self.assertEqual(self.command('confirm', declarationId=declaration['id'])[0][0], 409)
            old_command = dict(id='old-scene-shot', battleId=old_battle['id'], expectedVersion=reset[1]['battle']['version'],
                               type='declare', action=existing.canonical_action(dict(type='shoot', actorId=actor, targetId=target, location='torso')))
            self.assertEqual(self.gm_client.request(self.path + '/commands', 'POST', old_command, csrf=self.gm_identity['csrf'])[0], 409)
            self.assertEqual(self.snapshot(), untouched)

    def test_training_parallel_confirm_and_failure_roll_back_in_isolation(self):
        with patch.object(shared_battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .5)):
            self.party(count=1, hidden=False)
            untouched = self.snapshot()
            state = self.enter_training()['battle']
            actor = state['scene']['currentActorId']
            target = next(a['id'] for a in state['scene']['actors'] if a['id'] != actor)
            declared, declaration = self.command('declare-shot', actorId=actor, targetId=target, location='torso')
            state = declared[1]['battle']
            body = dict(id='training-failing-confirm', battleId=state['id'], expectedVersion=state['version'],
                        type='confirm', declarationId=declaration['id'], gmFire=dict(turnToTarget=False, rulings=existing.TEST_FIRING_RULINGS))
            saved = self.snapshot(training=True)
            original = shared_battle.resolve_fire_action
            def fail_after_shot(*args):
                original(*args)
                raise sqlite3.OperationalError('Injected training failure')
            with patch.object(shared_battle, 'resolve_fire_action', side_effect=fail_after_shot):
                self.assertEqual(self.gm_client.request(self.path + '/commands', 'POST', body, csrf=self.gm_identity['csrf'])[0], 503)
            self.assertEqual(self.snapshot(training=True), saved)
            barrier = threading.Barrier(2)
            def approve(index):
                client = fixtures.HTTPClient(self.port); client.cookie = self.gm_client.cookie
                command = dict(body, id='parallel-training-' + str(index))
                barrier.wait(5)
                return client.request(self.path + '/commands', 'POST', command, csrf=self.gm_identity['csrf'])
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(approve, range(2)))
            self.assertEqual(sorted(r[0] for r in results), [200, 409])
            after = self.gm_client.request(self.path)[1]['battle']
            self.assertEqual(after['version'], state['version'] + 1)
            shooter = next(a for a in after['scene']['actors'] if a['id'] == actor)
            self.assertEqual(shooter['weapon']['ammo'], 7)
            self.assertEqual(self.snapshot(), untouched)


if __name__ == '__main__':
    unittest.main()
