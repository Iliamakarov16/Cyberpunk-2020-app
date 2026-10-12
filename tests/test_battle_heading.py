"""Bounded authoritative facing, explicit per-shot rulings and private HTTP views."""
import copy
import json
import unittest
from unittest.mock import patch

import test_battle_vision as geometry
import test_private_battle_vision_http as private
import test_shared_battle_parity as parity
import battle_vision as vision
import shared_battle as battle


class HeadingGeometry(unittest.TestCase):
    def test_all_eight_forward_half_planes_and_shoulders(self):
        state = geometry.scene(9, 9)
        for heading, (dx, dy) in vision.HEADING_VECTORS.items():
            observer = dict(x=4, y=4, heading=heading)
            expected = frozenset((x, y) for x in range(9) for y in range(9)
                                 if (x - 4) * dx + (y - 4) * dy >= 0)
            self.assertEqual(vision.actor_visible_cells(state, observer), expected)
            self.assertIn((4, 4), expected)
            self.assertIn((4 + dy, 4 - dx), expected)
            self.assertNotIn((4 - dx, 4 - dy), expected)

    def test_rotations_cache_geometry_and_do_not_mutate_or_add_range(self):
        state = geometry.scene(60, 60, walls=[(40, 30)])
        observer = dict(x=30, y=30, heading=0, visionRange=1)
        before = copy.deepcopy(state)
        vision._visible_cells.cache_clear()
        with patch.object(vision, '_clear_line', wraps=vision._clear_line) as rays:
            east = vision.actor_visible_cells(state, observer)
            self.assertIn((40, 30), east); self.assertNotIn((41, 30), east)
            self.assertIn((30, 59), east)
            for value in vision.HEADING_VECTORS:
                observer['heading'] = value
                vision.actor_visible_cells(state, observer)
            self.assertEqual(rays.call_count, 3600)
        self.assertEqual(state, before)

    def test_legacy_inference_strict_explicit_heading_and_unoriented_camera(self):
        state = geometry.scene(7, 7)
        for facing, heading in [(-1, 180), (1, 0)]:
            self.assertEqual(vision.actor_visible_cells(state, dict(x=3, y=3, facing=facing)),
                             vision.actor_visible_cells(state, dict(x=3, y=3, heading=heading)))
        for value in (True, False, None, '90', 90.0, -45, 360, [], {}, 1):
            self.assertEqual(vision.actor_visible_cells(state, dict(x=3, y=3, heading=value)), frozenset())
        camera = dict(x=3, y=3, type='camera')
        self.assertEqual(len(vision.visible_cells(state, camera)), 49)
        self.assertLess(len(vision.actor_visible_cells(state, camera)), 49)

    def test_movement_uses_final_segment_and_turn_and_shot_do_not_add_cost(self):
        state = parity.scene()
        actor = state['actors'][0]
        actor.update(x=1, y=1, heading=180)
        # A low cover prop forces a final northward approach to an eastern goal.
        state['props'] = [dict(id='block', type='counter', x=2, y=1, w=3, h=1, cover=True)]
        cmd = dict(type='move', actorId='a', x=5, y=1)
        route = battle.preview_action(state, cmd)['path']
        battle.apply_action(state, cmd, lambda: .5)
        self.assertEqual(actor['heading'], battle.heading_towards(route[-2], route[-1]))
        before = copy.deepcopy(actor)
        battle.apply_action(state, dict(type='face', actorId='a', heading=270), lambda: .5)
        self.assertEqual(actor['heading'], 270)
        self.assertEqual({k:v for k,v in actor.items() if k not in ('heading', 'facing')},
                         {k:v for k,v in before.items() if k not in ('heading', 'facing')})
        state['actors'][1].update(x=5, y=5)
        battle.resolve_shot(state, dict(type='shoot', actorId='a', targetId='b', turnToTarget=False), lambda: 0)
        self.assertEqual(actor['heading'], 90)
        self.assertEqual(actor['actions'], before['actions'] + 1)
        self.assertEqual(actor['weapon']['ammo'], before['weapon']['ammo'] - 1)

    def test_explicit_attack_modifier_changes_only_base_and_result_not_rng(self):
        original = parity.scene()
        cmd = dict(type='shoot', actorId='a', targetId='b', location='torso')
        previews = [battle.preview_action(original, dict(cmd, turnToTarget=value)) for value in (False, True)]
        self.assertEqual(previews[1]['base'], previews[0]['base'] - 2)
        self.assertEqual([p['turnPenalty'] for p in previews], [0, -2])
        self.assertTrue(all(not p['requiresGmFacingDecision'] for p in previews))
        self.assertTrue(battle.preview_action(original, cmd)['requiresGmFacingDecision'])
        results = []
        for value in (False, True):
            state = copy.deepcopy(original)
            calls = []
            def rng():
                calls.append(0)
                return 0  # Both critical misses: compare equal resource/dice effects.
            event = battle.resolve_shot(state, dict(cmd, turnToTarget=value), rng)
            results.append((state, event, calls))
        self.assertEqual(results[0][0], results[1][0])
        self.assertEqual(results[0][2], results[1][2])
        self.assertEqual(results[1][1]['total'], results[0][1]['total'] - 2)


