"""Android host adapter. All game permissions remain in the portable backend."""
from contextlib import closing
import errno
import hashlib
import html
import http.client
from http.cookies import SimpleCookie
import ipaddress
import json
import os
from pathlib import Path
import plistlib
import secrets
import sqlite3
import threading
import uuid
from urllib.parse import urlsplit

import server as backend

_lock = threading.RLock()
_http = None
_thread = None
_status = {"running": False, "lan_url": "", "local_url": "", "error": ""}
_data = None


def needs_setup(data_dir):
    """A failed first launch may leave a SQLite file without its owner account."""
    database = Path(str(data_dir)) / "tracker.sqlite3"
    if not database.is_file():
        return True
    try:
        with sqlite3.connect(database) as db:
            return db.execute("SELECT 1 FROM users WHERE id=1").fetchone() is None
    except sqlite3.OperationalError as error:
        if "no such table" in str(error):
            return True
        raise ValueError("Не удалось открыть базу ведущего. Сначала сохраните её копию.") from error
    except sqlite3.DatabaseError as error:
        raise ValueError("База ведущего повреждена. Не удаляйте приложение: сохраните копию для восстановления.") from error


def _lan_address(value):
    if not value:
        return ""
    try:
        address = ipaddress.IPv4Address(str(value))
    except ValueError as error:
        raise ValueError("Выберите IPv4-адрес телефона в Wi-Fi или точке доступа.") from error
    if address.is_loopback:
        return ""
    networks = (ipaddress.IPv4Network("10.0.0.0/8"), ipaddress.IPv4Network("172.16.0.0/12"),
                ipaddress.IPv4Network("192.168.0.0/16"))
    if not any(address in network for network in networks):
        raise ValueError("Для локальной игры нужен адрес телефона в домашней сети.")
    return str(address)


def status():
    with _lock:
        current = dict(_status)
        if _http is not None and _thread is not None:
            current["running"] = _thread.is_alive()
        return json.dumps(current, ensure_ascii=False)


def _iphone_profile(lan_url, payload_dir):
    """Optional removable Home Screen shortcut; never MDM, VPN or a certificate."""
    identifier = "app.nightcity.crew.webclip." + uuid.uuid5(uuid.NAMESPACE_URL, lan_url).hex
    clip = {
        "PayloadType": "com.apple.webClip.managed", "PayloadVersion": 1,
        "PayloadIdentifier": identifier, "PayloadUUID": str(uuid.uuid5(uuid.NAMESPACE_URL, identifier)),
        "PayloadDisplayName": "Night City Crew", "Label": "NC Crew",
        "URL": lan_url + "/", "FullScreen": True, "IsRemovable": True,
        "Precomposed": True,
    }
    icon = payload_dir / "static" / "icons" / "apple-touch-icon.png"
    if icon.is_file():
        clip["Icon"] = icon.read_bytes()
    profile = {
        "PayloadType": "Configuration", "PayloadVersion": 1,
        "PayloadIdentifier": identifier + ".profile",
        "PayloadUUID": str(uuid.uuid5(uuid.NAMESPACE_URL, identifier + ".profile")),
        "PayloadDisplayName": "Night City Crew — локальная игра",
        "PayloadDescription": "Добавляет только иконку игры ведущего. Можно удалить в настройках iPhone.",
        "PayloadOrganization": "Night City Crew", "PayloadRemovalDisallowed": False,
        "PayloadContent": [clip],
    }
    return plistlib.dumps(profile, fmt=plistlib.FMT_XML, sort_keys=True)


