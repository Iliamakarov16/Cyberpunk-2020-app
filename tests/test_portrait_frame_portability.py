"""Portrait framing preserved by real campaign export/import, including history."""
import base64
from copy import deepcopy
import json
import sqlite3
import unittest

import test_character_access as access_test
import test_mobile_host as host_test


FRAME = {"fit": "cover", "x": 23, "y": 78, "zoom": 170,
         "height": 330, "effect": "pulse"}


class PortraitFramePortabilityHTTP(unittest.TestCase):
    def setUp(self):
        # Compose the established real HTTP fixture without inheriting its tests.
        self.access = access_test.CharacterAccessHTTP(methodName="runTest")
        self.addCleanup(self.access.doCleanups)
        self.access.setUp()
        self.host = self.access.host
        self.backend = host_test.mobile_host.backend

    def export(self, client=None, campaign_path=None):
        status, archive, _ = (client or self.access.gm).request(
            (campaign_path or self.access.campaign_path) + "/export")
        self.assertEqual(status, 200, archive)
        return archive

    def vega(self, archive):
        return next(sheet for sheet in archive["content"]["characters"]
                    if sheet["data"]["name"] == "Вега")

    def import_into_fresh_host(self, archive):
        host_test.mobile_host.stop()
        self.host.data = self.host.data.parent / "portable-destination"
        self.host.start()
        gm, gm_me = self.host.gm()
        status, preview, _ = gm.request("/api/campaigns/import/preview", "POST",
                                       {"archive": archive}, csrf=gm_me["csrf"])
        self.assertEqual(status, 200, preview)
        self.assertEqual(preview["mode"], "new")
        status, imported, _ = gm.request("/api/campaigns/import", "POST",
            {"archive": archive, "token": preview["token"]}, csrf=gm_me["csrf"])
        self.assertEqual(status, 200, imported)
        self.assertEqual(imported["mode"], "new")
        return gm, "/api/campaigns/" + str(imported["id"])

    def assert_imported_history(self, expected_sheet):
        with sqlite3.connect(self.host.data / "tracker.sqlite3") as db:
            row = db.execute("SELECT character_id FROM character_portability WHERE uuid=?",
                             (expected_sheet["uuid"],)).fetchone()
            self.assertIsNotNone(row)
            cid = row[0]
            current = json.loads(db.execute("SELECT data FROM characters WHERE id=?",
                                             (cid,)).fetchone()[0])
            revisions = db.execute("""SELECT version,reason,created,data FROM revisions
                                      WHERE character_id=? ORDER BY id""", (cid,)).fetchall()
        self.assertEqual(current, expected_sheet["data"])
        self.assertEqual([(version, reason, created, json.loads(data))
                          for version, reason, created, data in revisions],
                         [(revision["version"], revision["reason"], revision["created"],
                           revision["data"]) for revision in expected_sheet["revisions"]])

    def test_legacy_archive_and_revisions_do_not_gain_default_frame_or_new_fingerprint(self):
        archive = self.export()
        self.assertEqual((archive["formatVersion"], archive["apiVersion"]), (1, 1))
        for sheet in archive["content"]["characters"]:
            for data in [sheet["data"]] + [r["data"] for r in sheet["revisions"]]:
                self.assertEqual(data["schemaVersion"], 2)
                self.assertNotIn("portraitFrame", data["appearance"])
                self.assertEqual(self.backend.canonical(self.backend.validate_character(data)),
                                 self.backend.canonical(data))
        self.assertEqual(self.backend.validate_archive(deepcopy(archive)), archive)
        # ExportedAt and ancestor bookkeeping may change; the content must not.
        self.assertEqual(self.export()["fingerprint"], archive["fingerprint"])
        expected = self.vega(archive)
        gm, path = self.import_into_fresh_host(archive)
        self.assert_imported_history(expected)
        returned = self.export(gm, path)
        self.assertEqual(returned["content"], archive["content"])
        self.assertEqual(returned["fingerprint"], archive["fingerprint"])

    def test_current_frame_and_full_revision_data_survive_portrait_removal_and_transfer(self):
        initial = self.export()
        portrait = "data:image/png;base64," + base64.b64encode(host_test.PNG_ICON).decode()
        self.access.save_items([], {"accent": "teal", "portrait": portrait,
                                    "portraitFrame": dict(FRAME)})
        with_portrait = self.export()
        self.assertNotEqual(with_portrait["fingerprint"], initial["fingerprint"])
        # Removing the image keeps its chosen framing for a later replacement.
        self.access.save_items([], {"accent": "teal", "portraitFrame": dict(FRAME)})
        archive = self.export()
        expected = self.vega(archive)
        self.assertEqual(expected["data"]["appearance"],
                         {"accent": "teal", "portraitFrame": FRAME})
        self.assertEqual(expected["data"]["schemaVersion"], 2)
        self.assertNotIn("portraitFrame", expected["revisions"][0]["data"]["appearance"])
        self.assertEqual(expected["revisions"][-2]["data"]["appearance"],
                         {"accent": "teal", "portrait": portrait, "portraitFrame": FRAME})
        self.assertEqual(expected["revisions"][-1]["data"], expected["data"])
        self.assertEqual(self.backend.validate_archive(deepcopy(archive)), archive)
        gm, path = self.import_into_fresh_host(archive)
        self.assert_imported_history(expected)
        returned = self.export(gm, path)
        self.assertEqual(returned["content"], archive["content"])
        self.assertEqual(returned["fingerprint"], archive["fingerprint"])

    def test_import_rejects_malformed_current_and_revision_frames_without_mutations(self):
        self.access.save_items([], {"accent": "rust", "portraitFrame": dict(FRAME)})
        archive = self.export()
        before = self.host.database_state()
        cases = [
            ("current boolean coordinate", False, dict(FRAME, x=True)),
            ("current partial frame", False, {"fit": "contain"}),
            ("revision unknown field", True, dict(FRAME, privateNote="discard me")),
            ("revision out of bounds", True, dict(FRAME, height=521)),
        ]
        for name, historical, frame in cases:
            with self.subTest(case=name):
                invalid = deepcopy(archive)
                sheet = self.vega(invalid)
                data = sheet["revisions"][-1]["data"] if historical else sheet["data"]
                data["appearance"]["portraitFrame"] = frame
                # A correct digest must not excuse malformed current/history data.
                invalid["fingerprint"] = self.backend.content_fingerprint(invalid["content"])
                status, _, _ = self.access.gm.request("/api/campaigns/import/preview", "POST",
                    {"archive": invalid}, csrf=self.access.gm_me["csrf"])
                self.assertEqual(status, 400)
                self.assertEqual(self.host.database_state(), before)

    def test_visual_edit_invalidates_archive_checksum_before_import(self):
        self.access.save_items([], {"accent": "rust", "portraitFrame": dict(FRAME)})
        archive = self.export()
        changed = deepcopy(archive)
        self.vega(changed)["data"]["appearance"]["portraitFrame"]["x"] += 1
        before = self.host.database_state()
        status, result, _ = self.access.gm.request("/api/campaigns/import/preview", "POST",
            {"archive": changed}, csrf=self.access.gm_me["csrf"])
        self.assertEqual(status, 400, result)
        self.assertIn("контрольная сумма", result["error"])
        self.assertEqual(self.host.database_state(), before)

    def test_integral_float_frames_are_canonical_equivalent_in_current_and_history(self):
        self.access.save_items([], {"accent": "rust", "portraitFrame": dict(FRAME)})
        archive = self.export()
        equivalent = deepcopy(archive)
        sheet = self.vega(equivalent)
        numeric_keys = ("x", "y", "zoom", "height")
        framed_count = 0
        for data in [sheet["data"]] + [r["data"] for r in sheet["revisions"]]:
            frame = data["appearance"].get("portraitFrame")
            if frame is None:
                continue
            before = self.backend.canonical(data)
            for key in numeric_keys:
                frame[key] = float(frame[key])
            framed_count += 1
            self.assertEqual(self.backend.canonical(data), before)
            normalized = self.backend.validate_character(data)["appearance"]["portraitFrame"]
            self.assertEqual(normalized, FRAME)
            for key in numeric_keys:
                self.assertIs(type(normalized[key]), int, key)
        self.assertGreaterEqual(framed_count, 2, "Current data and a saved revision must be exercised")
        self.assertEqual(self.backend.content_fingerprint(equivalent["content"]),
                         archive["fingerprint"])
        self.assertEqual(self.backend.validate_archive(equivalent)["fingerprint"],
                         archive["fingerprint"])
        # Real JSON transport preserves 23.0 spelling, then preview validates
        # both the current character and historical snapshots against that digest.
        status, preview, _ = self.access.gm.request("/api/campaigns/import/preview", "POST",
            {"archive": equivalent}, csrf=self.access.gm_me["csrf"])
        self.assertEqual(status, 200, preview)
        self.assertEqual(preview["mode"], "unchanged")
        self.assertEqual(preview["sourceFingerprint"], archive["fingerprint"])
        self.assertEqual(preview["destinationFingerprint"], archive["fingerprint"])


if __name__ == "__main__":
    unittest.main()
