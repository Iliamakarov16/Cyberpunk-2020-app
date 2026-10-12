"""Real HTTP / SQLite checks for the Android GM host adapter.

Run from the bundle root with:
    python3 -m unittest discover -s tests -p test_mobile_host.py -v

All sockets and databases are temporary. LAN requests use the declared LAN
Host and Origin while connecting through loopback, so they exercise the actual
HTTP handler without requiring a Wi-Fi interface on the build machine.
"""
import base64
import errno
import hashlib
import http.client
from http.cookies import SimpleCookie
import json
import os
from pathlib import Path
import plistlib
import secrets
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "android/app/src/main/python"))
import mobile_host  # noqa: E402


DEFAULT_ORIGIN = object()
PNG_ICON = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n9sAAAAASUVORK5CYII="
)


class HTTPClient:
    """Independent browser session over a real HTTP connection."""

    def __init__(self, port, host=None):
        self.port = port
        self.host = host or f"127.0.0.1:{port}"
        self.cookie = ""

    def request(self, path, method="GET", payload=None, csrf="", origin=DEFAULT_ORIGIN,
                host=None, fetch_site=None):
        headers = {"Host": host or self.host}
        if origin is DEFAULT_ORIGIN:
            headers["Origin"] = "http://" + headers["Host"]
        elif origin is not None:
            headers["Origin"] = origin
        if self.cookie:
            headers["Cookie"] = self.cookie
        if csrf:
            headers["X-CSRF-Token"] = csrf
        if fetch_site:
            headers["Sec-Fetch-Site"] = fetch_site
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            response_headers = dict(response.getheaders())
            raw = response.read()
            if response_headers.get("Set-Cookie"):
                cookie = SimpleCookie(response_headers["Set-Cookie"])
                self.cookie = "; ".join(f"{name}={value.value}" for name, value in cookie.items())
            result = json.loads(raw) if response_headers.get("Content-Type", "").startswith("application/json") else raw
            return response.status, result, response_headers
        finally:
            connection.close()