def _iphone_page(lan_url):
    url = html.escape(lan_url + "/", quote=True)
    return ("<!doctype html><html lang='ru'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<meta name='theme-color' content='#070a0b'><title>Night City Crew — iPhone</title>"
            "<style>body{background:#070a0b;color:#d3e6e3;font:17px/1.6 system-ui;margin:0;padding:24px}"
            "main{max-width:600px;margin:auto}h1{font-size:25px}h2{font-size:20px;margin-top:32px}"
            "a{color:#d3e6e3}code{overflow-wrap:anywhere} .button{display:block;background:#ac183e;"
            "padding:15px;text-decoration:none;text-align:center;margin:24px 0}li{margin:12px 0}"
            "summary{padding:14px;border:1px solid #435451;cursor:pointer}</style></head><body><main>"
            "<h1>Night City Crew на iPhone</h1><p>Подключитесь к той же сети Wi-Fi, что и ведущий, "
            "или к его точке доступа. Интернет для этой игры не нужен.</p>"
            f"<a class='button' href='{url}'>Открыть игру</a>"
            "<h2>Добавить иконку приложения</h2><ol><li>Откройте игру именно в Safari.</li>"
            "<li>Нажмите «Поделиться», затем «На экран Домой». Если пункт скрыт, откройте «Ещё».</li>"
            "<li>Включите «Открывать как веб-приложение», если такой переключатель есть, и нажмите «Добавить».</li>"
            "<li>Запустите иконку NC Crew. Создайте свой аккаунт; пароль ведущего вам не нужен.</li>"
            "<li>Создайте персонажа и отправьте заявку по коду кампании, который даст ведущий.</li></ol>"
            "<p>Установленная иконка подключается к телефону ведущего. Пока сервер выключен, "
            "персонажи и кампания недоступны. Данные остаются у ведущего.</p>"
            "<details><summary>Другой способ: файл установки иконки</summary>"
            "<p>Этот необязательный профиль добавляет только иконку игры. Он не содержит VPN, "
            "сертификатов и управления устройством. Профиль не подписан — iPhone покажет предупреждение.</p>"
            "<p><a href='/mobile/iphone.mobileconfig'>Скачать профиль Night City Crew</a>.</p>"
            "<p>Разрешите загрузку, затем откройте «Настройки» → «Профиль загружен» → «Установить». "
            "Удалить его можно в «Основные» → «VPN и управление устройством».</p></details>"
            f"<h2>Если адрес изменился</h2><p>Текущий адрес: <code>{url}</code>. "
            "Попросите у ведущего новый адрес и добавьте иконку заново. Старую можно удалить.</p>"
            "<p>На локальном HTTP нет автономного кэша: для игры нужен включённый сервер ГМ и связь с ним.</p>"
            "</main></body></html>").encode("utf-8")


def _initial_owner_cookie(username, password, port):
    """Use the real login/session API; never manufacture a privileged session."""
    origin = f"http://127.0.0.1:{port}"
    headers = {"Host": f"127.0.0.1:{port}", "Origin": origin,
               "Content-Type": "application/json"}
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        body = json.dumps({"username": username, "password": password, "mode": "gm"}).encode("utf-8")
        connection.request("POST", "/api/login", body=body, headers=headers)
        response = connection.getresponse()
        cookie_header = response.getheader("Set-Cookie", "")
        login = json.loads(response.read())
        if response.status != 200 or login.get("ok") is not True:
            raise ValueError("Initial login was not accepted")
        cookies = SimpleCookie(cookie_header)
        if set(cookies) != {backend.COOKIE} or not cookies[backend.COOKIE].value:
            raise ValueError("Initial session cookie was not issued")
        headers["Cookie"] = backend.COOKIE + "=" + cookies[backend.COOKIE].value
        connection.request("GET", "/api/me", headers=headers)
        response = connection.getresponse()
        owner = json.loads(response.read())
        if (response.status != 200 or owner.get("id") != 1
                or owner.get("admin") is not True or owner.get("role") != "gm"):
            raise ValueError("Initial session owner was not verified")
        return cookie_header
    finally:
        connection.close()


