"""Atlas persistence, privacy, CAS, retry and portability regression checks."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'android/app/src/main/python'))
import crew_atlas as atlas
import server


class CrewAtlasStorage(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='crew-atlas-test-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'crew.sqlite3'
        self.handler = object.__new__(server.Handler)
        self.gm = dict(id=1, role='player')  # Mode is not campaign ownership.
        self.player = dict(id=2, role='gm')  # Mode cannot grant GM access.
        self.pending = dict(id=3, role='gm')
        self.outside = dict(id=4, role='gm')
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,role TEXT);
                CREATE TABLE campaigns(id INTEGER PRIMARY KEY,gm_id INTEGER REFERENCES users(id),
                    name TEXT,version INTEGER,updated INTEGER,transfer_to INTEGER);
                CREATE TABLE campaign_members(campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
                    user_id INTEGER REFERENCES users(id),PRIMARY KEY(campaign_id,user_id));
                CREATE TABLE characters(id INTEGER PRIMARY KEY,owner_id INTEGER REFERENCES users(id));
                CREATE TABLE campaign_characters(campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
                    character_id INTEGER REFERENCES characters(id),status TEXT);
                INSERT INTO users VALUES(1,'gm','gm'),(2,'player','player'),(3,'pending','player'),(4,'outsider','gm');
                INSERT INTO campaigns VALUES(1,1,'Main',1,0,NULL),(2,4,'Other',1,0,NULL);
                INSERT INTO campaign_members VALUES(1,2),(1,3);
                INSERT INTO characters VALUES(2,2),(3,3);
                INSERT INTO campaign_characters VALUES(1,2,'active'),(1,3,'pending');
                CREATE TABLE markers(id TEXT PRIMARY KEY,secret TEXT);
                INSERT INTO markers VALUES('unrelated','preserve');
            ''')
            db.executescript(atlas.SCHEMA)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

    def request(self, method='GET', body=None, user=None, cid=1, marker_id=None, player_view=False):
        with self.connect() as db:
            return atlas.api(self.handler, db, user or self.gm, cid, method, body,
                             marker_id=marker_id, markers=method != 'GET', player_view=player_view)

    def marker(self, **changes):
        return dict(name='Afterlife', description='Visible description', secret='PRIVATE GM NOTE',
                    x=0.123456789012345, y=1024, map='city2020', kind='location',
                    color='#f0cd66', placeId='ncs-c2-12', revealed=False, **changes)

    def create(self, marker=None, **changes):
        body = dict(id=str(uuid.uuid4()), expectedVersion=self.request()['revision'],
                    marker=marker or self.marker())
        body.update(changes)
        return self.request('POST', body), body

    def snapshot(self):
        with self.connect() as db:
            tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            return {t: [tuple(r) for r in db.execute('SELECT * FROM ' + t + ' ORDER BY rowid')] for t in tables}

    def assert_status(self, status, callback):
        with self.assertRaises((atlas.AtlasError, server.APIError)) as caught:
            callback()
        self.assertEqual(caught.exception.status, status, caught.exception.message)

    def test_empty_read_does_not_create_state_or_touch_other_tables(self):
        before = self.snapshot()
        self.assertEqual(self.request()['revision'], 0)
        self.assertEqual(self.request()['markers'], [])
        self.assertEqual(self.request(user=self.player)['role'], 'player')
        self.assertEqual(before, self.snapshot())
        with self.connect() as db:
            db.executescript(atlas.SCHEMA)
        self.assertEqual(before, self.snapshot())

    def test_exact_coordinates_source_linkage_hidden_notes_and_player_projection(self):
        marker = self.marker()
        result, _ = self.create(marker)
        saved = result['markers'][0]
        for field, value in marker.items():
            self.assertEqual(saved[field], value)
        self.assertEqual(result['revision'], 1)
        self.assertEqual(result['campaignVersion'], 2)
        self.assertEqual(self.request(user=self.player)['markers'], [])
        self.assertEqual(self.request(player_view=True)['markers'], [])
        visible = dict(marker, revealed=True)
        update = dict(id='reveal', expectedVersion=1, marker=visible)
        self.request('PUT', update, marker_id=saved['id'])
        for projected in (self.request(user=self.player), self.request(player_view=True)):
            self.assertEqual(projected['role'], 'player')
            self.assertFalse(projected['canManage'])
            self.assertEqual(len(projected['markers']), 1)
            self.assertNotIn('secret', projected['markers'][0])
            self.assertNotIn('PRIVATE', json.dumps(projected))
        queries = []
        with self.connect() as db:
            db.set_trace_callback(queries.append)
            atlas.api(self.handler, db, self.player, 1, 'GET')
        select = next(q for q in queries if q.startswith('SELECT id,name,description'))
        self.assertNotIn('secret', select)
        self.assertIn('revealed=1', select)

    def test_actual_campaign_owner_permissions_and_membership_rechecked(self):
        created, body = self.create()
        mid = created['markerId']
        for user in (self.player, self.pending):
            self.assert_status(403, lambda: self.request('POST', body, user=user))
        self.assert_status(404, lambda: self.request(user=self.outside))
        self.assert_status(403, lambda: self.request(user=self.pending))
        self.assert_status(403, lambda: self.request('POST', body, player_view=True))
        with self.connect() as db:
            db.execute("UPDATE campaign_characters SET status='reserve' WHERE character_id=3")
        self.assertEqual(self.request(user=self.pending)['role'], 'player')
        with self.connect() as db:
            db.execute('DELETE FROM campaign_members WHERE user_id=3')
        self.assert_status(403, lambda: self.request(user=self.pending))
        # A pending GM transfer does not reveal notes or grant mutation access.
        with self.connect() as db:
            db.execute('UPDATE campaigns SET transfer_to=4 WHERE id=1')
        self.assert_status(403, lambda: self.request(user=self.outside))
        self.assert_status(404, lambda: self.request('DELETE', dict(id='cross', expectedVersion=0),
                                                    cid=2, user=self.outside, marker_id=mid))

    def test_retry_once_even_after_later_updates_and_no_secret_in_receipt(self):
        created, body = self.create()
        before = self.snapshot()
        repeat = self.request('POST', dict(body, expectedVersion=99))
        self.assertTrue(repeat['duplicate'])
        self.assertEqual(repeat['receipt'], created['receipt'])
        self.assertEqual(repeat['markerId'], created['markerId'])
        self.assertEqual(before, self.snapshot())
        moved = dict(body['marker'], x=100.125, y=200.555555555)
        edit = dict(id='move', expectedVersion=1, marker=moved)
        self.request('PUT', edit, marker_id=created['markerId'])
        replay = self.request('POST', body)
        self.assertEqual(replay['revision'], 2)
        self.assertEqual(replay['markers'][0]['x'], 100.125)
        self.assertEqual(replay['receipt']['version'], 1)
        self.assertNotIn('PRIVATE', json.dumps(replay['receipt']))
        before = self.snapshot()
        self.assert_status(409, lambda: self.request('POST', dict(body, marker=moved)))
        self.assert_status(409, lambda: self.request('PUT', dict(body, expectedVersion=2), marker_id=created['markerId']))
        self.assertEqual(before, self.snapshot())

    def test_delete_idempotency_and_stale_cas(self):
        created, original = self.create()
        mid = created['markerId']
        self.assert_status(409, lambda: self.request('PUT', dict(id='stale', expectedVersion=0,
                                                                marker=original['marker']), marker_id=mid))
        remove = dict(id='remove', expectedVersion=1)
        result = self.request('DELETE', remove, marker_id=mid)
        self.assertEqual(result['markers'], [])
        before = self.snapshot()
        repeat = self.request('DELETE', remove, marker_id=mid)
        self.assertTrue(repeat['duplicate'])
        self.assertEqual(before, self.snapshot())
        self.assert_status(404, lambda: self.request('DELETE', dict(id='twice', expectedVersion=2), marker_id=mid))
        # A stale create retry cannot resurrect the removed marker.
        self.assertEqual(self.request('POST', original)['markers'], [])

    def test_two_concurrent_creates_use_single_winning_revision(self):
        def create(index):
            try:
                return self.request('POST', dict(id='race-' + str(index), expectedVersion=0,
                                                 marker=self.marker()))
            except atlas.AtlasError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(create, range(2)))
        self.assertEqual(sum(isinstance(r, dict) for r in results), 1)
        self.assertEqual(results.count(409), 1)
        self.assertEqual(len(self.request()['markers']), 1)
        self.assertEqual(self.request()['campaignVersion'], 2)

    def test_write_failure_rolls_back_marker_receipt_revision_and_campaign(self):
        before = self.snapshot()
        with patch.object(self.handler, 'bump_campaign', side_effect=sqlite3.OperationalError('disk failure')):
            with self.assertRaises(sqlite3.OperationalError):
                self.create()
        self.assertEqual(before, self.snapshot())

    def test_validation_rejects_spoofed_fields_bad_coordinates_and_types(self):
        cases = [dict(x=True), dict(y='22'), dict(x=-.01), dict(y=1024.001),
                 dict(x=float('nan')), dict(x=float('inf')), dict(x=10**1000),
                 dict(map='reference2077'), dict(map='sector:../../notes'),
                 dict(revealed='true'), dict(kind=[]), dict(color='red'),
                 dict(placeId={'id': 'ncs-a1-1'}), dict(placeId='<script>'),
                 dict(name=' '), dict(name='x' * 121), dict(secret='x' * 5001),
                 dict(owner=1), dict(role='gm'), dict(id=str(uuid.uuid4()))]
        for changes in cases:
            with self.subTest(changes=str(changes)[:100]):
                self.assert_status(400, lambda: atlas.validate_marker(dict(self.marker(), **changes)))
        for map_id, x, y in [('city2020', 0, 1024), ('synthesis', 1024, 0),
                             ('sector:B2-plaza', 6000, 3000), ('core', 1135, 1390)]:
            result = atlas.validate_marker(dict(self.marker(), map=map_id, x=x, y=y))
            self.assertEqual((result['map'], result['x'], result['y']), (map_id, x, y))
        self.assert_status(400, lambda: self.request('POST', dict(id='spoof', expectedVersion=0,
                                                                marker=self.marker(), role='gm')))
        self.assert_status(400, lambda: self.request('POST', dict(id='bad-revision', expectedVersion=True,
                                                                marker=self.marker())))

    def test_campaign_and_byte_bounds_do_not_change_state(self):
        self.create()
        before = self.snapshot()
        with patch.object(atlas, 'MAX_MARKERS', 1):
            self.assert_status(409, lambda: self.create())
        with patch.object(atlas, 'MAX_ATLAS_BYTES', 10):
            self.assert_status(409, lambda: self.create())
        self.assertEqual(before, self.snapshot())

    def test_archive_preserves_every_field_ids_precision_and_scopes_copies(self):
        created, _ = self.create()
        with self.connect() as db:
            archive = atlas.capture(db, 1)
        self.assertEqual(set(archive), {'schemaVersion', 'markers'})
        self.assertNotIn('updated', archive['markers'][0])
        self.assertEqual(atlas.validate_archive(archive), archive)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            atlas.restore_archive(db, 2, archive)
            self.assertTrue(db.in_transaction)
        imported = self.request(user=self.outside, cid=2)
        self.assertEqual(imported['markers'][0]['id'], created['markerId'])
        for key, value in archive['markers'][0].items():
            self.assertEqual(imported['markers'][0][key], value)
        with self.connect() as db:
            self.assertEqual(atlas.capture(db, 1), atlas.capture(db, 2))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM crew_atlas_commands WHERE campaign_id=2').fetchone()[0], 0)
        # Restoring into the original campaign advances revision and drops receipts.
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            atlas.restore_archive(db, 1, archive)
        self.assertEqual(self.request()['revision'], 2)
        self.assert_status(409, lambda: self.request('POST', dict(id='offline', expectedVersion=1,
                                                                 marker=self.marker())))

    def test_archive_failure_is_atomic_and_null_extension_rejected(self):
        self.create()
        before = self.snapshot()
        with self.connect() as db:
            archive = atlas.capture(db, 1)
            with self.assertRaises(RuntimeError):
                atlas.restore_archive(db, 1, archive)
        bad_archives = [None, dict(archive, schemaVersion=True), dict(archive, extra='x'),
                        dict(archive, markers=archive['markers'] * 2),
                        dict(archive, markers=[dict(archive['markers'][0], secret='x' * 5001)]),
                        dict(archive, markers=[dict(archive['markers'][0], id='fake')]),
                        dict(archive, markers=[dict(archive['markers'][0], name=' padded ')])]
        for raw in bad_archives:
            self.assert_status(400, lambda: atlas.validate_archive(raw))
        self.assertEqual(before, self.snapshot())
        with self.assertRaises(RuntimeError):
            with self.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                atlas.restore_archive(db, 1, dict(schemaVersion=1, markers=[]))
                raise RuntimeError('later transfer failure')
        self.assertEqual(before, self.snapshot())

    def test_full_sqlite_backup_contains_atlas_and_is_independent(self):
        self.create()
        backup = Path(self.temp.name) / 'snapshot.sqlite3'
        with self.connect() as source, sqlite3.connect(backup) as target:
            source.backup(target)
        with sqlite3.connect(backup) as db:
            db.row_factory = sqlite3.Row
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            saved = atlas.capture(db, 1)
        self.create()
        with sqlite3.connect(backup) as db:
            db.row_factory = sqlite3.Row
            self.assertEqual(atlas.capture(db, 1), saved)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM crew_atlas_commands').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
