"""Character privacy exercised through the Android host's actual HTTP / SQLite API."""
import base64
import copy
import hashlib
import json
import sqlite3
import unittest

import test_mobile_host as host_test


class CharacterAccessHTTP(unittest.TestCase):
    def setUp(self):
        self.host = host_test.MobileHostIntegration(methodName='runTest')
        self.addCleanup(self.host.doCleanups)
        self.host.setUp()
        self.gm, self.gm_me = self.host.gm()
        self.owner, self.owner_me = self.host.player('sheet-owner')
        self.peer, self.peer_me = self.host.player('sheet-peer')
        self.outside, self.outside_me = self.host.player('sheet-outsider')
        self.campaign = self.host.campaign(self.gm, self.gm_me)
        self.campaign_path = f"/api/campaigns/{self.campaign['id']}"
        self.cid = self.host.character(self.owner, self.owner_me, 'Вега')
        self.peer_cid = self.host.character(self.peer, self.peer_me, 'Спутник')
        self.outside_cid = self.host.character(self.outside, self.outside_me, 'Вне партии')
        self.path = f'/api/characters/{self.cid}'
        self.access_path = self.path + '/access'
        self.join(self.owner, self.owner_me, self.cid)
        self.join(self.peer, self.peer_me, self.peer_cid)
        self.accept(self.cid)
        self.accept(self.peer_cid)
        self.database = self.host.data / 'tracker.sqlite3'

    def join(self, client, user, cid, campaign=None):
        campaign = campaign or self.campaign
        status, result, _ = client.request('/api/campaigns/join', 'POST', {
            'code': campaign['invite_code'], 'character_id': cid}, csrf=user['csrf'])
        self.assertEqual(status, 201, result)

    def accept(self, cid, status='active', campaign=None):
        path = f"/api/campaigns/{(campaign or self.campaign)['id']}"
        current = self.gm.request(path)[1]
        result = self.gm.request(path + '/roster', 'POST', {
            'version': current['version'], 'character_id': cid, 'status': status}, csrf=self.gm_me['csrf'])
        self.assertEqual(result[0], 200, result[1])

    def access(self):
        status, result, _ = self.owner.request(self.access_path)
        self.assertEqual(status, 200, result)
        return next(row for row in result['campaigns'] if row['campaign_id'] == self.campaign['id'])

    def share(self, mode, player_ids=None, version=None, campaign_id=None):
        current = self.access()
        return self.owner.request(self.access_path, 'PUT', {
            'campaign_id': campaign_id or self.campaign['id'],
            'version': current['version'] if version is None else version,
            'mode': mode, 'player_ids': player_ids or []}, csrf=self.owner_me['csrf'])

    def save_items(self, items, appearance=None):
        sheet = self.owner.request(self.path)[1]
        data = sheet['data'] | {'items': items}
        if appearance is not None:
            data['appearance'] = appearance
        result = self.owner.request(self.path, 'PUT', {
            'version': sheet['version'], 'data': data, 'reason': 'Проверка внешней карточки'},
            csrf=self.owner_me['csrf'])
        self.assertEqual(result[0], 200, result[1])
        return self.owner.request(self.path)[1]

    def item(self, item_id, slot, category='clothing', visibility=None, **more):
        item = {'id': hashlib.sha256(item_id.encode()).hexdigest()[:24], 'name': item_id, 'slot': slot, 'category': category,
                'icon': 'shirt' if category == 'clothing' else category, 'quantity': 1, 'weight': 1,
                'equipped': True, 'description': 'секретное описание', 'source': 'секретный источник',
                'modifiers': [{'stat': 'REF', 'value': 2, 'label': 'секретный бонус', 'source': 'правило'}]}
        if visibility is not None:
            item['visibility'] = visibility
        return item | more

    def peer_roster_row(self):
        status, campaign, _ = self.peer.request(self.campaign_path)
        self.assertEqual(status, 200, campaign)
        return next(row for row in campaign['roster'] if row['character_id'] == self.cid)

    def test_private_default_exposes_only_appearance_and_owner_controls_access(self):
        access = self.access()
        self.assertEqual((access['mode'], access['version'], access['player_ids']), ('private', 0, []))
        self.assertEqual(access['players'], [{'id': self.peer_me['id'], 'username': 'sheet-peer'}])
        own = self.owner.request(self.path)[1]
        gm = self.gm.request(self.path)[1]
        self.assertEqual((own['access'], own['can_history'], own['can_edit'], own['can_delete']),
                         ('owner', True, True, True))
        self.assertEqual((gm['access'], gm['can_history'], gm['can_edit'], gm['can_delete']),
                         ('gm', True, True, False))
        self.assertEqual(self.peer.request(self.path)[0], 404)
        self.assertEqual(self.outside.request(self.path)[0], 404)
        self.assertNotIn(self.cid, [r['id'] for r in self.peer.request('/api/characters')[1]])
        roster = self.peer_roster_row()
        self.assertFalse(roster['can_open'])
        self.assertEqual(roster['exterior'], {'character_id': self.cid, 'name': 'Вега',
                         'appearance': {'accent': 'rust'}, 'items': []})
        self.assertEqual(self.gm.request(self.access_path)[0], 403)
        self.assertEqual(self.peer.request(self.access_path)[0], 404)

    def test_selected_and_party_grants_are_read_only_and_revocation_is_immediate(self):
        before = self.peer.request('/api/sync')[1]['signature']
        granted = self.share('selected', [self.peer_me['id']])
        self.assertEqual(granted[0], 200, granted[1])
        self.assertEqual(granted[1]['version'], 1)
        self.assertNotEqual(before, self.peer.request('/api/sync')[1]['signature'])
        shared = self.peer.request(self.path)[1]
        self.assertEqual((shared['access'], shared['can_edit'], shared['can_delete'], shared['can_history']),
                         ('shared', False, False, False))
        self.assertEqual(shared['data']['notes'], 'Личные записи')
        self.assertIn(self.cid, [r['id'] for r in self.peer.request('/api/characters')[1]])
        self.assertTrue(self.peer_roster_row()['can_open'])
        self.assertEqual(self.peer.request(self.access_path)[0], 403)
        self.assertEqual(self.peer.request(self.path + '/history')[0], 403)
        for method, body in [('PUT', {'version': shared['version'], 'data': shared['data']}),
                             ('DELETE', {'version': shared['version']})]:
            self.assertEqual(self.peer.request(self.path, method, body, csrf=self.peer_me['csrf'])[0], 404)
        self.assertEqual(self.outside.request(self.path)[0], 404)
        self.assertEqual(self.share('party', [self.peer_me['id']])[0], 200)
        self.assertEqual(self.access()['player_ids'], [])
        self.assertEqual(self.peer.request(self.path)[0], 200)
        self.assertEqual(self.share('private')[0], 200)
        self.assertEqual(self.peer.request(self.path)[0], 404)
        self.assertFalse(self.peer_roster_row()['can_open'])
        self.assertIn('exterior', self.peer_roster_row())

    def test_visible_outfit_layers_and_portrait_never_leak_inventory_mechanics(self):
        portrait = 'data:image/png;base64,' + base64.b64encode(host_test.PNG_ICON).decode()
        items = [self.item('майка', 'inner'), self.item('куртка', 'outer'), self.item('штаны', 'legs'),
                 self.item('ботинки', 'feet'), self.item('рюкзак', 'bag', 'gear'),
                 self.item('имплант', 'implant', 'cyber'), self.item('патроны', 'accessory', 'ammo'),
                 self.item('скрытая-кобура', 'accessory', 'gear', 'hidden'),
                 self.item('яркая-цепь', 'accessory', 'gear', 'visible'),
                 self.item('не-надета', 'head', equipped=False), self.item('без-количества', 'hands', quantity=0)]
        saved = self.save_items(items, {'accent': 'violet', 'portrait': portrait})
        self.assertNotIn('visibility', saved['data']['items'][0])
        self.assertEqual(saved['data']['items'][8]['visibility'], 'visible')
        exterior = self.peer_roster_row()['exterior']
        self.assertEqual(exterior['appearance'], {'accent': 'violet', 'portrait': portrait})
        self.assertEqual([item['name'] for item in exterior['items']], ['куртка', 'штаны', 'ботинки', 'яркая-цепь'])
        for item in exterior['items']:
            self.assertEqual(set(item), {'name', 'slot', 'icon'})
        for secret in ['секретное описание', 'секретный источник', 'секретный бонус', 'Личные записи', '1200']:
            self.assertNotIn(secret, json.dumps(exterior, ensure_ascii=False))
        self.save_items(items + [self.item('комбинезон', 'body')])
        self.assertEqual([item['name'] for item in self.peer_roster_row()['exterior']['items']],
                         ['ботинки', 'яркая-цепь', 'комбинезон'])
        forced = [dict(item, visibility='visible') if item['name'] == 'майка' else item for item in items]
        self.save_items(forced)
        self.assertIn('майка', [item['name'] for item in self.peer_roster_row()['exterior']['items']])

    def test_exterior_changes_invalidate_peer_sync_without_sharing_full_sheet(self):
        before = self.peer.request('/api/sync')[1]['signature']
        self.save_items([self.item('новая-куртка', 'outer')])
        after = self.peer.request('/api/sync')[1]['signature']
        self.assertNotEqual(before, after)
        self.assertEqual(self.peer.request(self.path)[0], 404)
        self.assertEqual(self.peer_roster_row()['exterior']['items'][0]['name'], 'новая-куртка')

    def test_portrait_frame_saves_restart_and_private_party_exterior_sync(self):
        portrait = 'data:image/png;base64,' + base64.b64encode(host_test.PNG_ICON).decode()
        frame = {'fit': 'cover', 'x': 13, 'y': 72, 'zoom': 180, 'height': 420, 'effect': 'foil'}
        before = self.peer.request('/api/sync')[1]['signature']
        appearance = {'accent': 'violet', 'portrait': portrait, 'portraitFrame': frame,
                      'privateRemark': 'Эта запись не входит во внешнюю карточку'}
        saved = self.save_items([], appearance)
        expected = {key: appearance[key] for key in ('accent', 'portrait', 'portraitFrame')}
        self.assertEqual(saved['data']['appearance'], expected)
        self.assertEqual(saved['data']['schemaVersion'], 2)
        self.assertNotEqual(before, self.peer.request('/api/sync')[1]['signature'])
        self.assertEqual(self.peer.request(self.path)[0], 404)
        self.assertEqual(self.peer_roster_row()['exterior']['appearance'], expected)
        self.assertEqual(self.gm.request(self.path)[1]['data']['appearance'], expected)
        self.assertEqual(self.outside.request(self.path)[0], 404)
        self.assertEqual(self.outside.request(self.campaign_path)[0], 404)
        with sqlite3.connect(self.database) as db:
            stored = json.loads(db.execute('SELECT data FROM characters WHERE id=?', (self.cid,)).fetchone()[0])
            revision = json.loads(db.execute('SELECT data FROM revisions WHERE character_id=? ORDER BY id DESC LIMIT 1',
                                             (self.cid,)).fetchone()[0])
        self.assertEqual(stored['appearance'], expected)
        self.assertEqual(revision['appearance'], expected)
        host_test.mobile_host.stop()
        self.host.start()
        self.assertEqual(self.owner.request(self.path)[1]['data']['appearance'], expected)
        self.assertEqual(self.peer_roster_row()['exterior']['appearance'], expected)
        self.assertEqual(self.peer.request(self.path)[0], 404)
        self.assertEqual(self.share('selected', [self.peer_me['id']])[0], 200)
        shared = self.peer.request(self.path)[1]
        self.assertEqual(shared['data']['appearance'], expected)
        denied = self.peer.request(self.path, 'PUT', {'version': shared['version'], 'data': shared['data']},
                                   csrf=self.peer_me['csrf'])
        self.assertEqual(denied[0], 404)
        self.assertEqual(self.peer.request(self.path + '/history')[0], 403)

    def test_portrait_frame_accepts_exact_bounds_and_survives_portrait_removal(self):
        base = {'fit': 'contain', 'x': 50, 'y': 50, 'zoom': 100, 'height': 340, 'effect': 'off'}
        frames = [dict(base, fit='contain', x=0, y=0, zoom=100, height=220),
                  dict(base, fit='cover', x=100, y=100, zoom=300, height=520)]
        frames.extend(dict(base, effect=effect) for effect in ('off', 'foil', 'scan', 'pulse', 'tilt'))
        for frame in frames:
            with self.subTest(fit=frame['fit'], effect=frame['effect'], height=frame['height']):
                saved = self.save_items([], {'accent': 'rust', 'portraitFrame': frame})
                self.assertEqual(saved['data']['appearance'], {'accent': 'rust', 'portraitFrame': frame})
                self.assertEqual(self.peer_roster_row()['exterior']['appearance']['portraitFrame'], frame)
        portrait = 'data:image/png;base64,' + base64.b64encode(host_test.PNG_ICON).decode()
        saved = self.save_items([], {'accent': 'rust', 'portrait': portrait, 'portraitFrame': base})
        self.assertEqual(saved['data']['appearance']['portrait'], portrait)
        removed = self.save_items([], {'accent': 'rust', 'portrait': '', 'portraitFrame': base})
        self.assertNotIn('portrait', removed['data']['appearance'])
        self.assertEqual(removed['data']['appearance']['portraitFrame'], base)
        self.assertEqual(self.peer_roster_row()['exterior']['appearance'], {'accent': 'rust', 'portraitFrame': base})

    def test_portrait_frame_integral_json_floats_are_normalized_to_integer_values(self):
        floating = {'fit': 'cover', 'x': 50.0, 'y': 100.0, 'zoom': 200.0, 'height': 340.0, 'effect': 'tilt'}
        expected = {'fit': 'cover', 'x': 50, 'y': 100, 'zoom': 200, 'height': 340, 'effect': 'tilt'}
        saved = self.save_items([], {'accent': 'rust', 'portraitFrame': floating})
        frame = saved['data']['appearance']['portraitFrame']
        self.assertEqual(frame, expected)
        for field in ('x', 'y', 'zoom', 'height'):
            self.assertIs(type(frame[field]), int)
        self.assertEqual(self.peer_roster_row()['exterior']['appearance']['portraitFrame'], expected)
        with sqlite3.connect(self.database) as db:
            current = json.loads(db.execute('SELECT data FROM characters WHERE id=?', (self.cid,)).fetchone()[0])
            historical = json.loads(db.execute('SELECT data FROM revisions WHERE character_id=? ORDER BY id DESC LIMIT 1',
                                               (self.cid,)).fetchone()[0])
        for data in (current, historical):
            for field in ('x', 'y', 'zoom', 'height'):
                self.assertIs(type(data['appearance']['portraitFrame'][field]), int)
        validator = host_test.mobile_host.backend.validate_portrait_frame
        for field in ('x', 'y', 'zoom', 'height'):
            for invalid in (float('nan'), float('inf'), -float('inf')):
                with self.subTest(field=field, nonfinite=str(invalid)):
                    with self.assertRaises(host_test.mobile_host.backend.APIError):
                        validator(dict(expected, **{field: invalid}))

    def test_invalid_portrait_frames_do_not_create_save_or_change_history_and_sync(self):
        saved = self.owner.request(self.path)[1]
        base = {'fit': 'contain', 'x': 50, 'y': 50, 'zoom': 100, 'height': 340, 'effect': 'off'}
        invalid = [None, True, [], 'cover', {}, dict(base, unexpected='private'),
                   dict(base, fit='fill'), dict(base, fit=True), dict(base, fit=[]),
                   dict(base, effect='url(https://example.com)'), dict(base, effect=False), dict(base, effect={})]
        invalid.extend({key: value for key, value in base.items() if key != missing} for missing in base)
        for field, lower, upper in [('x', 0, 100), ('y', 0, 100), ('zoom', 100, 300), ('height', 220, 520)]:
            invalid.extend(dict(base, **{field: value})
                           for value in (lower - 1, upper + 1, float(base[field]) + 0.5, True, str(base[field]), None))
        before = self.host.database_state()
        before_sync = self.peer.request('/api/sync')[1]['signature']
        for index, frame in enumerate(invalid):
            with self.subTest(case=index):
                data = copy.deepcopy(saved['data'])
                data['appearance']['portraitFrame'] = frame
                update = self.owner.request(self.path, 'PUT', {'version': saved['version'], 'data': data},
                                            csrf=self.owner_me['csrf'])
                self.assertEqual(update[0], 400)
                create = self.owner.request('/api/characters', 'POST', {'data': data}, csrf=self.owner_me['csrf'])
                self.assertEqual(create[0], 400)
        self.assertEqual(self.host.database_state(), before)
        self.assertEqual(self.peer.request('/api/sync')[1]['signature'], before_sync)
        self.assertEqual(self.owner.request(self.path)[1]['version'], saved['version'])

    def test_appearance_projection_copies_only_public_frame_fields(self):
        frame = {'fit': 'cover', 'x': 1, 'y': 99, 'zoom': 250, 'height': 520, 'effect': 'scan'}
        data = {'name': 'Вега', 'appearance': {'accent': 'teal', 'portraitFrame': frame,
                'privateRemark': 'Скрытая запись'}, 'notes': 'Личные записи', 'items': []}
        exterior = host_test.mobile_host.backend.character_exterior(self.cid, data)
        self.assertEqual(exterior, {'character_id': self.cid, 'name': 'Вега',
                         'appearance': {'accent': 'teal', 'portraitFrame': frame}, 'items': []})
        self.assertIsNot(exterior['appearance']['portraitFrame'], frame)

    def test_grants_require_both_accepted_source_and_accepted_viewer_and_do_not_resurrect(self):
        self.assertEqual(self.share('party')[0], 200)
        self.accept(self.peer_cid, 'reserve')
        self.assertEqual(self.peer.request(self.path)[0], 200)
        self.accept(self.peer_cid, 'remove')
        self.assertEqual(self.peer.request(self.path)[0], 404)
        self.assertNotIn('exterior', self.peer_roster_row())
        self.join(self.peer, self.peer_me, self.peer_cid)
        self.assertEqual(self.peer.request(self.path)[0], 404)
        self.accept(self.peer_cid)
        self.assertEqual(self.peer.request(self.path)[0], 200)
        self.accept(self.cid, 'remove')
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM character_sharing').fetchone()[0], 0)
        self.join(self.owner, self.owner_me, self.cid)
        self.assertEqual(self.access()['version'], 0)
        self.assertEqual(self.access()['players'], [])
        self.assertEqual(self.access()['player_ids'], [])
        self.assertEqual(self.share('party')[0], 403)
        self.assertEqual(self.peer.request(self.path)[0], 404)
        pending_roster = self.gm.request(self.campaign_path)[1]['roster']
        gm_entry = next(r for r in pending_roster if r['character_id'] == self.cid)
        self.assertIn('exterior', gm_entry)
        gm_sheet = self.gm.request(self.path)[1]
        self.assertEqual((gm_sheet['access'], gm_sheet['can_edit'], gm_sheet['can_history']), ('gm', False, True))
        self.accept(self.cid)
        self.assertEqual(self.access()['mode'], 'private')
        self.assertEqual(self.peer.request(self.path)[0], 404)

    def test_grants_are_campaign_scoped_and_invalid_requests_do_not_change_policy(self):
        other = self.host.campaign(self.gm, self.gm_me, 'Другая партия')
        self.join(self.outside, self.outside_me, self.outside_cid, other)
        self.accept(self.outside_cid, campaign=other)
        self.assertEqual(self.share('selected', [self.outside_me['id']])[0], 400)
        self.assertEqual(self.share('selected', [self.gm_me['id']])[0], 400)
        self.assertEqual(self.share('selected', [self.owner_me['id']])[0], 400)
        self.assertEqual(self.share('selected', [True])[0], 400)
        self.assertEqual(self.share('selected', [self.peer_me['id']] * 2)[0], 400)
        self.assertEqual(self.share('nobody')[0], 400)
        self.assertEqual(self.access()['version'], 0)
        self.assertEqual(self.share('party')[0], 200)
        self.assertEqual(self.outside.request(self.path)[0], 404)
        self.assertEqual(self.share('private', version=0)[0], 409)
        self.assertEqual(self.access()['mode'], 'party')
        saved = self.owner.request(self.path)[1]
        invalid_data = [saved['data'] | {'appearance': {'accent': 'rust', 'portrait': portrait}}
                        for portrait in ('https://example.com/photo.png', 'data:image/svg+xml;base64,AAAA',
                                         'data:image/png;base64,' + 'A' * 100001, True)]
        invalid_data.append(saved['data'] | {'items': [self.item('плохая-видимость', 'outer', visibility='secret')]})
        for data in invalid_data:
            result = self.owner.request(self.path, 'PUT', {'version': saved['version'], 'data': data},
                                        csrf=self.owner_me['csrf'])
            self.assertEqual(result[0], 400, result[1])
        self.assertEqual(self.owner.request(self.path)[1]['version'], saved['version'])

    def test_shared_sheet_edits_change_sync_and_owner_policy_survives_restart(self):
        self.assertEqual(self.share('selected', [self.peer_me['id']])[0], 200)
        before = self.peer.request('/api/sync')[1]['signature']
        self.save_items([self.item('пальто', 'outer')])
        self.assertNotEqual(before, self.peer.request('/api/sync')[1]['signature'])
        host_test.mobile_host.stop()
        self.host.start()
        self.assertEqual(self.peer.request(self.path)[1]['access'], 'shared')
        self.assertEqual(self.access()['player_ids'], [self.peer_me['id']])

    def test_export_does_not_include_policy_and_delete_cascades_grants(self):
        self.assertEqual(self.share('selected', [self.peer_me['id']])[0], 200)
        status, export, _ = self.gm.request(self.campaign_path + '/export')
        self.assertEqual(status, 200, export)
        self.assertNotIn('character_sharing', json.dumps(export))
        self.assertNotIn('player_ids', json.dumps(export))
        sheet = self.owner.request(self.path)[1]
        result = self.owner.request(self.path, 'DELETE', {'version': sheet['version']}, csrf=self.owner_me['csrf'])
        self.assertEqual(result[0], 200, result[1])
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM character_sharing').fetchone()[0], 0)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_portable_claim_clears_importing_owners_temporary_grants(self):
        self.assertEqual(self.share('selected', [self.peer_me['id']])[0], 200)
        status, archive, _ = self.gm.request(self.campaign_path + '/export')
        self.assertEqual(status, 200, archive)
        code = 'A' * 40
        owner_key = next(row['ownerKey'] for row in archive['content']['characters'] if row['data']['name'] == 'Вега')
        # Set up the same unclaimed binding and importing-GM ownership used by
        # a restored campaign, then exercise the public ownership claim route.
        with sqlite3.connect(self.database) as db:
            db.execute('UPDATE campaign_portable_owners SET user_id=NULL,claim_hash=? WHERE campaign_id=? AND owner_key=?',
                       (hashlib.sha256(code.encode()).hexdigest(), self.campaign['id'], owner_key))
            db.execute('UPDATE characters SET owner_id=? WHERE id=?', (self.gm_me['id'], self.cid))
        self.assertEqual(self.peer.request(self.path)[0], 200)
        result = self.outside.request('/api/campaigns/claim', 'POST', {
            'campaignUuid': archive['campaignUuid'], 'code': code}, csrf=self.outside_me['csrf'])
        self.assertEqual(result[0], 200, result[1])
        self.assertEqual(self.outside.request(self.path)[1]['access'], 'owner')
        self.assertEqual(self.peer.request(self.path)[0], 404)
        access = self.outside.request(self.access_path)[1]['campaigns'][0]
        self.assertEqual((access['version'], access['mode'], access['player_ids']), (0, 'private', []))


if __name__ == '__main__':
    unittest.main()