def start(data_dir, payload_dir, lan_host, admin_user, admin_password, port=8080,
          authenticate_initial_owner=False):
    global _http, _thread, _status, _data
    with _lock:
        if _http is not None:
            return status()
        http = None
        initial_result = {}
        try:
            lan = _lan_address(lan_host)
            port = int(port)
            if not 1024 <= port <= 65535:
                raise ValueError("Порт должен быть от 1024 до 65535.")
            data = Path(str(data_dir)).resolve()
            payload = Path(str(payload_dir)).resolve()
            if not (payload / "static" / "index.html").is_file():
                raise ValueError("Не удалось подготовить файлы приложения. Перезапустите его.")
            first = needs_setup(data)
            user = str(admin_user)
            password = str(admin_password)
            if first:
                if (backend.re.fullmatch(r"[A-Za-z0-9_.-]{2,40}", user) is None
                        or not 12 <= len(password) <= 256):
                    raise ValueError("Для первого запуска задайте логин ведущего и пароль от 12 до 256 символов.")
                try:
                    password.encode("utf-8")
                except UnicodeEncodeError as error:
                    raise ValueError("Проверьте символы пароля ведущего.") from error
            data.mkdir(parents=True, exist_ok=True, mode=0o700)
            local_url = f"http://127.0.0.1:{port}"
            lan_url = f"http://{lan}:{port}" if lan else ""
            allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            if lan:
                allowed_hosts.add(f"{lan}:{port}")

            class AndroidHandler(backend.Handler):
                def handle_request(self, method):
                    host = self.headers.get("Host", "")
                    if host not in allowed_hosts:
                        return self.respond(403, {"error": "Откройте адрес, который показывает приложение ведущего."})
                    path = urlsplit(self.path).path
                    if method == "GET" and path in ("/mobile/install-ios", "/mobile/iphone.mobileconfig"):
                        if not lan_url:
                            return self.respond(503, {"error": "Сначала подключите телефон ведущего к Wi-Fi или включите точку доступа."})
                        if path.endswith(".mobileconfig"):
                            return self.respond(200, _iphone_profile(lan_url, payload), "application/x-apple-aspen-config")
                        return self.respond(200, _iphone_page(lan_url), "text/html; charset=utf-8")
                    return super().handle_request(method)

                def same_origin(self):
                    expected = "http://" + self.headers.get("Host", "")
                    origin = self.headers.get("Origin")
                    if (origin is not None and origin != expected) or self.headers.get("Sec-Fetch-Site") == "cross-site":
                        raise backend.APIError(403, "Запрос с другого сайта отклонён.")

            # Bind first: if the port is occupied, no database migration takes place.
            http = backend.ThreadingHTTPServer(("0.0.0.0" if lan else "127.0.0.1", port), AndroidHandler)
            # stop() must drain active writes before a full database restore.
            http.daemon_threads = False
            http.block_on_close = True
            backend.ROOT, backend.DATA, backend.DB = payload, data, data / "tracker.sqlite3"
            backend.ORIGIN, backend.SECURE = local_url, False
            if first:
                os.environ["ADMIN_USER"], os.environ["ADMIN_PASSWORD"] = user, password
            try:
                backend.initialize()
            finally:
                os.environ.pop("ADMIN_PASSWORD", None)
                os.environ.pop("ADMIN_USER", None)
            http.dummy_hash = backend.password_hash(secrets.token_urlsafe(32))
            _thread = threading.Thread(target=http.serve_forever, name="NightCityGM", daemon=True)
            _http, _data = http, data
            _status = {"running": True, "lan_url": lan_url, "local_url": local_url, "error": ""}
            _thread.start()
            if first and authenticate_initial_owner is True:
                try:
                    initial_result["initial_session_cookie"] = _initial_owner_cookie(user, password, port)
                except Exception:
                    # Account creation and the host succeeded. Preserve them,
                    # and report a safe manual-login fallback without details.
                    initial_result["initial_login_warning"] = "Аккаунт создан. Войди с выбранным логином и паролем."
        except (ValueError, OSError, sqlite3.Error, SystemExit) as error:
            if http is not None:
                http.server_close()
            _http, _thread = None, None
            if isinstance(error, OSError) and error.errno == errno.EADDRINUSE:
                message = (
                    f"Порт {port} уже занят на этом телефоне. "
                    "Если запущена прежняя версия Night City Crew, открой её и нажми «Остановить сервер», "
                    "затем повтори запуск здесь. Закрытие окна не останавливает сервер. "
                    "Это не ошибка пароля."
                )
            else:
                message = str(error)
            _status = {"running": False, "lan_url": "", "local_url": "", "error": message}
        finally:
            password = ""
        result = json.loads(status())
        result.update(initial_result)
        return json.dumps(result, ensure_ascii=False)