class MobileHostIntegration(unittest.TestCase):
    def setUp(self):
        mobile_host.stop()
        self.temp = tempfile.TemporaryDirectory(prefix="nightcity-mobile-test-")
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(mobile_host.stop)
        log_patch = patch.object(mobile_host.backend.Handler, "log_message", lambda *args: None)
        log_patch.start()
        self.addCleanup(log_patch.stop)
        self.data = Path(self.temp.name) / "private"
        self.payload = Path(self.temp.name) / "payload"
        (self.payload / "static/icons").mkdir(parents=True)
        (self.payload / "static/index.html").write_text("<!doctype html><title>NC test</title>", encoding="utf-8")
        (self.payload / "static/icons/apple-touch-icon.png").write_bytes(PNG_ICON)
        with socket.socket() as socket_probe:
            socket_probe.bind(("127.0.0.1", 0))
            self.port = socket_probe.getsockname()[1]
        self.lan_host = f"192.168.43.1:{self.port}"
        self.gm_password = "gm-" + secrets.token_urlsafe(22)
        self.player_password = "player-" + secrets.token_urlsafe(22)
        self.start()

    def start(self, lan="192.168.43.1", username="table-gm", password=None):
        result = json.loads(mobile_host.start(
            str(self.data), str(self.payload), lan, username,
            self.gm_password if password is None else password, self.port,
        ))
        self.assertTrue(result["running"], result)
        self.assertEqual(result["error"], "")
        return result

    def gm(self, host=None):
        client = HTTPClient(self.port, host)
        status, result, _ = client.request("/api/login", "POST", {
            "username": "table-gm", "password": self.gm_password,
        })
        self.assertEqual(status, 200, result)
        status, me, _ = client.request("/api/me")
        self.assertEqual(status, 200, me)
        self.assertTrue(me["admin"])
        return client, me

    def player(self, username="table-player"):
        client = HTTPClient(self.port, self.lan_host)
        status, result, _ = client.request("/api/register", "POST", {
            "username": username, "password": self.player_password,
        })
        self.assertEqual(status, 201, result)
        status, me, _ = client.request("/api/me")
        self.assertEqual(status, 200, me)
        self.assertFalse(me["admin"])
        return client, me

    def campaign(self, client, me, name="Телефон ведущего"):
        status, result, _ = client.request("/api/campaigns", "POST", {
            "name": name, "description": "За одним столом",
        }, csrf=me["csrf"])
        self.assertEqual(status, 201, result)
        status, detail, _ = client.request(f"/api/campaigns/{result['id']}")
        self.assertEqual(status, 200, detail)
        return detail

    def character(self, client, me, name="Игрок"):
        data = {"name": name, "role": "Соло", "notes": "Личные записи", "cash": 1200,
                "stats": {stat: 6 for stat in mobile_host.backend.STATS}}
        status, result, _ = client.request("/api/characters", "POST", {"data": data}, csrf=me["csrf"])
        self.assertEqual(status, 201, result)
        return result["id"]

    def database_state(self, database=None):
        """Compare every logical table, including private and portable game data."""
        with sqlite3.connect(database or self.data / "tracker.sqlite3") as db:
            tables = [row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            return {name: db.execute('SELECT * FROM "' + name.replace('"', '""') + '" ORDER BY rowid').fetchall()
                    for name in tables}

    def recovery_backups(self, data=None):
        return list(((data or self.data) / "backups").glob("before-owner-recovery-*.sqlite3"))

    def authenticated_first_start(self, authenticate=True):
        mobile_host.stop()
        self.data = Path(self.temp.name) / ("first-owner-" + secrets.token_hex(6))
        result = json.loads(mobile_host.start(
            self.data, self.payload, "192.168.43.1", "table-gm", self.gm_password,
            self.port, authenticate,
        ))
        self.assertTrue(result["running"])
        self.assertEqual(result["error"], "")
        return result

    def initial_owner_client(self, result):
        cookies = SimpleCookie(result["initial_session_cookie"])
        self.assertEqual(set(cookies), {mobile_host.backend.COOKIE})
        self.assertTrue(cookies[mobile_host.backend.COOKIE]["httponly"])
        self.assertEqual(cookies[mobile_host.backend.COOKIE]["path"], "/")
        client = HTTPClient(self.port)
        client.cookie = mobile_host.backend.COOKIE + "=" + cookies[mobile_host.backend.COOKIE].value
        return client

    def test_initial_owner_handoff_is_real_verified_http_session_without_status_leak(self):
        result = self.authenticated_first_start()
        self.assertNotIn("initial_login_warning", result)
        owner = self.initial_owner_client(result)
        status, me, _ = owner.request("/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(me["id"], 1)
        self.assertEqual(me["role"], "gm")
        self.assertTrue(me["admin"])
        current = json.loads(mobile_host.status())
        self.assertEqual(set(current), {"running", "lan_url", "local_url", "error"})
        self.assertNotIn("initial_session_cookie", mobile_host._status)
        self.assertNotIn("initial_login_warning", mobile_host._status)
        self.assertNotIn(owner.cookie, mobile_host.status())
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            # The actual login route writes its explicit GM mode and hashes the
            # session token; initialization alone cannot produce these rows.
            self.assertEqual(db.execute("SELECT * FROM user_modes").fetchall(), [(1, "gm")])
            stored = db.execute("SELECT token,user_id FROM sessions").fetchall()
            self.assertEqual(len(stored), 1)
            self.assertEqual(stored[0][1], 1)
            raw_token = owner.cookie.split("=", 1)[1]
            self.assertEqual(stored[0][0], hashlib.sha256(raw_token.encode()).hexdigest())
        for saved_file in self.data.rglob("*"):
            if saved_file.is_file():
                self.assertNotIn(raw_token.encode(), saved_file.read_bytes(), saved_file)
                self.assertNotIn(self.gm_password.encode(), saved_file.read_bytes(), saved_file)

    def test_initial_owner_handoff_never_repeats_or_grants_existing_owner_access(self):
        result = self.authenticated_first_start()
        self.initial_owner_client(result)
        before = self.database_state()
        repeated = json.loads(mobile_host.start(
            self.data, self.payload, "192.168.43.1", "table-gm", self.gm_password,
            self.port, True,
        ))
        self.assertNotIn("initial_session_cookie", repeated)
        self.assertNotIn("initial_login_warning", repeated)
        self.assertEqual(self.database_state(), before)
        mobile_host.stop()
        existing = json.loads(mobile_host.start(
            self.data, self.payload, "192.168.43.1", "ignored-name", "ignored-password",
            self.port, True,
        ))
        self.assertTrue(existing["running"])
        self.assertNotIn("initial_session_cookie", existing)
        self.assertNotIn("initial_login_warning", existing)
        self.assertEqual(self.database_state()["sessions"], before["sessions"])

    def test_initial_owner_handoff_requires_identity_true_opt_in(self):
        for authenticate in (False, None, 0, 1, "true", [], {}):
            with self.subTest(authentication_type=type(authenticate).__name__):
                result = self.authenticated_first_start(authenticate)
                self.assertNotIn("initial_session_cookie", result)
                self.assertNotIn("initial_login_warning", result)
                with sqlite3.connect(self.data / "tracker.sqlite3") as db:
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)

    def test_initial_owner_setup_rejects_unusable_password_before_creating_database(self):
        mobile_host.stop()
        for password in ("a" * 11, "a" * 257, "a" * 11 + "\ud800"):
            with self.subTest(length=len(password)):
                data = Path(self.temp.name) / ("invalid-first-owner-" + secrets.token_hex(6))
                result = json.loads(mobile_host.start(
                    data, self.payload, "192.168.43.1", "table-gm", password, self.port, True,
                ))
                self.assertFalse(result["running"])
                self.assertTrue(result["error"])
                self.assertNotIn("initial_session_cookie", result)
                self.assertFalse(data.exists())

    def test_initial_owner_handoff_login_failure_preserves_host_and_safe_manual_login(self):
        real_login = mobile_host._initial_owner_cookie
        def wrong_credentials(username, password, port):
            return real_login(username, password + "-wrong", port)
        with patch.object(mobile_host, "_initial_owner_cookie", side_effect=wrong_credentials):
            result = self.authenticated_first_start()
        self.assertNotIn("initial_session_cookie", result)
        self.assertIn("initial_login_warning", result)
        self.assertNotIn(self.gm_password, result["initial_login_warning"])
        self.assertTrue(json.loads(mobile_host.status())["running"])
        self.assertNotIn("initial_login_warning", json.loads(mobile_host.status()))
        self.assertFalse(mobile_host.needs_setup(self.data))
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)
        self.gm()

    def test_initial_owner_handoff_requires_verified_owner_response(self):
        real_respond = mobile_host.backend.Handler.respond
        def mismatched_owner_response(handler, status, payload, *args, **kwargs):
            if handler.path == "/api/me" and status == 200:
                payload = dict(payload, id=2, admin=False, role="player")
            return real_respond(handler, status, payload, *args, **kwargs)
        with patch.object(mobile_host.backend.Handler, "respond", mismatched_owner_response):
            result = self.authenticated_first_start()
        self.assertNotIn("initial_session_cookie", result)
        self.assertIn("initial_login_warning", result)
        self.assertTrue(json.loads(mobile_host.status())["running"])
        self.gm()

    def test_initial_owner_handoff_is_invalidated_by_recovery_without_new_grant(self):
        initial = self.authenticated_first_start()
        owner = self.initial_owner_client(initial)
        player, peer = self.player()
        recovered = json.loads(mobile_host.recover_owner_password(self.data, "new-owner-password", True))
        self.assertTrue(recovered["ok"])
        self.assertTrue(recovered["running"])
        self.assertNotIn("initial_session_cookie", recovered)
        self.assertEqual(owner.request("/api/me")[0], 401)
        self.assertEqual(player.request("/api/me")[1]["id"], peer["id"])
        repeated = json.loads(mobile_host.start(
            self.data, self.payload, "192.168.43.1", "table-gm", "new-owner-password",
            self.port, True,
        ))
        self.assertNotIn("initial_session_cookie", repeated)

    def test_initial_owner_handoff_is_not_issued_after_restoring_existing_owner(self):
        self.authenticated_first_start()
        snapshot = Path(mobile_host.backup())
        mobile_host.stop()
        mobile_host.restore(self.data, snapshot)
        restored = json.loads(mobile_host.start(
            self.data, self.payload, "192.168.43.1", "table-gm", self.gm_password,
            self.port, True,
        ))
        self.assertTrue(restored["running"])
        self.assertNotIn("initial_session_cookie", restored)
        self.assertNotIn("initial_login_warning", restored)

    def test_native_owner_recovery_preserves_all_game_data_and_peer_access(self):
        gm, owner = self.gm()
        other_gm_session, _ = self.gm()
        player, peer = self.player()
        peer_id = peer["id"]
        campaign = self.campaign(gm, owner)
        character_id = self.character(player, peer, "Сохраняется при восстановлении")
        path = f"/api/campaigns/{campaign['id']}"
        self.assertEqual(player.request("/api/campaigns/join", "POST", {
            "code": campaign["invite_code"], "character_id": character_id,
        }, csrf=peer["csrf"])[0], 201)
        local_owner_bucket = hashlib.sha256(b"127.0.0.1:table-gm").hexdigest()
        peer_bucket = hashlib.sha256(b"127.0.0.1:table-player").hexdigest()
        registration_bucket = hashlib.sha256(b"register:127.0.0.1").hexdigest()
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            db.execute("UPDATE campaigns SET gm_notes=?,ledger=? WHERE id=?",
                       ("Секрет и планы ведущего", "Евродоллары 900", campaign["id"]))
            db.execute("INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count",
                       (local_owner_bucket, 8, int(time.time())))
            db.execute("INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count",
                       (peer_bucket, 4, int(time.time())))
            db.execute("INSERT INTO attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count",
                       (registration_bucket, 3, int(time.time())))
        before = self.database_state()
        old_hash = next(row[2] for row in before["users"] if row[0] == 1)
        new_password = "  Новый пароль ведущего  "
        result = json.loads(mobile_host.recover_owner_password(self.data, new_password, True))
        self.assertEqual(result, {"ok": True, "username": "table-gm", "running": True, "error": ""})
        backups = self.recovery_backups()
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)
        self.assertEqual(backups[0].parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.database_state(backups[0]), before)
        after = self.database_state()
        for table, records in before.items():
            if table not in {"users", "sessions", "attempts"}:
                self.assertEqual(after[table], records, table)
        expected_users = [row for row in before["users"] if row[0] != 1]
        self.assertEqual([row for row in after["users"] if row[0] != 1], expected_users)
        recovered_owner = next(row for row in after["users"] if row[0] == 1)
        self.assertEqual(recovered_owner[:2] + recovered_owner[3:],
                         next(row[:2] + row[3:] for row in before["users"] if row[0] == 1))
        self.assertNotEqual(recovered_owner[2], old_hash)
        self.assertTrue(mobile_host.backend.check_password(new_password, recovered_owner[2]))
        self.assertFalse(mobile_host.backend.check_password(new_password.strip(), recovered_owner[2]))
        self.assertFalse(mobile_host.backend.check_password(self.gm_password, recovered_owner[2]))
        self.assertEqual(after["sessions"], [row for row in before["sessions"] if row[1] != 1])
        self.assertEqual(after["attempts"], [row for row in before["attempts"] if row[0] != local_owner_bucket])
        self.assertEqual(gm.request("/api/me")[0], 401)
        self.assertEqual(other_gm_session.request("/api/me")[0], 401)
        self.assertEqual(player.request("/api/me")[1]["id"], peer_id)
        self.assertEqual(player.request(f"/api/characters/{character_id}")[0], 200)
        old_login = HTTPClient(self.port)
        self.assertEqual(old_login.request("/api/login", "POST", {
            "username": "table-gm", "password": self.gm_password,
        })[0], 401)
        new_login = HTTPClient(self.port)
        self.assertEqual(new_login.request("/api/login", "POST", {
            "username": result["username"], "password": new_password,
        })[0], 200)
        self.assertEqual(new_login.request(path)[1]["gm_notes"], "Секрет и планы ведущего")
        for saved_file in self.data.rglob("*"):
            if saved_file.is_file():
                self.assertNotIn(new_password.encode(), saved_file.read_bytes(), saved_file)

    def test_native_owner_recovery_requires_exact_device_authentication_before_work(self):
        before = self.database_state()
        for authenticated in (False, None, 0, 1, "true", [], {}, object()):
            with self.subTest(authentication_type=type(authenticated).__name__):
                with patch.object(mobile_host.backend, "password_hash", side_effect=AssertionError("Must not hash")):
                    with self.assertRaisesRegex(ValueError, "блокировку телефона"):
                        mobile_host.recover_owner_password(self.data, "new-owner-password", authenticated)
                self.assertEqual(self.database_state(), before)
                self.assertFalse(self.recovery_backups())
        with self.assertRaises(ValueError):
            mobile_host.recover_owner_password(self.data, "new-owner-password")

    def test_native_owner_recovery_rejects_invalid_passwords_before_mutations(self):
        before = self.database_state()
        for password in (None, True, 123456789012, b"new-owner-password", "", "a" * 11, "a" * 257, "a" * 11 + "\ud800"):
            with self.subTest(password_type=type(password).__name__, length=len(password) if isinstance(password, str) else None):
                with self.assertRaises(ValueError):
                    mobile_host.recover_owner_password(self.data, password, True)
                self.assertEqual(self.database_state(), before)
                self.assertFalse(self.recovery_backups())

    def test_native_owner_recovery_accepts_exact_minimum_and_maximum_password_lengths(self):
        for password in (" 1234567890 ", " " + "界" * 254 + " "):
            with self.subTest(length=len(password)):
                result = json.loads(mobile_host.recover_owner_password(self.data, password, True))
                self.assertEqual(result["username"], "table-gm")
                with sqlite3.connect(self.data / "tracker.sqlite3") as db:
                    encoded = db.execute("SELECT password FROM users WHERE id=1").fetchone()[0]
                self.assertTrue(mobile_host.backend.check_password(password, encoded))
                self.assertFalse(mobile_host.backend.check_password(password.strip(), encoded))

    def test_native_owner_recovery_rejects_running_server_directory_mismatch(self):
        other = Path(self.temp.name) / "another-host"
        other.mkdir()
        with sqlite3.connect(self.data / "tracker.sqlite3") as source, sqlite3.connect(other / "tracker.sqlite3") as target:
            source.backup(target)
        before = self.database_state()
        other_before = self.database_state(other / "tracker.sqlite3")
        with self.assertRaisesRegex(ValueError, "другой локальный сервер"):
            mobile_host.recover_owner_password(other, "new-owner-password", True)
        self.assertEqual(self.database_state(), before)
        self.assertEqual(self.database_state(other / "tracker.sqlite3"), other_before)
        self.assertFalse(self.recovery_backups())
        self.assertFalse(self.recovery_backups(other))

    def test_native_owner_recovery_rejects_missing_corrupt_or_incomplete_database(self):
        mobile_host.stop()
        corrupt = Path(self.temp.name) / "corrupt-owner"
        corrupt.mkdir()
        (corrupt / "tracker.sqlite3").write_bytes(b"not a sqlite database")
        incomplete = Path(self.temp.name) / "incomplete-owner"
        incomplete.mkdir()
        with sqlite3.connect(incomplete / "tracker.sqlite3") as db:
            db.execute("CREATE TABLE users(id INTEGER PRIMARY KEY)")
        missing = Path(self.temp.name) / "never-started-owner"
        before = self.database_state()
        for candidate in (None, "", missing, corrupt, incomplete):
            with self.subTest(candidate_type=type(candidate).__name__):
                with self.assertRaises(ValueError):
                    mobile_host.recover_owner_password(candidate, "new-owner-password", True)
                self.assertEqual(self.database_state(), before)
                self.assertFalse(self.recovery_backups())
        self.assertFalse(missing.exists())
        self.assertEqual((corrupt / "tracker.sqlite3").read_bytes(), b"not a sqlite database")
        self.assertFalse(self.recovery_backups(corrupt))
        self.assertFalse(self.recovery_backups(incomplete))

    def test_native_owner_recovery_rejects_missing_owner_without_creating_account(self):
        mobile_host.stop()
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            db.execute("DELETE FROM users WHERE id=1")
        before = self.database_state()
        with self.assertRaisesRegex(ValueError, "нет аккаунта владельца"):
            mobile_host.recover_owner_password(self.data, "new-owner-password", True)
        self.assertEqual(self.database_state(), before)
        self.assertFalse(self.recovery_backups())

    def test_native_owner_recovery_rejects_invalid_saved_owner_before_mutations(self):
        mobile_host.stop()
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            db.execute("UPDATE users SET password='invalid-saved-password-hash' WHERE id=1")
        before = self.database_state()
        with self.assertRaisesRegex(ValueError, "Аккаунт владельца повреждён"):
            mobile_host.recover_owner_password(self.data, "new-owner-password", True)
        self.assertEqual(self.database_state(), before)
        self.assertFalse(self.recovery_backups())

    def test_native_owner_recovery_backup_failure_keeps_credentials_and_sessions(self):
        self.gm()
        player, peer = self.player()
        before = self.database_state()
        real_open = mobile_host.os.open
        def fail_recovery_backup(path, flags, mode=0o777):
            if "before-owner-recovery" in str(path):
                raise PermissionError("Private backup unavailable")
            return real_open(path, flags, mode)
        with patch.object(mobile_host.os, "open", side_effect=fail_recovery_backup):
            with self.assertRaisesRegex(ValueError, "безопасно восстановить"):
                mobile_host.recover_owner_password(self.data, "new-owner-password", True)
        self.assertEqual(self.database_state(), before)
        self.assertFalse(self.recovery_backups())
        self.assertFalse(list((self.data / "backups").glob("*.tmp")))
        self.assertTrue(json.loads(mobile_host.status())["running"])
        self.assertEqual(player.request("/api/me")[1]["id"], peer["id"])
        self.gm()

    def test_native_owner_recovery_drains_previously_verified_old_password_login(self):
        player, peer = self.player()
        verified = threading.Event()
        allow_session = threading.Event()
        stopping = threading.Event()
        recovery_done = threading.Event()
        responses = {}
        real_issue = mobile_host.backend.Handler.issue_session
        real_stop = mobile_host.stop

        def paused_issue(handler, db, account_id, now):
            if account_id == 1:
                verified.set()
                if not allow_session.wait(timeout=5):
                    raise RuntimeError("Old login was not released")
            return real_issue(handler, db, account_id, now)

        def observed_stop():
            stopping.set()
            return real_stop()

        old_login = HTTPClient(self.port)
        def request_old_login():
            try:
                responses["login"] = old_login.request("/api/login", "POST", {
                    "username": "table-gm", "password": self.gm_password,
                })[0]
            except Exception as error:
                responses["login_error"] = type(error).__name__

        def perform_recovery():
            try:
                responses["recovery"] = json.loads(mobile_host.recover_owner_password(
                    self.data, "new-owner-password", True))
            except Exception as error:
                responses["recovery_error"] = type(error).__name__
            finally:
                recovery_done.set()

        with patch.object(mobile_host.backend.Handler, "issue_session", paused_issue), patch.object(mobile_host, "stop", observed_stop):
            login_thread = threading.Thread(target=request_old_login)
            recovery_thread = threading.Thread(target=perform_recovery)
            login_thread.start()
            self.assertTrue(verified.wait(timeout=5), "Old password login was not verified")
            recovery_thread.start()
            try:
                self.assertTrue(stopping.wait(timeout=5), "Recovery did not drain the host")
                self.assertFalse(recovery_done.is_set(), "Recovery must wait for the verified login handler")
            finally:
                allow_session.set()
                login_thread.join(timeout=10)
                recovery_thread.join(timeout=10)
        self.assertFalse(login_thread.is_alive())
        self.assertFalse(recovery_thread.is_alive())
        self.assertNotIn("login_error", responses)
        self.assertNotIn("recovery_error", responses)
        self.assertEqual(responses["login"], 200)
        self.assertTrue(responses["recovery"]["running"])
        self.assertEqual(old_login.request("/api/me")[0], 401)
        self.assertEqual(player.request("/api/me")[1]["id"], peer["id"])
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions WHERE user_id=1").fetchone()[0], 0)

    def test_native_owner_recovery_can_run_stopped_without_starting_a_listener(self):
        self.gm()
        mobile_host.stop()
        result = json.loads(mobile_host.recover_owner_password(self.data, "new-owner-password", True))
        self.assertEqual(result, {"ok": True, "username": "table-gm", "running": False, "error": ""})
        self.assertIsNone(mobile_host._http)
        self.assertEqual(len(self.recovery_backups()), 1)
        self.start(username="", password="")
        login = HTTPClient(self.port)
        self.assertEqual(login.request("/api/login", "POST", {
            "username": result["username"], "password": "new-owner-password",
        })[0], 200)

    def test_native_owner_recovery_reports_listener_restart_failure_after_safe_reset(self):
        self.gm()
        self.player()
        before = self.database_state()
        with patch.object(mobile_host.backend, "ThreadingHTTPServer", side_effect=OSError("Listener restart unavailable")):
            result = json.loads(mobile_host.recover_owner_password(self.data, "new-owner-password", True))
        self.assertTrue(result["ok"])
        self.assertEqual(result["username"], "table-gm")
        self.assertFalse(result["running"])
        self.assertIn("restart unavailable", result["error"])
        self.assertIsNone(mobile_host._http)
        self.assertEqual(self.database_state(self.recovery_backups()[0]), before)
        with sqlite3.connect(self.data / "tracker.sqlite3") as db:
            encoded = db.execute("SELECT password FROM users WHERE id=1").fetchone()[0]
            self.assertTrue(mobile_host.backend.check_password("new-owner-password", encoded))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sessions WHERE user_id=1").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT * FROM sessions ORDER BY rowid").fetchall(),
                             [row for row in before["sessions"] if row[1] != 1])
        self.start(username="", password="")

    def test_no_http_recovery_bypass_even_for_loopback_or_authenticated_owner(self):
        gm, owner = self.gm()
        player, peer = self.player()
        anonymous = HTTPClient(self.port)
        before = self.database_state()
        for client, csrf in ((anonymous, ""), (gm, owner["csrf"]), (player, peer["csrf"])):
            for path in ("/api/recover-account", "/mobile/recover-account", "/api/recover-owner-password", "/api/reset-password"):
                with self.subTest(path=path, authenticated=bool(csrf)):
                    status, _, _ = client.request(path, "POST", {
                        "device_authenticated": True, "password": "new-owner-password",
                    }, csrf=csrf)
                    self.assertIn(status, (401, 404))
        # Existing own-password API still requires the current password.
        self.assertEqual(gm.request("/api/password", "POST", {
            "old": "forgotten-old-password", "new": "new-owner-password", "device_authenticated": True,
        }, csrf=owner["csrf"])[0], 400)
        # Admin management never permits resetting the owner's own account.
        self.assertEqual(gm.request("/api/users/1/password", "POST", {
            "password": "new-owner-password", "device_authenticated": True,
        }, csrf=owner["csrf"])[0], 400)
        self.assertEqual(player.request("/api/users/1/password", "POST", {
            "password": "new-owner-password", "device_authenticated": True,
        }, csrf=peer["csrf"])[0], 403)
        self.assertEqual(self.database_state(), before)
        self.assertFalse(self.recovery_backups())

    def test_loopback_lan_and_missing_origin_keep_host_and_csrf_protection(self):
        gm, owner = self.gm()
        self.campaign(gm, owner)
        player, me = self.player()
        self.assertNotEqual(gm.cookie, player.cookie)
        self.assertNotEqual(owner["csrf"], me["csrf"])
        self.assertEqual(player.request("/api/mode", "POST", {"mode": "player"}, csrf=me["csrf"])[0], 200)

        for bad_origin in (f"http://127.0.0.1:{self.port}", "https://attacker.example", "null"):
            with self.subTest(origin=bad_origin):
                self.assertEqual(player.request("/api/mode", "POST", {"mode": "gm"},
                    csrf=me["csrf"], origin=bad_origin)[0], 403)
        self.assertEqual(player.request("/api/me", host=f"attacker.example:{self.port}")[0], 403)
        self.assertEqual(player.request("/api/mode", "POST", {"mode": "gm"},
            csrf=me["csrf"], fetch_site="cross-site")[0], 403)
        self.assertEqual(player.request("/api/mode", "POST", {"mode": "player"},
            csrf=me["csrf"], origin=None)[0], 200)
        for missing_or_wrong_csrf in ("", "wrong", owner["csrf"]):
            with self.subTest(csrf=missing_or_wrong_csrf):
                self.assertEqual(player.request("/api/mode", "POST", {"mode": "gm"},
                    csrf=missing_or_wrong_csrf, origin=None)[0], 403)
        self.assertEqual(player.request("/api/me")[1]["role"], "player")
        localhost, localhost_owner = self.gm(f"localhost:{self.port}")
        self.assertEqual(localhost.request("/api/mode", "POST", {"mode": "gm"},
            csrf=localhost_owner["csrf"])[0], 200)

    def test_lan_player_cannot_gain_campaign_secrets_or_manage_other_sheets(self):
        gm, owner = self.gm()
        player, me = self.player()
        outsider, outside_me = self.player("outsider")
        campaign = self.campaign(gm, owner)
        path = f"/api/campaigns/{campaign['id']}"
        saved = {"version": campaign["version"], "name": campaign["name"],
                 "description": campaign["description"], "gm_notes": "Секрет ведущего", "ledger": "Доход 500"}
        self.assertEqual(gm.request(path, "PUT", saved, csrf=owner["csrf"])[0], 200)
        self.assertEqual(player.request(path)[0], 404)
        player_char = self.character(player, me)
        outsider_char = self.character(outsider, outside_me, "Личный запасной")
        self.assertEqual(player.request("/api/campaigns/join", "POST", {
            "code": campaign["invite_code"], "character_id": outsider_char,
        }, csrf=me["csrf"])[0], 404)
        self.assertEqual(player.request("/api/campaigns/join", "POST", {
            "code": campaign["invite_code"], "character_id": player_char,
        }, csrf=me["csrf"])[0], 201)
        player_view = player.request(path)[1]
        for key in ("gm_notes", "ledger", "invite_code", "members"):
            self.assertNotIn(key, player_view)
        campaign = gm.request(path)[1]
        roster = {"version": campaign["version"], "character_id": player_char, "status": "active"}
        self.assertEqual(player.request(path + "/roster", "POST", roster, csrf=me["csrf"])[0], 404)
        self.assertEqual(gm.request(path + "/roster", "POST", roster, csrf=owner["csrf"])[0], 200)
        self.assertTrue(player.request(path)[1]["is_member"])
        self.assertEqual(outsider.request(path)[0], 404)
        self.assertEqual(gm.request(f"/api/characters/{outsider_char}")[0], 404)
        self.assertEqual(player.request(f"/api/characters/{outsider_char}")[0], 404)
        self.assertEqual(player.request("/api/mode", "POST", {"mode": "gm"}, csrf=me["csrf"])[0], 200)
        self.assertNotIn("gm_notes", player.request(path)[1])
        self.assertEqual(player.request(path, "PUT", saved, csrf=me["csrf"])[0], 404)
        self.assertEqual(player.request("/api/users")[0], 403)

    def test_restart_preserves_accounts_characters_and_hashed_passwords(self):
        gm, owner = self.gm()
        player, me = self.player()
        character_id = self.character(player, me, "До перезапуска")
        campaign = self.campaign(gm, owner)
        self.assertFalse(mobile_host.needs_setup(self.data))
        first_thread = mobile_host._thread
        mobile_host.stop()
        self.assertFalse(first_thread.is_alive())
        self.start(username="ignored-name", password="ignored-replacement-password")
        gm_after, _ = self.gm()
        player_after = HTTPClient(self.port, self.lan_host)
        self.assertEqual(player_after.request("/api/login", "POST", {
            "username": "table-player", "password": self.player_password,
        })[0], 200)
        self.assertEqual(player_after.request(f"/api/characters/{character_id}")[1]["data"]["name"], "До перезапуска")
        self.assertEqual(gm_after.request(f"/api/campaigns/{campaign['id']}")[1]["name"], campaign["name"])
        with sqlite3.connect(self.data / "tracker.sqlite3") as database:
            hashes = dict(database.execute("SELECT username,password FROM users"))
            self.assertEqual(len(hashes), 2)
            for username, password in (("table-gm", self.gm_password), ("table-player", self.player_password)):
                self.assertNotEqual(hashes[username], password)
                self.assertRegex(hashes[username], r"^[a-f0-9]{32}:[a-f0-9]{128}$")
                self.assertTrue(mobile_host.backend.check_password(password, hashes[username]))
        for saved_file in self.data.rglob("*"):
            if saved_file.is_file():
                raw = saved_file.read_bytes()
                self.assertNotIn(self.gm_password.encode(), raw, saved_file)
                self.assertNotIn(self.player_password.encode(), raw, saved_file)
        self.assertNotIn("ADMIN_PASSWORD", os.environ)

    def test_consistent_live_backup_restore_keeps_original_and_previous_state(self):
        gm, owner = self.gm()
        player, me = self.player()
        character_id = self.character(player, me, "В резервной копии")
        campaign = self.campaign(gm, owner)
        path = f"/api/campaigns/{campaign['id']}"
        with sqlite3.connect(self.data / "tracker.sqlite3") as writer:
            writer.execute("BEGIN IMMEDIATE")
            writer.execute("UPDATE campaigns SET gm_notes='Незавершённая запись' WHERE id=?", (campaign["id"],))
            snapshot = Path(mobile_host.backup())
            with sqlite3.connect(snapshot) as backup:
                self.assertEqual(backup.execute("PRAGMA integrity_check").fetchone()[0], "ok")
                self.assertEqual(backup.execute("SELECT gm_notes FROM campaigns WHERE id=?", (campaign["id"],)).fetchone()[0], "")
                self.assertEqual(backup.execute("SELECT id FROM characters").fetchall(), [(character_id,)])
            writer.rollback()
        source_digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
        saved = {"version": campaign["version"], "name": campaign["name"],
                 "description": campaign["description"], "gm_notes": "После резервирования", "ledger": ""}
        self.assertEqual(gm.request(path, "PUT", saved, csrf=owner["csrf"])[0], 200)
        later_character = self.character(player, me, "После резервирования")
        with self.assertRaisesRegex(ValueError, "Остановите сервер"):
            mobile_host.restore(self.data, snapshot)
        self.assertEqual(gm.request(path)[1]["gm_notes"], "После резервирования")
        mobile_host.stop()
        result = mobile_host.restore(self.data, snapshot)
        self.assertIn("восстановлена", result)
        self.assertEqual(hashlib.sha256(snapshot.read_bytes()).hexdigest(), source_digest)
        preserved = list((self.data / "backups").glob("before-restore-*.sqlite3"))
        self.assertEqual(len(preserved), 1)
        with sqlite3.connect(preserved[0]) as previous:
            self.assertEqual(previous.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(previous.execute("SELECT gm_notes FROM campaigns").fetchone()[0], "После резервирования")
            self.assertIn((later_character,), previous.execute("SELECT id FROM characters").fetchall())
        self.start(username="", password="")
        restored_gm, _ = self.gm()
        self.assertEqual(restored_gm.request(path)[1]["gm_notes"], "")
        with sqlite3.connect(self.data / "tracker.sqlite3") as restored:
            self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(restored.execute("SELECT id FROM characters").fetchall(), [(character_id,)])

    def test_invalid_restore_does_not_replace_host_database(self):
        mobile_host.stop()
        database = self.data / "tracker.sqlite3"
        # Snapshot committed pages, rather than an uncheckpointed main file:
        # closing an unrelated connection during GC can otherwise checkpoint WAL.
        settled = sqlite3.connect(database)
        try:
            settled.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            settled.close()
        original = database.read_bytes()
        corrupt = Path(self.temp.name) / "not-a-database.sqlite3"
        corrupt.write_text("Not SQLite", encoding="utf-8")
        incomplete = Path(self.temp.name) / "other-app.sqlite3"
        with sqlite3.connect(incomplete) as other:
            other.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        oversized = Path(self.temp.name) / "oversized.sqlite3"
        with oversized.open("wb") as file:
            file.truncate(100 * 1024 * 1024 + 1)
        for candidate in (corrupt, incomplete, database, oversized, Path(self.temp.name) / "missing.sqlite3"):
            with self.subTest(candidate=candidate.name):
                with self.assertRaises(ValueError):
                    mobile_host.restore(self.data, candidate)
                self.assertEqual(database.read_bytes(), original)
        self.assertFalse(list((self.data / "backups").glob("before-restore-*.sqlite3")))

    def test_iphone_installation_serves_only_removable_webclip_for_current_lan(self):
        unauthenticated = HTTPClient(self.port, self.lan_host)
        status, page, headers = unauthenticated.request("/mobile/install-ios", origin=None)
        self.assertEqual(status, 200)
        self.assertTrue(headers["Content-Type"].startswith("text/html"))
        self.assertIn(f"http://{self.lan_host}/".encode(), page)
        self.assertIn("Safari".encode(), page)
        self.assertIn(b"/mobile/iphone.mobileconfig", page)
        status, raw_profile, headers = unauthenticated.request("/mobile/iphone.mobileconfig", origin=None)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/x-apple-aspen-config")
        profile = plistlib.loads(raw_profile)
        self.assertEqual(profile["PayloadType"], "Configuration")
        self.assertFalse(profile["PayloadRemovalDisallowed"])
        self.assertEqual(len(profile["PayloadContent"]), 1)
        clip = profile["PayloadContent"][0]
        self.assertEqual(clip["PayloadType"], "com.apple.webClip.managed")
        self.assertEqual(clip["URL"], f"http://{self.lan_host}/")
        self.assertTrue(clip["IsRemovable"])
        self.assertTrue(clip["FullScreen"])
        self.assertEqual(clip["Icon"], PNG_ICON)
        self.assertEqual(set(clip), {"PayloadType", "PayloadVersion", "PayloadIdentifier", "PayloadUUID",
            "PayloadDisplayName", "Label", "URL", "FullScreen", "IsRemovable", "Precomposed", "Icon"})
        self.assertNotIn(b"com.apple.mdm", raw_profile)
        self.assertNotIn(b"com.apple.security", raw_profile)
        self.assertNotIn(b"com.apple.vpn", raw_profile)
        # Regenerating the same shortcut does not assign it a new identity.
        regenerated = plistlib.loads(unauthenticated.request("/mobile/iphone.mobileconfig")[1])
        self.assertEqual(regenerated["PayloadUUID"], profile["PayloadUUID"])
        mobile_host.stop()
        self.start(lan="192.168.43.2", username="", password="")
        changed_client = HTTPClient(self.port, f"192.168.43.2:{self.port}")
        changed = plistlib.loads(changed_client.request("/mobile/iphone.mobileconfig")[1])
        self.assertEqual(changed["PayloadContent"][0]["URL"], f"http://192.168.43.2:{self.port}/")
        self.assertNotEqual(changed["PayloadUUID"], profile["PayloadUUID"])

    def test_local_only_host_does_not_offer_nonfunctional_iphone_profile(self):
        mobile_host.stop()
        result = self.start(lan="", username="", password="")
        self.assertEqual(result["lan_url"], "")
        self.assertEqual(result["local_url"], f"http://127.0.0.1:{self.port}")
        client = HTTPClient(self.port)
        self.assertEqual(client.request("/", origin=None)[0], 200)
        for path in ("/mobile/install-ios", "/mobile/iphone.mobileconfig"):
            with self.subTest(path=path):
                status, result, _ = client.request(path, origin=None)
                self.assertEqual(status, 503)
                self.assertIn("Wi-Fi", result["error"])
        self.assertEqual(HTTPClient(self.port, self.lan_host).request("/api/version")[0], 403)

    def test_busy_port_does_not_create_or_migrate_private_data(self):
        mobile_host.stop()
        uninitialized = Path(self.temp.name) / "busy-port-data"
        with socket.socket() as occupied:
            occupied.bind(("127.0.0.1", 0))
            occupied.listen(1)
            busy_port = occupied.getsockname()[1]
            for _ in range(2):
                result = json.loads(mobile_host.start(uninitialized, self.payload, "", "table-gm", self.gm_password, busy_port))
                self.assertFalse(result["running"])
                self.assertIn(f"Порт {busy_port} уже занят", result["error"])
                self.assertIn("Остановить сервер", result["error"])
                self.assertIn("не ошибка пароля", result["error"])
                self.assertNotIn("Errno", result["error"])
                self.assertNotIn("Address already", result["error"])
                self.assertNotIn(self.gm_password, result["error"])
                self.assertEqual(result["local_url"], "")
                self.assertEqual(result["lan_url"], "")
                self.assertFalse((uninitialized / "tracker.sqlite3").exists())
                self.assertFalse(any(thread.name == "NightCityGM" and thread.is_alive() for thread in threading.enumerate()))
            # The app neither kills the existing listener nor chooses another port.
            self.assertEqual(occupied.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN), 1)
        # After the owner stops that listener, the same requested port is usable.
        result = json.loads(mobile_host.start(uninitialized, self.payload, "", "table-gm", self.gm_password, busy_port))
        self.assertTrue(result["running"], result.get("error"))
        self.assertEqual(result["local_url"], f"http://127.0.0.1:{busy_port}")
        client = HTTPClient(busy_port)
        status, _, _ = client.request("/api/login", "POST", {"username": "table-gm", "password": self.gm_password})
        self.assertEqual(status, 200)
        status, account, _ = client.request("/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(account["username"], "table-gm")

    def test_busy_port_does_not_modify_existing_database_or_initialize_again(self):
        self.start()
        mobile_host.stop()
        logical_before = self.database_state()
        # Already committed initialization can remain in WAL. A later connection
        # cleanup may checkpoint it without changing game data. Stabilize that
        # pre-existing layout; retain exact-byte and logical-state assertions.
        checkpoint = sqlite3.connect(self.data / "tracker.sqlite3")
        try:
            self.assertEqual(checkpoint.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0], 0)
        finally:
            checkpoint.close()
        before = (self.data / "tracker.sqlite3").read_bytes()
        with socket.socket() as occupied:
            occupied.bind(("127.0.0.1", 0)); occupied.listen(1)
            with patch.object(mobile_host.backend, "initialize", side_effect=AssertionError("No migration before successful bind")):
                result = json.loads(mobile_host.start(self.data, self.payload, "", "ignored", "ignored", occupied.getsockname()[1]))
            self.assertFalse(result["running"])
            self.assertIn("уже занят", result["error"])
        self.assertEqual((self.data / "tracker.sqlite3").read_bytes(), before)
        self.assertEqual(self.database_state(), logical_before)

    def test_other_socket_errors_are_not_misidentified_as_password_or_port_conflict(self):
        mobile_host.stop()
        uninitialized = Path(self.temp.name) / "denied-port-data"
        with patch.object(mobile_host.backend, "ThreadingHTTPServer", side_effect=OSError(errno.EACCES, "Permission denied")):
            result = json.loads(mobile_host.start(uninitialized, self.payload, "", "table-gm", self.gm_password, self.port))
        self.assertFalse(result["running"])
        self.assertNotIn("уже занят", result["error"])
        self.assertFalse((uninitialized / "tracker.sqlite3").exists())


if __name__ == "__main__":
    unittest.main()
