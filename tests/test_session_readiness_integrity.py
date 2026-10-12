"""Temporary HTTP/SQLite dress rehearsal for a multiplayer session.

These checks never use a real host, campaign, or private data directory.
Run: python3 -m unittest discover -s tests -p test_session_readiness_integrity.py -v
"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

import test_mobile_host as fixtures

mobile_host = fixtures.mobile_host


class SessionReadinessIntegrity(unittest.TestCase):
    # Reuse only fixture helpers, rather than inheriting the existing tests.
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    character = fixtures.MobileHostIntegration.character

    def session(self):
        gm, owner = self.gm()
        player, me = self.player()
        cid = self.character(player, me, "Session rehearsal")
        campaign = self.campaign(gm, owner)
        return gm, owner, player, me, cid, campaign

    def test_join_approval_duplicate_and_stale_roster_survive_restart(self):
        gm, owner, player, me, cid, campaign = self.session()
        path = f"/api/campaigns/{campaign['id']}"
        join = {"character_id": cid,
                "code": " - ".join(campaign["invite_code"].lower()[i:i + 4]
                                   for i in range(0, 20, 4))}
        self.assertEqual(player.request("/api/campaigns/join", "POST", join, csrf=me["csrf"])[0], 201)
        pending = player.request(path)[1]
        self.assertFalse(pending["is_member"])
        self.assertEqual(pending["roster"][0]["status"], "pending")
        for secret in ("invite_code", "gm_notes", "ledger", "members"):
            self.assertNotIn(secret, pending)
        current = gm.request(path)[1]
        self.assertEqual(player.request("/api/campaigns/join", "POST", join, csrf=me["csrf"])[0], 409)
        self.assertEqual(gm.request(path)[1]["version"], current["version"])
        roster = {"version": current["version"], "character_id": cid, "status": "active"}
        self.assertEqual(player.request(path + "/roster", "POST", roster, csrf=me["csrf"])[0], 404)
        self.assertEqual(gm.request(path + "/roster", "POST", roster, csrf=owner["csrf"])[0], 200)
        roster["status"] = "remove"
        self.assertEqual(gm.request(path + "/roster", "POST", roster, csrf=owner["csrf"])[0], 409)
        accepted = player.request(path)[1]
        self.assertTrue(accepted["is_member"])
        self.assertEqual(accepted["roster"][0]["status"], "active")
        mobile_host.stop()
        self.start(username="", password="")
        self.assertEqual(player.request("/api/me")[1]["id"], me["id"])
        self.assertEqual(gm.request("/api/me")[1]["id"], owner["id"])
        self.assertEqual(player.request(path)[1], accepted)
        self.assertEqual(player.request("/api/users")[0], 403)

    def test_simultaneous_owner_and_gm_save_one_revision_without_lost_update(self):
        gm, owner, player, me, cid, campaign = self.session()
        path = f"/api/campaigns/{campaign['id']}"
        self.assertEqual(player.request("/api/campaigns/join", "POST", {
            "character_id": cid, "code": campaign["invite_code"]}, csrf=me["csrf"])[0], 201)
        version = gm.request(path)[1]["version"]
        self.assertEqual(gm.request(path + "/roster", "POST", {
            "version": version, "character_id": cid, "status": "active"}, csrf=owner["csrf"])[0], 200)
        path = f"/api/characters/{cid}"
        before = player.request(path)[1]
        barrier = threading.Barrier(2)

        def save(client, identity, label):
            data = dict(before["data"], notes=label)
            barrier.wait(timeout=3)
            status, body, _ = client.request(path, "PUT", {
                "version": before["version"], "data": data, "reason": label}, csrf=identity["csrf"])
            return status, label, body

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(save, player, me, "Player concurrent save")
            second = pool.submit(save, gm, owner, "GM concurrent save")
            results = [first.result(timeout=6), second.result(timeout=6)]
        self.assertEqual(sorted(row[0] for row in results), [200, 409], results)
        winner = next(row[1] for row in results if row[0] == 200)
        saved = player.request(path)[1]
        self.assertEqual(saved["version"], before["version"] + 1)
        self.assertEqual(saved["data"]["notes"], winner)
        history = player.request(path + "/history")[1]
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["reason"], winner)
        mobile_host.stop()
        self.start(username="", password="")
        self.assertEqual(player.request(path)[1], saved)
        self.assertEqual(player.request(path + "/history")[1], history)

    def test_graceful_stop_drains_an_inflight_character_save(self):
        _, _, player, me, cid, _ = self.session()
        path = f"/api/characters/{cid}"
        before = player.request(path)[1]
        reached, release = threading.Event(), threading.Event()
        validate = mobile_host.backend.validate_character

        def blocked_validate(data):
            reached.set()
            if not release.wait(timeout=5):
                raise AssertionError("Test did not release the in-flight request")
            return validate(data)

        with ThreadPoolExecutor(max_workers=2) as pool:
            with patch.object(mobile_host.backend, "validate_character", blocked_validate):
                write = pool.submit(player.request, path, "PUT", {
                    "version": before["version"], "data": dict(before["data"], cash=4242),
                    "reason": "In flight at shutdown"}, me["csrf"])
                self.assertTrue(reached.wait(timeout=3))
                stopping = pool.submit(mobile_host.stop)
                try:
                    time.sleep(0.65)
                    self.assertFalse(stopping.done(), "Stop returned before its active write completed")
                finally:
                    release.set()
                self.assertEqual(write.result(timeout=5)[0], 200)
                self.assertFalse(json.loads(stopping.result(timeout=5))["running"])
        self.start(username="", password="")
        after = player.request(path)[1]
        self.assertEqual(after["data"]["cash"], 4242)
        self.assertEqual(after["version"], before["version"] + 1)
        self.assertEqual(player.request(path + "/history")[1][0]["reason"], "In flight at shutdown")

    def test_acknowledged_save_survives_abrupt_host_process_death(self):
        _, _, player, me, cid, _ = self.session()
        path = f"/api/characters/{cid}"
        before = player.request(path)[1]
        mobile_host.stop()
        python_dir = Path(mobile_host.__file__).parent
        program = ("import json,sys,time; sys.path.insert(0,sys.argv[1]); import mobile_host; "
                   "result=json.loads(mobile_host.start(sys.argv[2],sys.argv[3],sys.argv[4],'','',int(sys.argv[5]))); "
                   "print(json.dumps(result),flush=True); time.sleep(60)")
        child = subprocess.Popen([sys.executable, "-u", "-c", program, str(python_dir),
                                  str(self.data), str(self.payload), "192.168.43.1", str(self.port)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            state = json.loads(child.stdout.readline())
            self.assertTrue(state["running"], state)
            self.assertEqual(player.request(path, "PUT", {
                "version": before["version"], "data": dict(before["data"], notes="Acknowledged before process kill"),
                "reason": "Crash persistence rehearsal"}, csrf=me["csrf"])[0], 200)
            child.kill()
            child.wait(timeout=5)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stdout.close()
            child.stderr.close()
        self.start(username="", password="")
        after = player.request(path)[1]
        self.assertEqual(after["data"]["notes"], "Acknowledged before process kill")
        self.assertEqual(after["version"], before["version"] + 1)
        self.assertEqual(player.request(path + "/history")[1][0]["reason"], "Crash persistence rehearsal")
        with sqlite3.connect(self.data / "tracker.sqlite3") as database:
            self.assertEqual(database.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(database.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
