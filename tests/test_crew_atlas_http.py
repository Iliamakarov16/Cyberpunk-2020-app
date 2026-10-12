"""Actual Crew HTTP sessions, Atlas sharing and campaign transfer integration."""
import copy
import json
from pathlib import Path
import sqlite3
import unittest
import uuid

import test_mobile_host as fixtures


class CrewAtlasHTTP(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    character = fixtures.MobileHostIntegration.character
    database_state = fixtures.MobileHostIntegration.database_state

    def party(self):
        self.owner, self.owner_me = self.gm()
        campaign = self.campaign(self.owner, self.owner_me)
        self.base = '/api/campaigns/' + str(campaign['id'])
        self.path = self.base + '/atlas'
        self.peer, self.peer_me = self.player('atlas-player')
        self.character_id = self.character(self.peer, self.peer_me)
        joined = self.peer.request('/api/campaigns/join', 'POST',
            dict(code=campaign['invite_code'], character_id=self.character_id), csrf=self.peer_me['csrf'])
        self.assertEqual(joined[0], 201, joined)
        self.assertEqual(self.peer.request(self.path)[0], 403)
        version = self.owner.request(self.base)[1]['version']
        accepted = self.owner.request(self.base + '/roster', 'POST',
            dict(version=version, character_id=self.character_id, status='active'), csrf=self.owner_me['csrf'])
        self.assertEqual(accepted[0], 200, accepted)
        self.assertEqual(self.owner.request(self.path)[0], 200)
        self.assertEqual(self.peer.request(self.path)[0], 200)

    def create(self, revealed=False, map_id='city2020', **overrides):
        marker = dict(name='Атлас · тайник', description='Открытый текст', secret='ATLAS PRIVATE GM SECRET',
                      x=123.98765432101234, y=512.25, map=map_id,
                      placeId='ncs-a1-1', kind='mission', color='#bcefdb', revealed=revealed)
        marker.update(overrides)
        body = dict(id=str(uuid.uuid4()), expectedVersion=self.owner.request(self.path)[1]['revision'], marker=marker)
        result = self.owner.request(self.path + '/markers', 'POST', body, csrf=self.owner_me['csrf'])
        self.assertEqual(result[0], 200, result)
        return result[1], body

    def test_real_sessions_no_spoofing_csrf_origin_private_notes_and_reveal(self):
        self.party()
        created, body = self.create()
        mid = created['markerId']
        self.assertEqual(self.peer.request(self.path + '?view=gm&role=gm')[1]['markers'], [])
        # Changing app mode is not campaign ownership.
        changed = self.peer.request('/api/mode', 'POST', dict(mode='gm'), csrf=self.peer_me['csrf'])
        self.assertEqual(changed[0], 200, changed)
        before = self.database_state()
        denied = self.peer.request(self.path + '/markers?view=gm', 'POST', body, csrf=self.peer_me['csrf'])
        self.assertEqual(denied[0], 403, denied)
        self.assertEqual(self.owner.request(self.path + '/markers', 'POST', body)[0], 403)
        self.assertEqual(self.owner.request(self.path + '/markers', 'POST', body,
                                           csrf=self.owner_me['csrf'], origin='https://untrusted.invalid')[0], 403)
        outsider = fixtures.HTTPClient(self.port)
        self.assertEqual(outsider.request(self.path)[0], 401)
        self.assertEqual(before, self.database_state())
        update = dict(id='reveal', expectedVersion=1, marker=dict(body['marker'], revealed=True))
        result = self.owner.request(self.path + '/markers/' + mid, 'PUT', update, csrf=self.owner_me['csrf'])
        self.assertEqual(result[0], 200, result)
        for client, query in ((self.peer, '?view=gm'), (self.owner, '?view=player')):
            status, visible, headers = client.request(self.path + query)
            self.assertEqual(status, 200)
            self.assertEqual(visible['role'], 'player')
            self.assertFalse(visible['canManage'])
            self.assertEqual(visible['markers'][0]['x'], body['marker']['x'])
            self.assertNotIn('secret', visible['markers'][0])
            self.assertNotIn('ATLAS PRIVATE', json.dumps(visible))
            self.assertIn('no-store', headers.get('Cache-Control', ''))
        self.assertEqual(self.peer.request(self.base + '/export')[0], 403)
        with sqlite3.connect(self.data / 'tracker.sqlite3') as db:
            db.execute("UPDATE campaign_characters SET status='pending' WHERE character_id=?", (self.character_id,))
        self.assertEqual(self.peer.request(self.path)[0], 403)

    def test_real_edit_move_delete_conflict_retry_and_restart(self):
        self.party()
        created, body = self.create(revealed=True, map_id='sector:B2-plaza', x=1234.567890123, y=3333.75)
        mid = created['markerId']
        marker_path = self.path + '/markers/' + mid
        moved = dict(body['marker'], x=2234.567890123, name='Moved pin')
        command = dict(id='move-once', expectedVersion=1, marker=moved)
        result = self.owner.request(marker_path, 'PUT', command, csrf=self.owner_me['csrf'])
        self.assertEqual(result[0], 200, result)
        before = self.database_state()
        retry = self.owner.request(marker_path, 'PUT', command, csrf=self.owner_me['csrf'])
        self.assertTrue(retry[1]['duplicate'], retry)
        self.assertEqual(before, self.database_state())
        stale = self.owner.request(marker_path, 'PUT', dict(command, id='stale'), csrf=self.owner_me['csrf'])
        self.assertEqual(stale[0], 409, stale)
        state = self.owner.request(self.path)[1]
        fixtures.mobile_host.stop()
        self.start(username='', password='')
        self.assertEqual(self.owner.request(self.path)[1], state)
        remove = dict(id='delete-once', expectedVersion=2)
        deleted = self.owner.request(marker_path, 'DELETE', remove, csrf=self.owner_me['csrf'])
        self.assertEqual(deleted[0], 200, deleted)
        self.assertEqual(deleted[1]['markers'], [])
        retry = self.owner.request(marker_path, 'DELETE', remove, csrf=self.owner_me['csrf'])
        self.assertTrue(retry[1]['duplicate'], retry)
        self.assertEqual(self.peer.request(self.path)[1]['markers'], [])

    def test_export_import_and_old_format_compatibility_preserve_marker_content(self):
        self.party()
        created, _ = self.create(revealed=True)
        self.create(map_id='sector:B2-plaza', x=2234.875, y=3456.123456789, placeId='core-01')
        status, archive, _ = self.owner.request(self.base + '/export')
        self.assertEqual(status, 200, archive)
        atlas = archive['content']['atlas']
        self.assertEqual(len(atlas['markers']), 2)
        self.assertTrue(all('secret' in m for m in atlas['markers']))
        self.assertNotIn('receipt', json.dumps(atlas))
        legacy = copy.deepcopy(archive)
        del legacy['content']['atlas']
        legacy['fingerprint'] = fixtures.mobile_host.backend.content_fingerprint(legacy['content'])
        self.assertEqual(fixtures.mobile_host.backend.validate_archive(legacy), legacy)
        fixtures.mobile_host.stop()
        self.data = self.data.parent / 'atlas-destination'
        self.start()
        owner, me = self.gm()
        status, preview, _ = owner.request('/api/campaigns/import/preview', 'POST',
                                           dict(archive=archive), csrf=me['csrf'])
        self.assertEqual(status, 200, preview)
        status, imported, _ = owner.request('/api/campaigns/import', 'POST',
            dict(archive=archive, token=preview['token']), csrf=me['csrf'])
        self.assertEqual(status, 200, imported)
        base = '/api/campaigns/' + str(imported['id'])
        status, state, _ = owner.request(base + '/atlas')
        self.assertEqual(status, 200, state)
        self.assertIn(created['markerId'], [m['id'] for m in state['markers']])
        projected = [{k: v for k, v in m.items() if k != 'updated'} for m in state['markers']]
        self.assertEqual(sorted(projected, key=lambda m: m['id']), atlas['markers'])
        exported = owner.request(base + '/export')
        self.assertEqual(exported[0], 200, exported)
        self.assertEqual(exported[1]['content']['atlas'], atlas)
        with sqlite3.connect(self.data / 'tracker.sqlite3') as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM crew_atlas_commands').fetchone()[0], 0)

    def test_restore_preflight_rejects_bad_atlas_columns_and_missing_unique_targets(self):
        self.party()
        self.create()
        fixtures.mobile_host.stop()
        for table in ('crew_atlas_state', 'crew_atlas_markers', 'crew_atlas_commands'):
            for bad_key in (False, True):
                with self.subTest(table=table, bad_key=bad_key):
                    candidate = Path(self.temp.name) / (table + '-' + str(bad_key) + '.sqlite3')
                    fixtures.mobile_host.backend.backup_database(candidate)
                    with sqlite3.connect(candidate) as db:
                        if bad_key:
                            db.execute('CREATE TABLE replacement AS SELECT * FROM ' + table)
                            db.execute('DROP TABLE ' + table)
                            db.execute('ALTER TABLE replacement RENAME TO ' + table)
                        else:
                            db.execute('DROP TABLE ' + table)
                            db.execute('CREATE TABLE ' + table + '(id TEXT PRIMARY KEY)')
                    with self.assertRaises(ValueError):
                        fixtures.mobile_host.restore(self.data, candidate)

    def test_legacy_full_backup_missing_atlas_tables_restores_and_initializes(self):
        self.party()
        candidate = Path(self.temp.name) / 'pre-atlas.sqlite3'
        fixtures.mobile_host.backend.backup_database(candidate)
        with sqlite3.connect(candidate) as db:
            for table in ('crew_atlas_commands', 'crew_atlas_markers', 'crew_atlas_state'):
                db.execute('DROP TABLE ' + table)
        original = self.peer.request('/api/characters/' + str(self.character_id))[1]
        fixtures.mobile_host.stop()
        self.assertIn('восстановлена', fixtures.mobile_host.restore(self.data, candidate))
        self.start(username='', password='')
        self.assertEqual(self.peer.request('/api/characters/' + str(self.character_id))[1], original)
        self.assertEqual(self.owner.request(self.path)[1]['markers'], [])
        self.assertEqual(self.peer.request(self.path)[1]['markers'], [])
        self.create(revealed=True)


if __name__ == '__main__':
    unittest.main()
