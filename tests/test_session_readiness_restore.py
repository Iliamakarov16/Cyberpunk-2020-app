"""Restore preflight regressions using only disposable copies and accounts."""
from contextlib import closing
import hashlib
from pathlib import Path
import sqlite3
import unittest
from unittest.mock import patch

import test_mobile_host as fixtures

mobile_host = fixtures.mobile_host


class RestoreReadiness(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    character = fixtures.MobileHostIntegration.character
    database_state = fixtures.MobileHostIntegration.database_state

    def snapshot(self, name="candidate.sqlite3"):
        candidate = Path(self.temp.name) / name
        mobile_host.backend.backup_database(candidate)
        return candidate

    def stopped_original(self):
        mobile_host.stop()
        with closing(sqlite3.connect(self.data / "tracker.sqlite3")) as db:
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return self.host_files()

    def host_files(self):
        # SQLite's empty WAL and SHM lock bookkeeping may disappear or change
        # when unrelated fixture connections are collected. Compare persistent
        # pages and any nonempty committed WAL, not that transient bookkeeping.
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.data.glob("tracker.sqlite3*") if p.is_file()
                and (p.name == "tracker.sqlite3" or (p.name.endswith("-wal") and p.stat().st_size))}

    def reject_unchanged(self, candidate, before):
        source = candidate.read_bytes()
        with self.assertRaises(ValueError):
            mobile_host.restore(self.data, candidate)
        self.assertEqual(self.host_files(), before)
        self.assertEqual(candidate.read_bytes(), source)
        self.assertFalse(list((self.data / "backups").glob("before-restore-*.sqlite3")))
        self.assertFalse(list(self.data.glob("restore-*.sqlite3*")))

    def test_right_table_names_with_wrong_core_columns_do_not_replace_host(self):
        before = self.stopped_original()
        for table in ("users", "characters", "campaigns", "tracker_meta", "campaign_members"):
            with self.subTest(table=table):
                candidate = self.snapshot(table + ".sqlite3")
                with sqlite3.connect(candidate) as db:
                    db.execute('DROP TABLE "' + table + '"')
                    db.execute('CREATE TABLE "' + table + '" (id INTEGER PRIMARY KEY)')
                    if table == "users":
                        db.execute("INSERT INTO users VALUES(1)")
                self.reject_unchanged(candidate, before)

    def test_existing_optional_table_with_missing_columns_does_not_replace_host(self):
        before = self.stopped_original()
        for table in ("sessions", "character_sharing", "campaign_workspaces", "player_settings", "shared_battles", "shared_battle_commands"):
            with self.subTest(table=table):
                candidate = self.snapshot(table + ".sqlite3")
                with sqlite3.connect(candidate) as db:
                    db.execute('DROP TABLE "' + table + '"')
                    db.execute('CREATE TABLE "' + table + '" (id INTEGER PRIMARY KEY)')
                self.reject_unchanged(candidate, before)

    def test_missing_or_partial_upsert_constraints_do_not_replace_host(self):
        before = self.stopped_original()
        tables = ("tracker_meta", "attempts", "user_modes", "player_settings",
                  "campaign_workspaces", "campaign_portable_owners", "shared_battles", "shared_battle_commands")
        for table in tables:
            with self.subTest(table=table):
                candidate = self.snapshot(table + "-no-key.sqlite3")
                with sqlite3.connect(candidate) as db:
                    db.execute('CREATE TABLE replacement AS SELECT * FROM "' + table + '"')
                    db.execute('DROP TABLE "' + table + '"')
                    db.execute('ALTER TABLE replacement RENAME TO "' + table + '"')
                self.reject_unchanged(candidate, before)
        for kind, index in (("nonunique", "CREATE INDEX candidate_key ON tracker_meta(key)"),
                            ("partial", "CREATE UNIQUE INDEX candidate_key ON tracker_meta(key) WHERE key != ''")):
            with self.subTest(index=kind):
                candidate = self.snapshot(kind + ".sqlite3")
                with sqlite3.connect(candidate) as db:
                    db.execute("CREATE TABLE replacement AS SELECT * FROM tracker_meta")
                    db.execute("DROP TABLE tracker_meta")
                    db.execute("ALTER TABLE replacement RENAME TO tracker_meta")
                    db.execute(index)
                self.reject_unchanged(candidate, before)

    def test_equivalent_unique_index_is_accepted_and_restart_succeeds(self):
        candidate = self.snapshot()
        with sqlite3.connect(candidate) as db:
            db.execute("CREATE TABLE replacement AS SELECT * FROM tracker_meta")
            db.execute("DROP TABLE tracker_meta")
            db.execute("ALTER TABLE replacement RENAME TO tracker_meta")
            db.execute("CREATE UNIQUE INDEX equivalent_key ON tracker_meta(key)")
        self.stopped_original()
        self.assertIn("восстановлена", mobile_host.restore(self.data, candidate))
        self.start(username="", password="")
        self.gm()

    def test_invalid_owner_or_foreign_keys_do_not_replace_host(self):
        gm, owner = self.gm()
        cid = self.character(gm, owner, "Keep me")
        before = self.stopped_original()
        changes = [
            ("missing-owner", "DELETE FROM users WHERE id=1"),
            ("invalid-password", "UPDATE users SET password='unusable' WHERE id=1"),
            ("invalid-username", "UPDATE users SET username='bad username' WHERE id=1"),
            ("orphan-character", f"UPDATE characters SET owner_id=9999 WHERE id={cid}"),
        ]
        for name, sql in changes:
            with self.subTest(name=name):
                candidate = self.snapshot(name + ".sqlite3")
                with sqlite3.connect(candidate) as db:
                    db.execute(sql)
                self.reject_unchanged(candidate, before)

    def test_exact_copied_snapshot_is_rechecked_before_host_files_change(self):
        candidate = self.snapshot()
        before = self.stopped_original()
        validate = mobile_host._validate_restore_database
        calls = []

        def validate_snapshot(db):
            calls.append(db)
            validate(db)
            if len(calls) == 2:
                raise ValueError("Копия изменилась после проверки.")

        with patch.object(mobile_host, "_validate_restore_database", validate_snapshot):
            self.reject_unchanged(candidate, before)
        self.assertEqual(len(calls), 2)

    def test_legacy_011_marker_and_missing_additive_tables_restore_without_data_loss(self):
        gm, owner = self.gm()
        player, me = self.player()
        cid = self.character(player, me, "Legacy character")
        campaign = self.campaign(gm, owner)
        candidate = self.snapshot("legacy # question?.sqlite3")
        with sqlite3.connect(candidate) as db:
            db.execute("UPDATE tracker_meta SET value='0.11.0' WHERE key='portable_schema_version'")
            for table in ("character_sharing", "player_settings", "user_modes", "shared_battles", "shared_battle_commands"):
                db.execute('DROP TABLE "' + table + '"')
        expected = self.database_state(candidate)
        self.stopped_original()
        self.assertIn("восстановлена", mobile_host.restore(self.data, candidate))
        self.start(username="", password="")
        restored = self.database_state()
        for table in ("users", "characters", "campaigns", "campaign_members", "sessions", "revisions"):
            self.assertEqual(restored[table], expected[table], table)
        self.assertEqual(player.request(f"/api/characters/{cid}")[1]["data"]["name"], "Legacy character")
        self.assertEqual(gm.request(f"/api/campaigns/{campaign['id']}")[1]["name"], campaign["name"])
        for table in ("character_sharing", "player_settings", "user_modes", "shared_battles", "shared_battle_commands"):
            self.assertIn(table, restored)
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(len(list((self.data / "backups").glob("before-restore-*.sqlite3"))), 1)


if __name__ == "__main__":
    unittest.main()
