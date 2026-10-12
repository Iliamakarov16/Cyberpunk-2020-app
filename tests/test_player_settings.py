"""Preferences exercised through the actual Android host HTTP / SQLite boundary.

Run from the bundle root with:
    python3 -m unittest discover -s tests -p 'test_*.py' -v
"""
import json
import sqlite3
import unittest

import test_mobile_host as host_test


class PlayerSettingsHTTP(unittest.TestCase):
    def setUp(self):
        # Reuse the existing temporary host fixture without inheriting its tests.
        self.host = host_test.MobileHostIntegration(methodName="runTest")
        self.addCleanup(self.host.doCleanups)
        self.host.setUp()
        self.gm, self.owner = self.host.gm()
        self.player, self.me = self.host.player()
        self.database = self.host.data / "tracker.sqlite3"

    def saved_row(self, user_id):
        with sqlite3.connect(self.database) as db:
            return db.execute("SELECT data,updated FROM player_settings WHERE user_id=?", (user_id,)).fetchone()

    def put(self, client, user, prefs):
        return client.request("/api/settings", "PUT", prefs, csrf=user["csrf"])

    def test_default_preferences_and_app_version_are_available_without_writes(self):
        defaults = {"hints": True, "tutorial": True, "animations": True, "ambient": "quiet"}
        for client, user in ((self.gm, self.owner), (self.player, self.me)):
            status, actual, _ = client.request("/api/settings")
            self.assertEqual(status, 200)
            self.assertEqual(actual, defaults)
            self.assertIsNone(self.saved_row(user["id"]))
        self.assertEqual(self.gm.request("/api/version")[1], {"version": "0.17.7", "apiVersion": 1})

    def test_existing_three_boolean_preferences_gain_quiet_background_without_rewriting(self):
        legacy = {"hints": False, "tutorial": True, "animations": False}
        encoded = json.dumps(legacy)
        with sqlite3.connect(self.database) as db:
            db.execute("INSERT INTO player_settings(user_id,data,updated) VALUES(?,?,?)",
                       (self.me["id"], encoded, 123456))
        status, actual, _ = self.player.request("/api/settings")
        self.assertEqual(status, 200)
        self.assertEqual(actual, legacy | {"ambient": "quiet"})
        self.assertEqual(self.saved_row(self.me["id"]), (encoded, 123456))
        self.assertEqual(self.gm.request("/api/settings")[1]["ambient"], "quiet")

    def test_all_background_modes_persist_per_account_across_host_restart(self):
        owner_prefs = {"hints": False, "tutorial": False, "animations": True, "ambient": "off"}
        self.assertEqual(self.put(self.gm, self.owner, owner_prefs)[0], 200)
        for ambient in ("quiet", "vivid", "off"):
            with self.subTest(ambient=ambient):
                player_prefs = {"hints": True, "tutorial": False, "animations": False, "ambient": ambient}
                status, actual, _ = self.put(self.player, self.me, player_prefs)
                self.assertEqual(status, 200)
                self.assertEqual(actual, player_prefs)
                self.assertEqual(self.player.request("/api/settings")[1], player_prefs)
                self.assertEqual(self.gm.request("/api/settings")[1], owner_prefs)

        host_test.mobile_host.stop()
        self.host.start()
        fresh_gm, _ = self.host.gm()
        fresh_player = host_test.HTTPClient(self.host.port, self.host.lan_host)
        self.assertEqual(fresh_player.request("/api/login", "POST", {
            "username": "table-player", "password": self.host.player_password,
        })[0], 200)
        self.assertEqual(fresh_player.request("/api/settings")[1], player_prefs)
        self.assertEqual(fresh_gm.request("/api/settings")[1], owner_prefs)
        self.assertEqual(json.loads(self.saved_row(self.me["id"])[0]), player_prefs)

    def test_version_upgrade_preserves_legacy_preferences_and_creates_existing_backup(self):
        legacy = {"hints": False, "tutorial": True, "animations": False}
        encoded = json.dumps(legacy)
        character_id = self.host.character(self.player, self.me, "Сохранённый персонаж")
        with sqlite3.connect(self.database) as db:
            db.execute("INSERT INTO player_settings(user_id,data,updated) VALUES(?,?,?)",
                       (self.me["id"], encoded, 123456))
            db.execute("UPDATE tracker_meta SET value='0.11.0' WHERE key='portable_schema_version'")
        host_test.mobile_host.stop()
        self.host.start()
        self.assertEqual(self.player.request("/api/settings")[1], legacy | {"ambient": "quiet"})
        self.assertEqual(self.saved_row(self.me["id"]), (encoded, 123456))
        self.assertEqual(self.player.request(f"/api/characters/{character_id}")[0], 200)
        backups = list((self.host.data / "backups").glob("migration-*.sqlite3"))
        self.assertEqual(len(backups), 1)
        with sqlite3.connect(backups[0]) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(db.execute("SELECT data,updated FROM player_settings WHERE user_id=?",
                                        (self.me["id"],)).fetchone(), (encoded, 123456))
            self.assertEqual(db.execute("SELECT value FROM tracker_meta WHERE key='portable_schema_version'").fetchone()[0], "0.11.0")
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute("SELECT value FROM tracker_meta WHERE key='portable_schema_version'").fetchone()[0], "0.17.7")

    def test_legacy_updates_preserve_selected_background_and_fresh_accounts_default_quiet(self):
        legacy = {"hints": False, "tutorial": True, "animations": False}
        status, actual, _ = self.put(self.player, self.me, legacy)
        self.assertEqual(status, 200)
        self.assertEqual(actual, legacy | {"ambient": "quiet"})
        for ambient in ("vivid", "off", "quiet"):
            with self.subTest(ambient=ambient):
                selected = {"hints": True, "tutorial": False, "animations": True, "ambient": ambient}
                self.assertEqual(self.put(self.player, self.me, selected)[0], 200)
                status, actual, _ = self.put(self.player, self.me, legacy)
                self.assertEqual(status, 200)
                self.assertEqual(actual, legacy | {"ambient": ambient})
                self.assertEqual(self.player.request("/api/settings")[1], actual)
                self.assertEqual(json.loads(self.saved_row(self.me["id"])[0]), actual)

    def test_invalid_payloads_do_not_mutate_preferences_and_other_sessions_cannot_write(self):
        saved = {"hints": False, "tutorial": False, "animations": True, "ambient": "vivid"}
        self.assertEqual(self.put(self.player, self.me, saved)[0], 200)
        before = self.saved_row(self.me["id"])
        invalid = [
            saved | {"ambient": value} for value in ("bright", "", None, True, 1, [], {})
        ] + [
            saved | {"hints": 1}, saved | {"tutorial": "true"},
            saved | {"animations": None}, saved | {"user_id": self.owner["id"]},
            {key: value for key, value in saved.items() if key != "animations"}, {},
        ]
        for payload in invalid:
            with self.subTest(payload=payload):
                self.assertEqual(self.put(self.player, self.me, payload)[0], 400)
                self.assertEqual(self.saved_row(self.me["id"]), before)
        self.assertEqual(self.player.request("/api/settings", "PUT", saved | {"ambient": "off"},
                                             csrf=self.owner["csrf"])[0], 403)
        anonymous = host_test.HTTPClient(self.host.port, self.host.lan_host)
        self.assertEqual(anonymous.request("/api/settings")[0], 401)
        self.assertEqual(anonymous.request("/api/settings", "PUT", saved, csrf=self.me["csrf"])[0], 401)
        self.assertEqual(self.saved_row(self.me["id"]), before)
        self.assertIsNone(self.saved_row(self.owner["id"]))


if __name__ == "__main__":
    unittest.main()
