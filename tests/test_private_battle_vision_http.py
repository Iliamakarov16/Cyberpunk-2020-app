"""Personal tactical vision at the real authenticated HTTP/SQLite boundary."""

import copy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import urlencode

import test_tactical_battle_http as tactical
import test_mobile_host as fixtures
import shared_battle as battle
import battle_vision


class PrivateBattleVisionHTTP(unittest.TestCase):
    setUp = tactical.TacticalHTTP.setUp
    start = tactical.TacticalHTTP.start
    gm = tactical.TacticalHTTP.gm
    player = tactical.TacticalHTTP.player
    campaign = tactical.TacticalHTTP.campaign
    sheet = tactical.TacticalHTTP.sheet
    party = tactical.TacticalHTTP.party
    command = tactical.TacticalHTTP.command
    database = tactical.TacticalHTTP.database

    def url(self, suffix='', viewer=None):
        return self.path + suffix + ('?' + urlencode({'viewerActorId': viewer}) if viewer is not None else '')

    def get(self, client=None, viewer=None):
        result = (client or self.players[0][0]).request(self.url(viewer=viewer))
        self.assertEqual(result[0], 200, result)
        return result[1]

    def preview_as(self, action, player=0, viewer=None):
        client, user, _ = self.players[player]
        state = self.get(self.gm_client)['battle']
        body = dict(battleId=state['id'], expectedVersion=state['version'], command=tactical.existing.canonical_action(action))
        return client.request(self.url('/preview', viewer), 'POST', body, csrf=user['csrf'])

    def declare_as(self, action, player=0, viewer=None, command_id=None):
        client, user, _ = self.players[player]
        state = self.get(self.gm_client)['battle']
        body = dict(id=command_id or 'vision-declare-' + str(state['version']), battleId=state['id'],
                    expectedVersion=state['version'], type='declare', action=tactical.existing.canonical_action(action))
        return client.request(self.url('/commands', viewer), 'POST', body, csrf=user['csrf']), body

    def intent(self, action, player=0, viewer=None):
        declared, command = self.declare_as(action, player, viewer)
        self.assertEqual(declared[0], 200, declared)
        confirmed, _ = self.command('confirm', declarationId=command['id'])
        self.assertEqual(confirmed[0], 200, confirmed)
        return confirmed[1]

    def store_scene(self, mutate):
        # Only this test's temporary database, to simulate pre-upgrade records,
        # stale sheets and adverse states unavailable through an ordinary UI.
        with self.database() as db:
            row = db.execute('SELECT campaign_id,data FROM shared_battles').fetchone()
            state = json.loads(row[1]); mutate(state)
            db.execute('UPDATE shared_battles SET data=? WHERE campaign_id=?', (json.dumps(state), row[0]))

    def raw_scene(self):
        with self.database() as db:
            return json.loads(db.execute('SELECT data FROM shared_battles').fetchone()[0])

    def reprepare(self, payload):
        payload = copy.deepcopy(payload)
        payload.update(id='vision-setup-' + str(self.get(self.gm_client)['battle']['version']),
                       expectedVersion=self.get(self.gm_client)['battle']['version'])
        result = self.gm_client.request(self.path, 'POST', payload, csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0], 200, result)
        self.vision_setup = payload
        return result[1]

    def accept(self, player, cid):
        client, user, _ = self.players[player]
        base = self.path.removesuffix('/battle')
        campaign = self.gm_client.request(base)[1]
        joined = client.request('/api/campaigns/join', 'POST',
                                dict(code=campaign['invite_code'], character_id=cid), csrf=user['csrf'])
        self.assertEqual(joined[0], 201, joined)
        return self.roster(cid, 'active')

    def roster(self, cid, status):
        base = self.path.removesuffix('/battle')
        version = self.gm_client.request(base)[1]['version']
        result = self.gm_client.request(base + '/roster', 'POST',
            dict(version=version, character_id=cid, status=status), csrf=self.gm_identity['csrf'])
        self.assertEqual(result[0], 200, result)
        return result

    def setup_rooms(self, second_owned=False, net=False):
        random = patch.object(battle.secrets, 'SystemRandom', return_value=SimpleNamespace(random=lambda: .3))
        random.start(); self.addCleanup(random.stop)
        self.party(count=2, hidden=True)
        self.aid = 'character-' + str(self.players[0][2])
        self.other_aid = 'character-' + str(self.players[1][2])
        self.guard_aid = 'character-' + str(self.guard)
        self.hidden_aid = 'character-' + str(self.secret)
        setup = copy.deepcopy(self.prepare_body)
        setup.update(width=16, height=8, name='Personal-vision test',
            tiles=[[dict(type='floor', zone='WEST' if x < 7 else 'SECRET EAST ZONE')
                    for x in range(16)] for _ in range(8)],
            props=[dict(id='west-crate', type='crate', x=2, y=5, w=1, h=1, cover=True, label='West crate'),
                   dict(id='secret-east-car', type='car', x=10, y=0, w=4, h=2, cover=True, label='SECRET EAST CAR')],
            devices=[dict(id='west-port', name='West port', type='port', networkId='rooms', x=1, y=4),
                     dict(id='secret-east-port', name='SECRET EAST PORT', type='port', networkId='rooms', x=11, y=4),
                     dict(id='private-camera', name='PRIVATE CAMERA', type='camera', networkId='rooms', x=12, y=4, range=6, active=True)])
        for y in range(8):
            setup['tiles'][y][7] = dict(type='wall', zone='Partition')
        setup['tiles'][3][7] = dict(type='door', open=False, zone='Partition')
        for actor, (x, y) in zip(setup['actors'], [(1, 3), (11, 3), (11, 5), (13, 5)]):
            actor.update(x=x, y=y, heading=0)
        if second_owned:
            client, user, _ = self.players[0]
            cid = self.sheet(client, user, 'Other owned character', ref=2)
            self.accept(0, cid)
            config = copy.deepcopy(setup['actors'][0])
            config.update(characterId=cid, version=client.request(f'/api/characters/{cid}')[1]['version'], x=10, y=6, heading=315)
            setup['actors'].append(config)
            self.second_cid, self.second_aid = cid, 'character-' + str(cid)
        if net:
            client, user, cid = self.players[0]
            sheet = client.request(f'/api/characters/{cid}')[1]
            data = copy.deepcopy(sheet['data']); data.update(special='Interface', specialRank=4)
            updated = client.request(f'/api/characters/{cid}', 'PUT',
                dict(version=sheet['version'], data=data, reason='Vision camera test'), csrf=user['csrf'])
            self.assertEqual(updated[0], 200, updated)
            setup['actors'][0].update(version=updated[1]['version'],
                net=dict(deckItemId='private', interfaceRank=4, programIds=['genie', 'crystalBall', 'soundmachine']))
        return self.reprepare(setup)

    def start_combat(self):
        started, _ = self.command('start')
        self.assertEqual(started[0], 200, started)
        self.assertEqual(started[1]['battle']['scene']['currentActorId'], self.aid)
        return started[1]

    def test_real_two_player_views_hide_all_offscreen_geometry_and_keep_gm_full(self):
        self.setup_rooms()
        west, east, gm = self.get(), self.get(self.players[1][0]), self.get(self.gm_client)
        self.assertEqual(west['viewerActorId'], self.aid)
        self.assertEqual(west['controlledActorIds'], [self.aid])
        self.assertEqual(west['viewerActors'], [dict(id=self.aid, name='Player 0')])
        self.assertEqual(east['viewerActorId'], self.other_aid)
        west_scene, east_scene = west['battle']['scene'], east['battle']['scene']
        self.assertEqual(west_scene['vision']['model'], 'los180')
        self.assertEqual(west_scene['vision']['actorId'], self.aid)
        self.assertTrue(all(x <= 7 for x, _ in west_scene['vision']['cells']))
        self.assertTrue(all(x >= 7 for x, _ in east_scene['vision']['cells']))
        self.assertEqual([a['id'] for a in west_scene['actors']], [self.aid])
        self.assertIn(self.guard_aid, [a['id'] for a in east_scene['actors']])
        self.assertNotIn(self.hidden_aid, [a['id'] for a in east_scene['actors']])
        self.assertEqual(west_scene['tiles'][3][11], {'type': 'unknown'})
        self.assertEqual(east_scene['tiles'][3][1], {'type': 'unknown'})
        self.assertEqual([p['id'] for p in west_scene['props']], ['west-crate'])
        self.assertEqual([d['id'] for d in west_scene['devices']], ['west-port'])
        for secret in ('SECRET EAST ZONE', 'SECRET EAST CAR', 'SECRET EAST PORT', 'PRIVATE CAMERA', 'HIDDEN GUARD SECRET', '_seenBy'):
            self.assertNotIn(secret, json.dumps(west))
        self.assertEqual(len(gm['battle']['scene']['actors']), 4)
        self.assertEqual(len(gm['battle']['scene']['props']), 2)
        self.assertEqual(len(gm['battle']['scene']['devices']), 3)
        self.assertNotIn('unknown', json.dumps(gm['battle']['scene']['tiles']))

    def test_two_owned_actors_switch_without_union_or_persisting_selection(self):
        self.setup_rooms(second_owned=True)
        west, east = self.get(), self.get(viewer=self.second_aid)
        self.assertEqual(west['viewerActorId'], self.aid)
        self.assertEqual(east['viewerActorId'], self.second_aid)
        self.assertEqual(east['controlledActorIds'], [self.second_aid])
        self.assertEqual({p['id'] for p in west['viewerActors']}, {self.aid, self.second_aid})
        self.assertTrue(all(set(p) == {'id', 'name'} for p in west['viewerActors']))
        self.assertNotIn(self.second_aid, [a['id'] for a in west['battle']['scene']['actors']])
        self.assertNotIn(self.aid, [a['id'] for a in east['battle']['scene']['actors']])
        self.assertNotIn('PRIVATE', json.dumps(east))
        self.assertEqual(self.get()['viewerActorId'], self.aid)
        client = self.players[0][0]
        for viewer in (self.other_aid, self.guard_aid, self.hidden_aid, 'missing', ''):
            with self.subTest(viewer=viewer):
                self.assertEqual(client.request(self.url(viewer=viewer))[0], 403)
        # The destination is visible to the selected second observer, isolating
        # actor ownership from the earlier unseen-destination guard.
        action = dict(type='move', actorId=self.aid, x=11, y=6)
        self.assertEqual(self.preview_as(action, viewer=self.second_aid)[0], 403)
        self.assertEqual(self.declare_as(action, viewer=self.second_aid)[0][0], 403)
        self.assertEqual(self.preview_as(action, viewer=self.other_aid)[0], 403)

    def test_door_open_close_reveals_and_hides_without_shared_memory(self):
        self.setup_rooms()
        before = self.get()['battle']['scene']
        self.assertEqual(before['tiles'][3][7]['type'], 'door')
        self.assertFalse(before['tiles'][3][7]['open'])
        opened, _ = self.command('door', x=7, y=3)
        self.assertEqual(opened[0], 200, opened)
        during = self.get()['battle']['scene']
        self.assertIn(self.other_aid, [a['id'] for a in during['actors']])
        self.assertNotIn(self.hidden_aid, [a['id'] for a in during['actors']])
        self.assertEqual(during['tiles'][3][11]['type'], 'floor')
        self.assertIn([11, 3], during['vision']['cells'])
        closed, _ = self.command('door', x=7, y=3)
        self.assertEqual(closed[0], 200, closed)
        after = self.get()['battle']['scene']
        for field in ('tiles', 'props', 'devices', 'actors', 'vision'):
            self.assertEqual(after[field], before[field], field)

    def test_preview_declaration_confirmation_and_replay_keep_selected_view(self):
        self.setup_rooms(second_owned=True); self.start_combat()
        move = dict(type='move', actorId=self.aid, x=3, y=3)
        preview = self.preview_as(move)
        self.assertEqual(preview[0], 200, preview)
        self.assertTrue(preview[1]['preview']['ok'])
        cells = {tuple(p) for p in self.get()['battle']['scene']['vision']['cells']}
        self.assertTrue(all((p['x'], p['y']) in cells for p in preview[1]['preview']['path']))
        declared, command = self.declare_as(move)
        self.assertEqual(declared[0], 200, declared)
        self.assertEqual(len(declared[1]['battle']['pending']), 1)
        self.assertEqual(self.get(viewer=self.second_aid)['battle']['pending'], [])
        client, user, _ = self.players[0]
        replay = client.request(self.url('/commands', self.second_aid), 'POST', command, csrf=user['csrf'])
        self.assertEqual(replay[0], 200, replay)
        self.assertTrue(replay[1]['duplicate'])
        self.assertEqual(replay[1]['viewerActorId'], self.second_aid)
        self.assertEqual(replay[1]['battle']['pending'], [])
        confirmed, _ = self.command('confirm', declarationId=command['id'])
        self.assertEqual(confirmed[0], 200, confirmed)
        own = next(a for a in self.get()['battle']['scene']['actors'] if a['id'] == self.aid)
        self.assertEqual((own['x'], own['y']), (3, 3))
        self.assertNotIn(self.aid, [a['id'] for a in self.get(viewer=self.second_aid)['battle']['scene']['actors']])

    def test_unseen_target_destination_and_device_rejected_before_sheet_oracle(self):
        self.setup_rooms(); self.start_combat()
        actions = [dict(type='move', actorId=self.aid, x=10, y=3),
                   dict(type='interact', actorId=self.aid, x=10, y=3),
                   dict(type='connect', actorId=self.aid, deviceId='secret-east-port')]
        for action in actions:
            self.assertEqual(self.preview_as(action)[0], 400)
            self.assertEqual(self.declare_as(action)[0][0], 400)
        outcomes = []
        for target in (self.guard_aid, self.hidden_aid, 'does-not-exist'):
            action = dict(type='shoot', actorId=self.aid, targetId=target, location='torso')
            outcomes.append(self.preview_as(action)[:2])
            self.assertEqual(outcomes[-1][0], 400)
        self.assertEqual(outcomes[0], outcomes[1]); self.assertEqual(outcomes[0], outcomes[2])
        sheet = self.gm_client.request(f'/api/characters/{self.guard}')[1]
        data = copy.deepcopy(sheet['data']); data['notes'] = 'SECRET UPDATED REVISION'
        edited = self.gm_client.request(f'/api/characters/{self.guard}', 'PUT',
            dict(version=sheet['version'], data=data, reason='Hidden concurrent edit'), csrf=self.gm_identity['csrf'])
        self.assertEqual(edited[0], 200, edited)
        changed = self.preview_as(dict(type='shoot', actorId=self.aid, targetId=self.guard_aid, location='torso'))
        self.assertEqual(changed[:2], outcomes[0])

    def test_visible_destination_with_unseen_movement_detour_is_rejected(self):
        self.setup_rooms()
        setup = copy.deepcopy(self.vision_setup)
        setup['tiles'] = [[dict(type='floor') for _ in range(16)] for _ in range(8)]
        for x, y in [(2, 0), (3, 0), (4, 0), (3, 2)]:
            setup['tiles'][y][x] = dict(type='wall')
        setup['actors'][0].update(x=1, y=1)
        setup['props'] = [dict(id='detour-counter', type='counter', x=2, y=1, w=3, h=1, cover=True)]
        self.reprepare(setup); self.start_combat()
        state = self.raw_scene(); observer = battle.find_actor(state, self.aid)
        visible = battle_vision.visible_cells(state, observer)
        route = battle.find_path(state, observer, 5, 1)
        self.assertIn((5, 1), visible)
        self.assertIsNotNone(route)
        self.assertTrue(any((p['x'], p['y']) not in visible for p in route['path']))
        action = dict(type='move', actorId=self.aid, x=5, y=1)
        self.assertEqual(self.preview_as(action)[0], 400)
        self.assertEqual(self.declare_as(action)[0][0], 400)

    def test_roster_revocation_and_absent_actor_never_fall_back_to_party_eyes(self):
        self.setup_rooms(second_owned=True)
        self.roster(self.second_cid, 'remove')
        self.assertEqual(self.players[0][0].request(self.url(viewer=self.second_aid))[0], 403)
        self.assertEqual(self.get()['viewerActorId'], self.aid)
        self.roster(self.players[0][2], 'remove')
        # Removing every accepted sheet revokes the entire battle endpoint.
        self.assertEqual(self.players[0][0].request(self.url())[0], 403)
        self.assertEqual(self.players[0][0].request(self.url(viewer=self.aid))[0], 403)
        self.assertEqual(self.preview_as(dict(type='move', actorId=self.aid, x=2, y=3))[0], 403)
        self.accept(0, self.players[0][2])
        setup = copy.deepcopy(self.vision_setup)
        setup['actors'] = [a for a in setup['actors'] if a['characterId'] not in (self.players[0][2], self.second_cid)]
        self.reprepare(setup)
        # Still-accepted players whose character is absent from this scene get
        # an empty personal view, never the remaining party's map.
        missing = self.get()
        self.assertIsNone(missing['viewerActorId'])
        self.assertEqual(missing['viewerActors'], [])
        self.assertEqual(missing['controlledActorIds'], [])
        self.assertEqual(missing['battle']['scene']['vision']['cells'], [])
        self.assertEqual(missing['battle']['scene']['actors'], [])
        self.assertTrue(all(tile == {'type': 'unknown'} for row in missing['battle']['scene']['tiles'] for tile in row))

    def test_same_owner_visible_unselected_actor_has_no_private_combat_payload(self):
        self.setup_rooms(second_owned=True)
        placed, _ = self.command('place', actorId=self.second_aid, x=3, y=3)
        self.assertEqual(placed[0], 200, placed)
        self.store_scene(lambda state: battle.find_actor(state, self.second_aid).update(heading=180, facing=-1))
        for selected, unselected in ((self.aid, self.second_aid), (self.second_aid, self.aid)):
            response = self.get(viewer=selected)
            actors = {a['id']: a for a in response['battle']['scene']['actors']}
            self.assertIn('weapon', actors[selected])
            self.assertIn(unselected, actors)
            self.assertFalse({'stats', 'armor', 'weapon', 'net', 'ownerId', 'sheetVersion', 'wounds'} & set(actors[unselected]))

    def test_partial_prop_footprint_is_not_reconstructed_through_a_doorway(self):
        self.setup_rooms()
        setup = copy.deepcopy(self.vision_setup)
        setup['tiles'][3][7]['open'] = True
        setup['props'][1].update(y=2)
        setup['actors'][1].update(x=14, y=6)
        self.reprepare(setup)
        state = self.get()['battle']['scene']
        cells = {tuple(p) for p in state['vision']['cells']}
        footprint = {(x, y) for x in range(10, 14) for y in range(2, 4)}
        self.assertTrue(footprint & cells)
        self.assertFalse(footprint <= cells)
        self.assertNotIn('secret-east-car', [p['id'] for p in state['props']])
        self.assertNotIn('SECRET EAST CAR', json.dumps(state))
        edges = state['vision']['obstacles']
        self.assertEqual({(edge['x'], edge['y']) for edge in edges}, footprint & cells)
        self.assertTrue(all(set(edge) == {'x', 'y', 'cover'} for edge in edges))
        self.assertTrue(all(edge['cover'] is True for edge in edges))

    def test_ui_gm_mode_and_missing_membership_do_not_grant_battle_vision(self):
        self.setup_rooms()
        client, user, _ = self.players[0]
        switched = client.request('/api/mode', 'POST', dict(mode='gm'), csrf=user['csrf'])
        self.assertEqual(switched[0], 200, switched)
        response = self.get()
        self.assertEqual(response['role'], 'player')
        self.assertEqual(response['battle']['scene']['tiles'][3][11], {'type': 'unknown'})
        with self.database() as db:
            db.execute('DELETE FROM campaign_members WHERE user_id=?', (user['id'],))
        self.assertEqual(client.request(self.url())[0], 403)
        self.assertEqual(client.request(self.url(viewer=self.aid))[0], 403)

    def test_pending_confirmation_rechecks_changed_visibility_without_mutating_actor(self):
        self.setup_rooms()
        opened, _ = self.command('door', x=7, y=3)
        self.assertEqual(opened[0], 200, opened)
        self.start_combat()
        declared, command = self.declare_as(dict(type='move', actorId=self.aid, x=9, y=3))
        self.assertEqual(declared[0], 200, declared)
        self.store_scene(lambda state: state['tiles'][3][7].update(open=False))
        before = self.raw_scene()
        denied, _ = self.command('confirm', declarationId=command['id'])
        self.assertEqual(denied[0], 400, denied)
        self.assertEqual(self.raw_scene(), before)
        self.assertEqual(self.get()['battle']['pending'], [], 'A stale preview must not reveal an unseen route')

    def test_hidden_actor_cannot_leak_detour_geometry_through_move_preview(self):
        self.setup_rooms()
        setup = copy.deepcopy(self.vision_setup)
        setup['actors'][3].update(x=2, y=3)
        self.reprepare(setup); self.start_combat()
        self.assertNotIn(self.hidden_aid, [a['id'] for a in self.get()['battle']['scene']['actors']])
        action = dict(type='move', actorId=self.aid, x=3, y=3)
        preview = self.preview_as(action)
        self.assertEqual(preview[0], 400, preview)
        self.assertNotIn('path', preview[1])
        self.assertNotIn('HIDDEN GUARD SECRET', json.dumps(preview))
        self.assertEqual(self.declare_as(action)[0][0], 400)

    def test_internal_audiences_never_cross_first_or_replayed_gm_receipts(self):
        initial = self.setup_rooms()
        for key in ('_seenBy', '_spatialSeenBy'):
            self.assertNotIn(key, json.dumps(initial))
        opened, command = self.command('door', x=7, y=3)
        self.assertEqual(opened[0], 200, opened)
        for key in ('_seenBy', '_spatialSeenBy'):
            self.assertNotIn(key, json.dumps(opened))
        replay = self.gm_client.request(self.url('/commands'), 'POST', command, csrf=self.gm_identity['csrf'])
        self.assertEqual(replay[0], 200, replay)
        for key in ('_seenBy', '_spatialSeenBy'):
            self.assertNotIn(key, json.dumps(replay))

    def test_pending_confirmation_rechecks_revoked_owner_and_stunned_view_fails_closed(self):
        self.setup_rooms(); self.start_combat()
        declared, command = self.declare_as(dict(type='move', actorId=self.aid, x=2, y=3))
        self.assertEqual(declared[0], 200, declared)
        self.roster(self.players[0][2], 'remove')
        denied, _ = self.command('confirm', declarationId=command['id'])
        self.assertEqual(denied[0], 403, denied)
        self.assertEqual((battle.find_actor(self.raw_scene(), self.aid)['x'], battle.find_actor(self.raw_scene(), self.aid)['y']), (1, 3))
        self.accept(0, self.players[0][2])
        self.store_scene(lambda state: battle.find_actor(state, self.aid).update(status='stunned'))
        projected = self.get()['battle']['scene']
        self.assertEqual(projected['vision']['cells'], [])
        self.assertEqual([a['id'] for a in projected['actors']], [self.aid])
        self.assertEqual(projected['props'], []); self.assertEqual(projected['devices'], [])

    def test_unstamped_legacy_history_and_unseen_actions_stay_hidden_after_door_opens(self):
        self.setup_rooms(second_owned=True)
        def add_legacy(state):
            state['log'].append(dict(id='pre-upgrade-secret', round=0, kind='move', actorIds=[self.aid],
                                     text='LEGACY PRIVATE EVENT', path=[dict(x=12, y=3)]))
        self.store_scene(add_legacy)
        self.assertNotIn('LEGACY PRIVATE EVENT', json.dumps(self.get()))
        self.assertIn('LEGACY PRIVATE EVENT', json.dumps(self.get(self.gm_client)))
        self.start_combat()
        ended, _ = self.command('end', actorId=self.aid)
        self.assertEqual(ended[0], 200, ended)
        self.assertEqual(ended[1]['battle']['scene']['currentActorId'], self.other_aid)
        event = self.intent(dict(type='move', actorId=self.other_aid, x=12, y=3), player=1)['receipt']['event']
        event_id = event['id']
        self.assertIn(event_id, [e['id'] for e in self.get(self.players[1][0])['battle']['log']])
        self.assertIn(event_id, [e['id'] for e in self.get(viewer=self.second_aid)['battle']['log']])
        self.assertNotIn(event_id, [e['id'] for e in self.get()['battle']['log']])
        opened, _ = self.command('door', x=7, y=3)
        self.assertEqual(opened[0], 200, opened)
        later = self.get()
        self.assertIn(self.other_aid, [a['id'] for a in later['battle']['scene']['actors']])
        self.assertNotIn(event_id, [e['id'] for e in later['battle']['log']])
        self.assertNotIn('_seenBy', json.dumps(later))

    def test_receipt_replay_filters_selected_audience_and_hides_legacy_events(self):
        self.setup_rooms(second_owned=True); self.start_combat()
        result, command = self.declare_as(dict(type='move', actorId=self.aid, x=2, y=3))
        self.assertEqual(result[0], 200, result)
        def receipt_event(event):
            with self.database() as db:
                receipt = json.loads(db.execute('SELECT result FROM shared_battle_commands WHERE command_id=?', (command['id'],)).fetchone()[0])
                receipt['event'] = event
                db.execute('UPDATE shared_battle_commands SET result=? WHERE command_id=?', (json.dumps(receipt), command['id']))
        event = dict(id='old-command-event', round=1, kind='move', actorIds=[self.aid],
                     text='PERSONAL RECEIPT EVENT', path=[dict(x=2, y=3)], _seenBy=[self.aid])
        receipt_event(event)
        client, user, _ = self.players[0]
        west = client.request(self.url('/commands', self.aid), 'POST', command, csrf=user['csrf'])
        east = client.request(self.url('/commands', self.second_aid), 'POST', command, csrf=user['csrf'])
        self.assertEqual(west[0], 200, west); self.assertEqual(east[0], 200, east)
        self.assertEqual(west[1]['receipt']['event']['text'], 'PERSONAL RECEIPT EVENT')
        self.assertNotIn('_seenBy', json.dumps(west))
        self.assertIsNone(east[1]['receipt']['event'])
        event.pop('_seenBy'); receipt_event(event)
        legacy = client.request(self.url('/commands', self.aid), 'POST', command, csrf=user['csrf'])
        self.assertEqual(legacy[0], 200, legacy)
        self.assertIsNone(legacy[1]['receipt']['event'])
        foreign, identity, _ = self.players[1]
        denied = foreign.request(self.url('/commands'), 'POST', command, csrf=identity['csrf'])
        self.assertEqual(denied[0], 409, denied)
        self.assertNotIn('PERSONAL RECEIPT EVENT', json.dumps(denied))

    def test_undo_restores_history_without_restamping_old_audiences(self):
        self.setup_rooms(second_owned=True)
        legacy = dict(id='event-1-legacy', round=0, kind='start', actorIds=[], text='LEGACY UNDONE HISTORY')
        private = dict(id='event-1-private', round=0, kind='move', actorIds=[self.other_aid],
                       text='EAST ONLY HISTORY', path=[dict(x=11, y=3)], _seenBy=[self.other_aid, self.second_aid])
        self.store_scene(lambda state: state['log'].extend([legacy, private]))
        original = self.get(self.gm_client)['battle']
        exported = self.gm_client.request(self.url('/preview'), 'POST',
            dict(battleId=original['id'], expectedVersion=original['version'], command=dict(type='export-scene')),
            csrf=self.gm_identity['csrf'])
        self.assertEqual(exported[0], 200, exported)
        imported, _ = self.command('import-scene', document=exported[1]['preview']['document'])
        self.assertEqual(imported[0], 200, imported)
        self.assertNotIn(legacy['id'], [e['id'] for e in self.raw_scene()['log']])
        # Model a restored current scene where the door is now open while the
        # undo snapshot still contains the closed-door scene and old histories.
        self.store_scene(lambda state: state['tiles'][3][7].update(open=True))
        undone, _ = self.command('undo')
        self.assertEqual(undone[0], 200, undone)
        history = {e['id']: e for e in self.raw_scene()['log']}
        self.assertEqual(history[legacy['id']], legacy)
        self.assertEqual(history[private['id']], private)
        west = self.get(); east = self.get(self.players[1][0])
        self.assertNotIn(legacy['id'], [e['id'] for e in west['battle']['log']])
        self.assertNotIn(private['id'], [e['id'] for e in west['battle']['log']])
        self.assertNotIn(legacy['id'], [e['id'] for e in east['battle']['log']])
        self.assertIn(private['id'], [e['id'] for e in east['battle']['log']])
        self.assertNotIn('_seenBy', json.dumps(undone))

    def test_pre_action_wrapper_legacy_pending_shot_still_projects_safely(self):
        self.setup_rooms()
        opened, _ = self.command('door', x=7, y=3)
        self.assertEqual(opened[0], 200, opened)
        self.start_combat()
        declared, _ = self.declare_as(dict(type='shoot', actorId=self.aid, targetId=self.other_aid, location='torso'))
        self.assertEqual(declared[0], 200, declared)
        def legacy_pending(state):
            row=state['pending'][0]; action=row.pop('action')
            row.update(targetId=action['targetIds'][0],location=action.get('location','random'))
        self.store_scene(legacy_pending)
        result = self.get()
        self.assertEqual(len(result['battle']['pending']), 1)
        self.assertEqual(result['battle']['pending'][0]['targetId'], self.other_aid)
        self.store_scene(lambda state: state['tiles'][3][7].update(open=False))
        self.assertEqual(self.get()['battle']['pending'], [])

    def test_legacy_pending_remote_camera_preview_never_exports_offscreen_coordinates(self):
        self.setup_rooms(second_owned=True, net=True); self.start_combat()
        self.intent(dict(type='connect', actorId=self.aid, deviceId='west-port'))
        self.intent(dict(type='scan', actorId=self.aid))
        declared, command = self.declare_as(dict(type='control', actorId=self.aid, deviceId='private-camera', operation='observe'))
        self.assertEqual(declared[0], 200, declared)
        self.store_scene(lambda state: state['pending'][0]['preview']['device'].update(x=12, y=4))
        client, user, _ = self.players[0]
        replay = client.request(self.url('/commands'), 'POST', command, csrf=user['csrf'])
        self.assertEqual(replay[0], 200, replay)
        for response in (self.get(), replay[1]):
            self.assertEqual(len(response['battle']['pending']), 1)
            self.assertFalse({'x', 'y'} & set(response['battle']['pending'][0]['preview']['device']))
        self.assertEqual(self.get(viewer=self.second_aid)['battle']['pending'], [])

    def test_live_ownership_change_revokes_stale_scene_owner_without_cross_account_fallback(self):
        self.setup_rooms(second_owned=True)
        with self.database() as db:
            db.execute('UPDATE characters SET owner_id=? WHERE id=?', (self.players[1][1]['id'], self.players[0][2]))
        # The original owner still has a different accepted character. The new
        # owner must not inherit control from an old scene's stale ownerId.
        self.assertEqual(self.get()['viewerActorId'], self.second_aid)
        self.assertEqual(self.get(self.players[1][0])['viewerActorId'], self.other_aid)
        for client, _, _ in self.players:
            self.assertEqual(client.request(self.url(viewer=self.aid))[0], 403)

    def test_remote_control_log_and_receipt_replay_hide_unseen_device_coordinates(self):
        self.setup_rooms(second_owned=True, net=True); self.start_combat()
        self.intent(dict(type='connect', actorId=self.aid, deviceId='west-port'))
        self.intent(dict(type='scan', actorId=self.aid))
        declared, command = self.declare_as(dict(type='control', actorId=self.aid, deviceId='private-camera', operation='observe'))
        self.assertEqual(declared[0], 200, declared)
        confirmed, _ = self.command('confirm', declarationId=command['id'])
        self.assertEqual(confirmed[0], 200, confirmed)
        event_id = confirmed[1]['receipt']['event']['id']
        raw = next(e for e in self.raw_scene()['log'] if e['id'] == event_id)
        self.assertIn(self.aid, raw['_seenBy'])
        self.assertNotIn(self.aid, raw['_spatialSeenBy'])
        logged = next(e for e in self.get()['battle']['log'] if e['id'] == event_id)
        self.assertTrue(logged['success'])
        self.assertEqual(logged['strength'], 4)
        self.assertFalse({'at', 'from', 'to', 'path', '_seenBy', '_spatialSeenBy'} & set(logged))
        # Historical player receipts may contain an authoritative event. Replay
        # must enforce exactly the same personal and spatial audience rules.
        with self.database() as db:
            receipt = json.loads(db.execute('SELECT result FROM shared_battle_commands WHERE command_id=?', (command['id'],)).fetchone()[0])
            receipt['event'] = raw
            db.execute('UPDATE shared_battle_commands SET result=? WHERE command_id=?', (json.dumps(receipt), command['id']))
        client, user, _ = self.players[0]
        own = client.request(self.url('/commands', self.aid), 'POST', command, csrf=user['csrf'])
        other = client.request(self.url('/commands', self.second_aid), 'POST', command, csrf=user['csrf'])
        self.assertEqual(own[0], 200, own); self.assertEqual(other[0], 200, other)
        self.assertEqual(own[1]['receipt']['event'], logged)
        self.assertIsNone(other[1]['receipt']['event'])

    def test_gm_forced_player_shot_updates_ammo_without_revealing_hidden_target_in_history(self):
        self.setup_rooms()
        setup = copy.deepcopy(self.vision_setup)
        setup['actors'][3].update(x=3, y=3)
        self.reprepare(setup); self.start_combat()
        before = self.get()
        actor_before = next(a for a in before['battle']['scene']['actors'] if a['id'] == self.aid)
        self.assertIn([3, 3], before['battle']['scene']['vision']['cells'])
        self.assertNotIn(self.hidden_aid, [a['id'] for a in before['battle']['scene']['actors']])
        forced, _ = self.command('shoot', actorId=self.aid, targetId=self.hidden_aid, location='torso')
        self.assertEqual(forced[0], 200, forced)
        event_id = forced[1]['receipt']['event']['id']
        self.assertIn(self.hidden_aid, forced[1]['receipt']['event']['actorIds'])
        raw = next(e for e in self.raw_scene()['log'] if e['id'] == event_id)
        self.assertNotIn(self.aid, raw['_seenBy'])
        after = self.get()
        actor_after = next(a for a in after['battle']['scene']['actors'] if a['id'] == self.aid)
        self.assertEqual(actor_after['weapon']['ammo'], actor_before['weapon']['ammo'] - 1)
        self.assertNotIn(event_id, [e['id'] for e in after['battle']['log']])
        self.assertNotIn(self.hidden_aid, json.dumps(after))
        self.assertNotIn('HIDDEN GUARD SECRET', json.dumps(after))
        self.assertEqual(after['battle']['scene']['vision']['cells'], before['battle']['scene']['vision']['cells'])

    def test_camera_intel_private_to_one_actor_without_revealing_map_or_hidden_flag(self):
        self.setup_rooms(second_owned=True, net=True); self.start_combat()
        first_cells = self.get()['battle']['scene']['vision']['cells']
        self.intent(dict(type='connect', actorId=self.aid, deviceId='west-port'))
        self.intent(dict(type='scan', actorId=self.aid))
        devices = self.get()['battle']['scene']['devices']
        camera = next(d for d in devices if d['id'] == 'private-camera')
        self.assertEqual(camera, dict(id='private-camera', name='PRIVATE CAMERA', type='camera', remoteOnly=True))
        action = dict(type='control', actorId=self.aid, deviceId='private-camera', operation='observe')
        preview = self.preview_as(action)
        self.assertEqual(preview[0], 200, preview)
        self.assertTrue(preview[1]['preview']['ok'])
        self.assertFalse({'x', 'y'} & set(preview[1]['preview']['device']))
        confirmed = self.intent(action)
        self.assertTrue(confirmed['receipt']['event']['success'])
        own = self.get(); actor = next(a for a in own['battle']['scene']['actors'] if a['id'] == self.aid)
        intel = actor['net']['cameraIntel']
        self.assertIn(self.hidden_aid, [a['id'] for a in intel['actors']])
        self.assertTrue(all(set(a) == {'id', 'name', 'sprite', 'x', 'y', 'status'} for a in intel['actors']))
        self.assertEqual(own['battle']['scene']['vision']['cells'], first_cells)
        self.assertEqual(own['battle']['scene']['tiles'][5][13], {'type': 'unknown'})
        self.assertNotIn(self.hidden_aid, [a['id'] for a in own['battle']['scene']['actors']])
        self.assertTrue(battle.find_actor(self.raw_scene(), self.hidden_aid)['hidden'])
        for other in (self.get(self.players[1][0]), self.get(viewer=self.second_aid)):
            self.assertNotIn('cameraIntel', json.dumps(other))
            self.assertNotIn('HIDDEN GUARD SECRET', json.dumps(other))
            self.assertNotIn('PRIVATE CAMERA', json.dumps(other))
        fixtures.mobile_host.stop(); self.start(username='', password='')
        self.assertEqual(self.get(), own)


if __name__ == '__main__':
    unittest.main()