def stop():
    global _http, _thread, _status
    with _lock:
        if _http is not None:
            _http.shutdown()
            _http.server_close()
            if _thread is not None:
                _thread.join(timeout=3)
        _http, _thread = None, None
        _status = {"running": False, "lan_url": "", "local_url": "", "error": ""}
        return status()


def backup():
    with _lock:
        if _data is None or not (_data / "tracker.sqlite3").is_file():
            raise ValueError("Сначала запустите сервер ведущего.")
        return str(backend.backup_database(reason="mobile"))


def recover_owner_password(data_dir, new_password, device_authenticated=False):
    """Native-only owner recovery after Android has verified the device credential.

    This function is deliberately absent from every HTTP handler. The native
    caller supplies the app-private data directory, never a path from the page.
    A running server is drained first, including already-verified logins. A
    reserved SQLite write transaction then protects the pre-recovery snapshot;
    the original local listener is restarted even if recovery fails.
    """
    if device_authenticated is not True:
        raise ValueError("Сначала подтвердите блокировку телефона.")
    if not isinstance(new_password, str) or not 12 <= len(new_password) <= 256:
        raise ValueError("Новый пароль должен содержать от 12 до 256 символов.")
    try:
        new_password.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError("Проверьте символы нового пароля.") from error
    if not isinstance(data_dir, (str, os.PathLike)) or not str(data_dir):
        raise ValueError("Не удалось найти локальную базу ведущего.")

    with _lock:
        data = Path(data_dir).resolve()
        database = data / "tracker.sqlite3"
        if (_http is not None
                and (data != _data or database != backend.DB.resolve())):
            raise ValueError("Сначала остановите другой локальный сервер.")
        if not data.is_dir() or not database.is_file() or database.is_symlink():
            raise ValueError("Локальная база ведущего ещё не создана.")
        backup_dir = data / "backups"
        if backup_dir.is_symlink() or (backup_dir.exists() and not backup_dir.is_dir()):
            raise ValueError("Не удалось подготовить приватную резервную копию.")

        def owner_record(db):
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("База ведущего повреждена. Сохраните её для восстановления.")
            tables = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            if not {"users", "sessions", "attempts", "characters", "campaigns",
                    "campaign_members", "tracker_meta"} <= tables:
                raise ValueError("Этот файл не является базой Night City Crew.")
            owner = db.execute("SELECT username,password,role FROM users WHERE id=1").fetchone()
            if owner is None:
                raise ValueError("В локальной базе нет аккаунта владельца сервера.")
            username, encoded, role = owner
            if (not isinstance(username, str)
                    or backend.re.fullmatch(r"[A-Za-z0-9_.-]{2,40}", username) is None
                    or not isinstance(encoded, str)
                    or backend.re.fullmatch(r"[a-f0-9]{32}:[a-f0-9]{128}", encoded) is None
                    or role not in ("gm", "player")):
                raise ValueError("Аккаунт владельца повреждён. Сохраните базу для восстановления.")
            # Validate the touched tables before creating any backup or changing data.
            db.execute("SELECT token,user_id,csrf,expires FROM sessions LIMIT 0")
            db.execute("SELECT key,count,started FROM attempts LIMIT 0")
            db.execute("SELECT id,owner_id,data,version,updated FROM characters LIMIT 0")
            db.execute("SELECT id,gm_id,name,description,invite_code,gm_notes,ledger,version,updated FROM campaigns LIMIT 0")
            db.execute("SELECT campaign_id,user_id FROM campaign_members LIMIT 0")
            db.execute("SELECT key,value FROM tracker_meta LIMIT 0")
            if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("Связи в базе повреждены. Сохраните её для восстановления.")
            return username

        temporary = None
        restart = None
        try:
            # Read-only preflight rejects incomplete/corrupt databases without
            # creating a new SQLite database or running application migrations.
            with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=10)) as check:
                owner_record(check)
            encoded = backend.password_hash(new_password)
            if _http is not None:
                restart = (str(data), str(backend.ROOT), urlsplit(_status["lan_url"]).hostname or "",
                           "", "", _http.server_address[1])
                # A login that checked the old password may still be creating
                # its session. stop() waits for all handlers before revocation.
                stop()
            with closing(sqlite3.connect(database.as_uri() + "?mode=rw", uri=True, timeout=10)) as db:
                db.execute("PRAGMA foreign_keys=ON")
                with db:
                    db.execute("BEGIN IMMEDIATE")
                    username = owner_record(db)
                    backup_dir.mkdir(mode=0o700, exist_ok=True)
                    os.chmod(backup_dir, 0o700)
                    name = ("before-owner-recovery-" + backend.time.strftime("%Y%m%d-%H%M%S")
                            + "-" + secrets.token_hex(6) + ".sqlite3")
                    snapshot = backup_dir / name
                    temporary = backup_dir / (name + ".tmp")
                    fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                    os.close(fd)
                    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=10)) as source:
                        with closing(sqlite3.connect(temporary)) as copied:
                            source.backup(copied)
                            if copied.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                                raise sqlite3.DatabaseError("Recovery backup integrity check failed")
                    os.chmod(temporary, 0o600)
                    temporary.replace(snapshot)
                    changed = db.execute("UPDATE users SET password=? WHERE id=1", (encoded,))
                    if changed.rowcount != 1:
                        raise ValueError("Аккаунт владельца изменился. Повторите восстановление.")
                    db.execute("DELETE FROM sessions WHERE user_id=1")
                    # The app logs in through loopback; retain peers' attempt
                    # buckets and clear only this owner's blocked local login.
                    local_bucket = hashlib.sha256(("127.0.0.1:" + username.lower()).encode()).hexdigest()
                    db.execute("DELETE FROM attempts WHERE key=?", (local_bucket,))
        except (sqlite3.Error, OSError) as error:
            raise ValueError("Не удалось безопасно восстановить пароль. База сохранена.") from error
        finally:
            try:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            finally:
                if restart is not None:
                    start(*restart)
        current = json.loads(status())
        return json.dumps({"ok": True, "username": username,
                           "running": current["running"], "error": current["error"]}, ensure_ascii=False)


