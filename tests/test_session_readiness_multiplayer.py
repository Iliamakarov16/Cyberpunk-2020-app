"""Six independent LAN HTTP sessions; concurrency, privacy and retry safety."""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
import sqlite3
import threading
import unittest

import test_mobile_host as fixtures

mobile_host = fixtures.mobile_host


class MultiplayerReadiness(unittest.TestCase):
    setUp = fixtures.MobileHostIntegration.setUp
    start = fixtures.MobileHostIntegration.start
    gm = fixtures.MobileHostIntegration.gm
    player = fixtures.MobileHostIntegration.player
    campaign = fixtures.MobileHostIntegration.campaign
    character = fixtures.MobileHostIntegration.character

    def party(self):
        gm, owner = self.gm()
        campaign = self.campaign(gm, owner)
        path = f"/api/campaigns/{campaign['id']}"
        players = []
        for i in range(6):
            client, identity = self.player(f"session-player-{i}")
            cid = self.character(client, identity, f"Player {i}")
            self.assertEqual(client.request("/api/campaigns/join", "POST", {
                "code": campaign["invite_code"], "character_id": cid}, csrf=identity["csrf"])[0], 201)
            version = gm.request(path)[1]["version"]
            self.assertEqual(gm.request(path + "/roster", "POST", {
                "version": version, "character_id": cid, "status": "active"}, csrf=owner["csrf"])[0], 200)
            players.append((client, identity, cid))
        return gm, owner, path, players

    def post(self, client, identity, path, command, **fields):
        status, workspace, _ = client.request(path)
        self.assertEqual(status, 200, workspace)
        result = client.request(path, "POST", dict(version=workspace["version"], command=command, **fields),
                                csrf=identity["csrf"])
        self.assertEqual(result[0], 200, result)
        return result[1]

    def test_six_simultaneous_actions_conflict_safely_and_retry_exactly_once(self):
        gm, owner, path, players = self.party()
        workspace_path = path + "/workspace"
        self.post(gm, owner, workspace_path, "scene.save", name="Six-player rehearsal", active=True,
                  targets=[{"id": "guard", "name": "Guard", "kind": "person", "visible": True},
                           {"id": "hidden", "name": "Secret ambush", "kind": "person", "visible": False}])
        initial = gm.request(workspace_path)[1]
        initial_signatures = [client.request("/api/sync")[1]["signature"] for client, _, _ in players]
        barrier = threading.Barrier(6)

        def submit(index, player):
            client, identity, cid = player
            body = {"version": initial["version"], "command": "action.submit", "characterId": cid,
                    "targetId": "guard", "kind": "attack", "description": f"Player {index} intent",
                    "tool": "Pistol", "roll": None, "damage": None, "requestId": f"simultaneous-{index}"}
            barrier.wait(timeout=5)
            first = client.request(workspace_path, "POST", body, csrf=identity["csrf"])
            result = first
            # With six one-shot writers, at most five successful intervening
            # writers can invalidate this request's freshly fetched version.
            for _ in range(6):
                if result[0] != 409:
                    break
                body["version"] = client.request(workspace_path)[1]["version"]
                result = client.request(workspace_path, "POST", body, csrf=identity["csrf"])
            self.assertEqual(result[0], 200, result)
            retry = client.request(workspace_path, "POST", body, csrf=identity["csrf"])
            self.assertEqual(retry[0], 200, retry)
            self.assertTrue(retry[1]["duplicate"])
            self.assertEqual(retry[1]["id"], result[1]["id"])
            return first[0], result[1]["id"]

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda pair: submit(*pair), enumerate(players)))
        self.assertEqual(sorted(status for status, _ in results), [200, 409, 409, 409, 409, 409])
        self.assertEqual(len({action for _, action in results}), 6)
        saved = gm.request(workspace_path)[1]
        self.assertEqual(saved["version"], initial["version"] + 6)
        self.assertEqual(saved["campaignVersion"], initial["campaignVersion"] + 6)
        self.assertEqual(len(saved["data"]["scene"]["actions"]), 6)
        for i, (client, _, cid) in enumerate(players):
            view = client.request(workspace_path)[1]
            self.assertNotIn("Secret ambush", json.dumps(view))
            self.assertEqual([a["characterId"] for a in view["data"]["scene"]["actions"]], [cid])
            self.assertNotEqual(client.request("/api/sync")[1]["signature"], initial_signatures[i])
        mobile_host.stop()
        self.start(username="", password="")
        self.assertEqual(gm.request(workspace_path)[1], saved)
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_unread_response_then_restart_and_replay_does_not_duplicate_message(self):
        gm, owner, path, players = self.party()
        workspace_path = path + "/workspace"
        client, identity, cid = players[0]
        self.post(gm, owner, workspace_path, "contact.save", contact={
            "id": "fixer", "name": "Fixer", "notes": "GM secret", "recipients": [cid]})
        current = client.request(workspace_path)[1]
        body = {"version": current["version"], "command": "message.reply", "contactId": "fixer",
                "characterId": cid, "body": "One message despite interrupted response", "requestId": "lost-response"}
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("POST", workspace_path, json.dumps(body), {
            "Host": self.lan_host, "Origin": "http://" + self.lan_host, "Cookie": client.cookie,
            "X-CSRF-Token": identity["csrf"], "Content-Type": "application/json"})
        # Headers establish the server finished the write, but deliberately do
        # not consume the result body, as with a disconnected browser.
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        response.close()
        connection.close()
        after = gm.request(workspace_path)[1]
        self.assertEqual(len(after["data"]["messages"]), 1)
        mobile_host.stop()
        self.start(username="", password="")
        retry = client.request(workspace_path, "POST", body, csrf=identity["csrf"])
        self.assertEqual(retry[0], 200, retry)
        self.assertTrue(retry[1]["duplicate"])
        self.assertEqual(gm.request(workspace_path)[1], after)
        changed = dict(body, body="Do not accept different data under this request key")
        self.assertEqual(client.request(workspace_path, "POST", changed, csrf=identity["csrf"])[0], 409)
        self.assertEqual(gm.request(workspace_path)[1], after)
        for other, _, _ in players[1:]:
            self.assertEqual(other.request(workspace_path)[1]["data"]["messages"], [])


if __name__ == "__main__":
    unittest.main()