class HeadingHTTP(unittest.TestCase):
    for _name in ('setUp', 'start', 'gm', 'player', 'campaign', 'sheet', 'party', 'command', 'database',
                  'url', 'get', 'preview_as', 'declare_as', 'intent', 'store_scene', 'raw_scene',
                  'reprepare', 'accept', 'roster', 'setup_rooms', 'start_combat'):
        locals()[_name] = getattr(private.PrivateBattleVisionHTTP, _name)
    del _name

    def setup_facing(self):
        self.setup_rooms()
        setup = copy.deepcopy(self.vision_setup)
        setup['tiles'] = [[dict(type='floor', zone='REAR PRIVATE' if x < 5 else 'FRONT')
                           for x in range(16)] for _ in range(8)]
        setup['props'] = [dict(id='rear-prop', type='crate', x=1, y=5, w=1, h=1, cover=True, label='REAR PROP')]
        setup['devices'] = [dict(id='rear-port', name='REAR PORT', type='port', networkId='facing', x=1, y=4)]
        for actor, (x, y) in zip(setup['actors'], [(5, 3), (9, 3), (2, 3), (12, 6)]):
            actor.update(x=x, y=y, heading=0)
        self.reprepare(setup)
        self.start_combat()

    def resources(self):
        with self.database() as db:
            return {table: db.execute('SELECT * FROM ' + table).fetchall()
                    for table in ('characters', 'revisions')}

    def raw_command(self, kind, **fields):
        state = self.get(self.gm_client)['battle']
        body = dict(id='raw-' + kind + '-' + str(state['version']), type=kind,
                    battleId=state['id'], expectedVersion=state['version'], **fields)
        return self.gm_client.request(self.url('/commands'), 'POST', body, csrf=self.gm_identity['csrf']), body

    def test_face_preview_declare_confirm_replay_undo_no_resource_writes(self):
        self.setup_facing()
        before = self.get(); gm_before = self.get(self.gm_client)['battle']['scene']
        self.assertIn(self.other_aid, [a['id'] for a in before['battle']['scene']['actors']])
        self.assertNotIn(self.guard_aid, [a['id'] for a in before['battle']['scene']['actors']])
        self.assertNotIn('REAR PRIVATE', json.dumps(before)); self.assertNotIn('REAR PROP', json.dumps(before))
        self.assertEqual(before['battle']['scene']['vision']['heading'], 0)
        resources = self.resources(); raw_before = self.raw_scene()
        action = dict(type='face', actorId=self.aid, heading=180)
        preview = self.preview_as(action)
        self.assertEqual(preview[0], 200, preview)
        self.assertEqual(set(preview[1]['preview']), {'ok', 'type', 'text', 'fromHeading', 'heading', 'rulingNote'})
        self.assertEqual(self.raw_scene(), raw_before)
        self.assertNotIn('REAR PRIVATE', json.dumps(preview)); self.assertNotIn(self.guard_aid, json.dumps(preview))
        declared, declaration = self.declare_as(action)
        self.assertEqual(declared[0], 200, declared)
        self.assertEqual(declared[1]['battle']['scene']['vision']['cells'], before['battle']['scene']['vision']['cells'])
        confirmed, confirm = self.command('confirm', declarationId=declaration['id'])
        self.assertEqual(confirmed[0], 200, confirmed)
        after = self.get()['battle']['scene']
        self.assertEqual(after['vision']['actorId'], self.aid)
        self.assertEqual(after['vision']['heading'], 180)
        self.assertIn(self.guard_aid, [a['id'] for a in after['actors']])
        self.assertNotIn(self.other_aid, [a['id'] for a in after['actors']])
        own = next(a for a in after['actors'] if a['id'] == self.aid)
        self.assertEqual((own['actions'], own['shots'], own['moved'], own['facing']), (0, 0, False, -1))
        self.assertEqual(self.resources(), resources)
        gm_after = self.get(self.gm_client)['battle']['scene']
        for key in ('tiles', 'props', 'devices'):
            self.assertEqual(gm_before[key], gm_after[key])
        self.assertEqual(len(gm_after['actors']), len(gm_before['actors']))
        private.fixtures.mobile_host.stop(); self.start(username='', password='')
        self.assertEqual(self.get()['battle']['scene']['vision']['heading'], 180)
        stable = self.raw_scene()
        duplicate = self.gm_client.request(self.url('/commands'), 'POST', confirm, csrf=self.gm_identity['csrf'])
        self.assertTrue(duplicate[1]['duplicate']); self.assertEqual(self.raw_scene(), stable)
        self.assertEqual(self.command('undo')[0][0], 200)
        restored = self.get()['battle']['scene']
        self.assertEqual(restored['vision'], before['battle']['scene']['vision'])
        self.assertEqual(self.resources(), resources)
        self.assertEqual(self.raw_scene()['pending'], [])
        replay = self.players[0][0].request(self.url('/commands'), 'POST', declaration, csrf=self.players[0][1]['csrf'])
        self.assertTrue(replay[1]['duplicate']); self.assertEqual(replay[1]['battle']['pending'], [])

    def test_heading_validation_ownership_current_turn_and_legacy_reads(self):
        self.setup_facing()
        for value in (True, False, None, 1, 360, -45, 45.0, '45', [], {}):
            action = dict(type='face', actorId=self.aid, heading=value)
            self.assertEqual(self.preview_as(action)[0], 400)
            self.assertEqual(self.declare_as(action)[0][0], 400)
        self.assertEqual(self.preview_as(dict(type='face', actorId=self.other_aid, heading=90))[0], 403)
        self.assertEqual(self.declare_as(dict(type='face', actorId=self.other_aid, heading=90))[0][0], 403)
        wrong_turn = self.preview_as(dict(type='face', actorId=self.other_aid, heading=90), player=1)
        self.assertEqual(wrong_turn[0], 200); self.assertFalse(wrong_turn[1]['preview']['ok'])
        self.assertEqual(self.declare_as(dict(type='face', actorId=self.other_aid, heading=90), player=1)[0][0], 409)
        before = self.raw_scene()
        self.assertEqual(self.command('face', self.players[0][0], self.players[0][1], actorId=self.aid, heading=90)[0][0], 403)
        self.assertEqual(self.raw_scene(), before)
        def legacy(state):
            actor = battle.find_actor(state, self.aid)
            actor.pop('heading'); actor['facing'] = -1
        self.store_scene(legacy)
        raw = self.raw_scene()
        self.assertEqual(self.get()['battle']['scene']['vision']['heading'], 180)
        self.assertEqual(self.raw_scene(), raw, 'Reading old scenes must not write migrations')
        self.assertEqual(self.command('face', actorId=self.aid, heading=270)[0][0], 200)
        self.assertEqual(battle.find_actor(self.raw_scene(), self.aid)['heading'], 270)

    def test_shot_requires_gm_ruling_even_after_explicit_face(self):
        self.setup_facing()
        self.intent(dict(type='face', actorId=self.aid, heading=225))
        shoot = dict(type='shoot', actorId=self.aid, targetId=self.guard_aid, location='torso')
        self.assertEqual(self.preview_as(dict(shoot, turnToTarget=False))[0], 403)
        self.assertEqual(self.declare_as(dict(shoot, turnToTarget=True))[0][0], 403)
        declared, declaration = self.declare_as(shoot)
        self.assertEqual(declared[0], 200, declared)
        self.assertTrue(declared[1]['battle']['pending'][0]['preview']['requiresGmFireDecision'])
        before = self.raw_scene(); resources = self.resources()
        for value in ({}, dict(gmFire=dict(turnToTarget=None)), dict(gmFire=dict(turnToTarget=0)), dict(gmFire=dict(turnToTarget='false'))):
            result, _ = self.raw_command('confirm', declarationId=declaration['id'], **value)
            self.assertEqual(result[0], 400, result)
            self.assertEqual(self.raw_scene(), before); self.assertEqual(self.resources(), resources)
        state = self.get(self.gm_client)['battle']
        previews = []
        for value in (False, True):
            result = self.gm_client.request(self.url('/preview'), 'POST',
                dict(battleId=state['id'], expectedVersion=state['version'], command=private.tactical.existing.canonical_action(dict(shoot, turnToTarget=value))), csrf=self.gm_identity['csrf'])
            self.assertEqual(result[0], 200, result)
            previews.append(result[1]['preview'])
        self.assertEqual(previews[1]['targets'][0]['base'], previews[0]['targets'][0]['base'] - 2)
        self.assertEqual([p['turnPenalty'] for p in previews], [0, -2])
        confirmed, command = self.command('confirm', declarationId=declaration['id'], turnToTarget=True)
        self.assertEqual(confirmed[0], 200, confirmed)
        self.assertTrue(confirmed[1]['receipt']['turnToTarget'])
        self.assertEqual(confirmed[1]['receipt']['event']['rangedReceipt']['targets'][0]['base'], previews[1]['targets'][0]['base'])
        self.assertEqual(confirmed[1]['receipt']['event']['turnPenalty'], -2)
        stable = self.raw_scene(); saved = self.resources()
        replay = self.gm_client.request(self.url('/commands'), 'POST', command, csrf=self.gm_identity['csrf'])
        self.assertTrue(replay[1]['duplicate']); self.assertEqual(self.resources(), saved)
        changed = self.gm_client.request(self.url('/commands'), 'POST', dict(command, gmFire=dict(turnToTarget=False, rulings=private.tactical.existing.TEST_FIRING_RULINGS)), csrf=self.gm_identity['csrf'])
        self.assertEqual(changed[0], 409); self.assertEqual(self.raw_scene(), stable)
        self.assertEqual(self.command('undo')[0][0], 200)
        self.assertEqual(battle.find_actor(self.raw_scene(), self.aid)['heading'], 225)
        self.assertEqual(self.raw_scene()['pending'], [])

    def test_direct_shot_and_nonshot_confirm_reject_missing_or_irrelevant_ruling(self):
        self.setup_facing()
        result, _ = self.raw_command('shoot', actorId=self.aid, targetId=self.other_aid)
        self.assertEqual(result[0], 409, result)  # Legacy execution is always closed.
        result, _ = self.raw_command('fire', actorId=self.aid, mode='single', rounds=1, targetIds=[self.other_aid])
        self.assertEqual(result[0], 400, result)  # Canonical firing still needs GM adjudication.
        declared, declaration = self.declare_as(dict(type='face', actorId=self.aid, heading=90))
        self.assertEqual(declared[0], 200, declared)
        result, _ = self.raw_command('confirm', declarationId=declaration['id'], turnToTarget=False)
        self.assertEqual(result[0], 400, result)
        self.assertEqual(battle.find_actor(self.raw_scene(), self.aid)['heading'], 0)

    def test_turn_does_not_reveal_previous_rear_events(self):
        self.setup_facing()
        # Place the other player behind this observer and order only these two.
        def arrange(state):
            battle.find_actor(state, self.other_aid).update(x=3, y=3)
            state.update(order=[self.aid, self.other_aid], index=0)
        self.store_scene(arrange)
        self.assertEqual(self.command('end', actorId=self.aid)[0][0], 200)
        result = self.intent(dict(type='face', actorId=self.other_aid, heading=90), player=1)
        event_id = result['receipt']['event']['id']
        self.assertNotIn(event_id, [e['id'] for e in self.get()['battle']['log']])
        self.assertEqual(self.command('end', actorId=self.other_aid)[0][0], 200)
        self.intent(dict(type='face', actorId=self.aid, heading=180))
        after = self.get()
        self.assertIn(self.other_aid, [a['id'] for a in after['battle']['scene']['actors']])
        self.assertNotIn(event_id, [e['id'] for e in after['battle']['log']])
        self.assertNotIn('_seenBy', json.dumps(after))

    def test_capped_log_multiple_events_have_unique_persisted_replay_ids(self):
        self.setup_facing()
        def at_cap(state):
            state.update(order=[self.aid], index=0)
            state['log'] = [dict(id='old-' + str(i), round=0, actorIds=[], kind='start', text='Old') for i in range(150)]
        self.store_scene(at_cap)
        result, command = self.command('end', actorId=self.aid)
        self.assertEqual(result[0], 200, result)
        history = self.raw_scene()['log']
        self.assertEqual(len(history), 150)
        self.assertEqual(len({e['id'] for e in history}), 150)
        added = [e for e in history if not e['id'].startswith('old-')]
        self.assertGreaterEqual(len(added), 2)
        self.assertTrue(all(self.aid in e['_seenBy'] for e in added))
        replay = self.gm_client.request(self.url('/commands'), 'POST', command, csrf=self.gm_identity['csrf'])
        self.assertTrue(replay[1]['duplicate'])
        self.assertEqual(replay[1]['receipt'], result[1]['receipt'])
        self.assertEqual(self.raw_scene()['log'], history)

    def test_gm_preparation_face_but_no_player_precombat_turn(self):
        self.setup_rooms()
        action = dict(type='face', actorId=self.aid, heading=315)
        result = self.preview_as(action)
        self.assertEqual(result[0], 200); self.assertFalse(result[1]['preview']['ok'])
        self.assertEqual(self.declare_as(action)[0][0], 409)
        before = self.resources()
        result, _ = self.command('face', actorId=self.aid, heading=315)
        self.assertEqual(result[0], 200, result)
        self.assertEqual(battle.find_actor(self.raw_scene(), self.aid)['heading'], 315)
        self.assertEqual(self.resources(), before)
        self.assertEqual(self.command('undo')[0][0], 200)
        self.assertEqual(battle.find_actor(self.raw_scene(), self.aid)['heading'], 0)

    def test_prepare_export_import_preserve_and_validate_heading(self):
        self.setup_rooms()
        setup = copy.deepcopy(self.vision_setup)
        setup['actors'][0]['heading'] = 225
        self.reprepare(setup)
        setup = copy.deepcopy(self.vision_setup)
        setup['actors'][0].pop('heading')
        self.reprepare(setup)
        self.assertEqual(battle.find_actor(self.raw_scene(), self.aid)['heading'], 225)
        self.assertEqual(self.command('add', templateId='guard-rifle', x=4, y=3, heading=270, hidden=False)[0][0], 200)
        state = self.get(self.gm_client)['battle']
        exported = self.gm_client.request(self.url('/preview'), 'POST',
            dict(battleId=state['id'], expectedVersion=state['version'], command=dict(type='export-scene')), csrf=self.gm_identity['csrf'])
        document = exported[1]['preview']['document']
        self.assertEqual(document['characters'][0]['heading'], 225)
        self.assertEqual(document['npcs'][0]['heading'], 270)
        imported, _ = self.command('import-scene', document=document)
        self.assertEqual(imported[0], 200, imported)
        self.assertEqual(next(a for a in self.raw_scene()['actors'] if a.get('origin', {}).get('kind') == 'npc')['heading'], 270)
        self.assertEqual(battle.find_actor(self.raw_scene(), self.aid)['heading'], 225)
        for entry in document['characters']: entry.pop('heading')
        self.assertEqual(self.command('import-scene', document=document)[0][0], 200)
        self.assertEqual(battle.find_actor(self.raw_scene(), self.aid)['heading'], 225)
        document['characters'][0]['heading'] = 17
        self.assertEqual(self.command('import-scene', document=document)[0][0], 400)


if __name__ == '__main__':
    unittest.main()