def _validate_restore_database(db):
    """Accept prior additive schemas, but never replace a host with broken tables.

    initialize() creates missing optional tables; it cannot repair missing columns
    in an existing table. The five core tables were already required by restore.
    Version labels are deliberately not an allowlist: genuine older backups may
    omit later tables, which the existing initializer adds without changing data.
    """
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError("Резервная копия повреждена.")
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"users", "characters", "campaigns", "tracker_meta", "campaign_members"} <= tables:
        raise ValueError("Этот файл не является полной резервной копией Night City Crew.")
    columns = {
        "users": "id username password role",
        "sessions": "token user_id csrf expires",
        "characters": "id owner_id data version updated",
        "revisions": "id character_id actor_id data version reason created",
        "attempts": "key count started",
        "user_modes": "user_id mode",
        "campaigns": "id gm_id name description invite_code gm_notes ledger version updated transfer_to",
        "campaign_members": "campaign_id user_id",
        "campaign_characters": "campaign_id character_id status created",
        "character_sharing": "character_id campaign_id mode recipients version updated",
        "tracker_meta": "key value",
        "campaign_workspaces": "campaign_id data version updated recent_requests",
        "campaign_portability": "campaign_id uuid gm_key ancestors updated",
        "character_portability": "character_id uuid owner_key",
        "user_portability": "user_id uuid",
        "campaign_portable_owners": "campaign_id owner_key label user_id claim_hash member",
        "campaign_transfer_previews": "token_hash user_id campaign_uuid source_fingerprint target_id destination_fingerprint expires",
        "campaign_transfer_backups": "id campaign_id created data",
        "campaign_transfer_guards": "id passed",
        "imported_revision_labels": "revision_id actor_key actor_label",
        "player_settings": "user_id data updated",
        "shared_battles": "campaign_id battle_id version data updated",
        "shared_battle_commands": "campaign_id command_id user_id battle_id request_hash result created",
        "training_battles": "campaign_id battle_id version data updated",
        "training_battle_commands": "campaign_id command_id user_id battle_id request_hash result created",
        "crew_atlas_state": "campaign_id revision updated",
        "crew_atlas_markers": "id campaign_id name description secret kind color x y map place_id revealed updated",
        "crew_atlas_commands": "campaign_id command_id user_id request_hash result created",
    }
    for table, required in columns.items():
        if table in tables:
            actual = {row[1] for row in db.execute('PRAGMA table_info("' + table + '")')}
            if not set(required.split()) <= actual:
                raise ValueError("Структура резервной копии повреждена или несовместима. Текущая база не заменена.")
    # Ask SQLite itself to resolve every explicit ON CONFLICT target used by
    # initialization and normal requests. EXPLAIN only compiles the statement;
    # it never inserts rows, even on the read-only source connection. This also
    # rejects partial/nonunique indexes that merely resemble a valid key.
    unique_targets = {
        "tracker_meta": "key", "attempts": "key", "user_modes": "user_id",
        "player_settings": "user_id", "campaign_workspaces": "campaign_id",
        "campaign_portable_owners": "campaign_id owner_key",
        "shared_battles": "campaign_id", "shared_battle_commands": "campaign_id command_id",
        "training_battles": "campaign_id", "training_battle_commands": "campaign_id command_id",
        "crew_atlas_state": "campaign_id", "crew_atlas_markers": "campaign_id id", "crew_atlas_commands": "campaign_id command_id",
    }
    for table, target in unique_targets.items():
        if table in tables:
            keys = ','.join('"' + key + '"' for key in target.split())
            values = ','.join('NULL' for _ in target.split())
            try:
                db.execute('EXPLAIN INSERT INTO "' + table + '" (' + keys + ') VALUES (' + values
                           + ') ON CONFLICT(' + keys + ') DO NOTHING').fetchall()
            except sqlite3.Error as error:
                raise ValueError("Ключи резервной копии повреждены или несовместимы. Текущая база не заменена.") from error
    owner = db.execute("SELECT username,password,role FROM users WHERE id=1").fetchone()
    if owner is None:
        raise ValueError("В копии нет аккаунта владельца сервера.")
    username, password, role = owner
    if (not isinstance(username, str) or backend.re.fullmatch(r"[A-Za-z0-9_.-]{2,40}", username) is None
            or not isinstance(password, str) or backend.re.fullmatch(r"[a-f0-9]{32}:[a-f0-9]{128}", password) is None
            or role not in ("gm", "player")):
        raise ValueError("Аккаунт владельца в резервной копии повреждён. Текущая база не заменена.")
    if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise ValueError("Связи в резервной копии повреждены. Текущая база не заменена.")


def restore(data_dir, source_file):
    """Restore an entire host only while stopped; caller must request confirmation."""
    global _data
    with _lock:
        if _http is not None:
            raise ValueError("Остановите сервер перед восстановлением копии.")
        source = Path(str(source_file)).resolve()
        data = Path(str(data_dir)).resolve()
        database = data / "tracker.sqlite3"
        if source == database or not source.is_file() or source.stat().st_size > 100 * 1024 * 1024:
            raise ValueError("Выберите резервную копию SQLite размером до 100 МБ.")
        try:
            with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as db:
                _validate_restore_database(db)
            data.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = data / ("restore-" + secrets.token_hex(8) + ".sqlite3")
            try:
                with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as original, closing(sqlite3.connect(temporary)) as copied:
                    original.backup(copied)
                    # Revalidate the exact snapshot: an external source may have
                    # changed after preflight. No host files have changed yet.
                    _validate_restore_database(copied)
                os.chmod(temporary, 0o600)
                backend.DATA, backend.DB = data, database
                if database.is_file():
                    backend.backup_database(reason="before-restore")
                # Old WAL files may contain pages of the replaced database.
                for suffix in ("-wal", "-shm"):
                    Path(str(database) + suffix).unlink(missing_ok=True)
                temporary.replace(database)
            finally:
                temporary.unlink(missing_ok=True)
            _data = data
            return "Копия восстановлена. Войдите с прежним логином и паролем."
        except sqlite3.Error as error:
            raise ValueError("Не удалось прочитать резервную копию SQLite.") from error
