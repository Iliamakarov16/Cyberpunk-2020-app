"""Exercise the APK's Python backend and complete public payload over real HTTP."""
from collections import deque
from contextlib import contextmanager
from html.parser import HTMLParser
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urljoin, urlsplit
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "android/app/src/main/python"))
import mobile_host

spec = importlib.util.spec_from_file_location("package_payload", ROOT / "scripts/package_payload.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)

# Independent of server routing. Every archive file is requested, so new assets
# cannot silently disappear from the HTTP smoke test.
EXPECTED_MIME = {
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
    ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".woff": "font/woff", ".woff2": "font/woff2", ".otf": "font/otf",
    ".ttf": "font/ttf", ".txt": "text/plain",
}
CSS_URLS = re.compile(r"url\(\s*(?:'([^']*)'|\"([^\"]*)\"|([^\s)]*))\s*\)", re.I)
CSS_IMPORTS = re.compile(r"@import\s+['\"]([^'\"]+)['\"]", re.I)
JS_ASSETS = re.compile(
    r"['\"`](/[^'\"`\s\\]+\.(?:css|js|html|svg|webp|jpg|png|woff2?|otf|ttf|webmanifest|json)"
    r"(?:\?[^'\"`\s\\]*)?)['\"`]")


def packaged_bytes():
    apk = os.environ.get("NC_TEST_APK")
    if apk:
        with ZipFile(apk) as package:
            return package.read("assets/server.zip")
    return (ROOT / "android/app/src/main/assets/server.zip").read_bytes()


@contextmanager
def shipped_host():
    """Release checks run APK Python sources as well as APK frontend bytes."""
    apk = os.environ.get("NC_TEST_APK")
    if not apk:
        try:
            yield mobile_host
        finally:
            mobile_host.stop()
        return
    with tempfile.TemporaryDirectory(prefix="nightcity-apk-python-") as temp:
        with ZipFile(apk) as package, ZipFile(io.BytesIO(package.read("assets/chaquopy/app.imy"))) as sources:
            for name in ("server.py", "mobile_host.py", "shared_battle.py", "crew_atlas.py", "battle_vision.py"):
                Path(temp, name).write_bytes(sources.read(name))
        previous = {name: sys.modules.get(name) for name in ("server", "shared_battle", "crew_atlas", "battle_vision")}
        host = None
        try:
            for name in ("battle_vision", "shared_battle", "crew_atlas"):
                dependency_spec = importlib.util.spec_from_file_location(name, Path(temp, name + ".py"))
                dependency = importlib.util.module_from_spec(dependency_spec)
                sys.modules[name] = dependency
                dependency_spec.loader.exec_module(dependency)
            backend_spec = importlib.util.spec_from_file_location("server", Path(temp, "server.py"))
            backend = importlib.util.module_from_spec(backend_spec)
            sys.modules["server"] = backend
            backend_spec.loader.exec_module(backend)
            host_spec = importlib.util.spec_from_file_location("nightcity_apk_host", Path(temp, "mobile_host.py"))
            host = importlib.util.module_from_spec(host_spec)
            host_spec.loader.exec_module(host)
            yield host
        finally:
            if host is not None:
                host.stop()
            for name, module in previous.items():
                if module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module


class HTMLDependencies(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs = []
        self.styles = []
        self.in_style = False

    def handle_starttag(self, tag, attrs):
        if tag == "style":
            self.in_style = True
        for name, value in attrs:
            if value and ((name == "src" and tag in ("script", "img", "iframe", "source", "audio", "video", "embed"))
                          or (name == "href" and tag == "link")):
                # Navigation anchors are not automatically loaded resource dependencies.
                self.refs.append(value)
            if name == "style" and value:
                self.styles.append(value)

    def handle_endtag(self, tag):
        if tag == "style":
            self.in_style = False

    def handle_data(self, data):
        if self.in_style:
            self.styles.append(data)


def local_resource(reference, base):
    if not reference or reference.startswith("#"):
        return None
    resolved = urlsplit(urljoin("http://payload.invalid" + base, reference))
    if resolved.scheme not in ("http", "https") or resolved.netloc != "payload.invalid":
        return None
    return resolved.path + ("?" + resolved.query if resolved.query else "")


def json_resources(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "buildingTiles" and isinstance(item, str) and "{x}" in item and "{y}" in item:
                # Atlas raster layers address only their explicitly listed source tiles.
                tiles = value.get("tiles")
                if not isinstance(tiles, list) or not tiles:
                    raise AssertionError("Atlas tile template has no tile coordinates")
                for point in tiles:
                    if not isinstance(point, list) or len(point) != 2 or any(type(n) is not int for n in point):
                        raise AssertionError("Invalid Atlas source tile coordinates")
                    yield item.replace("{x}", str(point[0])).replace("{y}", str(point[1]))
            else:
                yield from json_resources(item)
    elif isinstance(value, list):
        for item in value:
            yield from json_resources(item)
    elif isinstance(value, str) and Path(urlsplit(value).path).suffix.lower() in EXPECTED_MIME:
        yield value


def dependencies(path, body):
    suffix = Path(urlsplit(path).path).suffix.lower()
    text = body.decode("utf-8") if suffix in ("", ".html", ".css", ".js", ".webmanifest", ".json") else ""
    refs = []
    css = text if suffix == ".css" else ""
    if suffix in ("", ".html"):
        parser = HTMLDependencies()
        parser.feed(text)
        refs.extend(parser.refs)
        css = "\n".join(parser.styles)
    if suffix in ("", ".html", ".css"):
        refs.extend(next(item for item in match.groups() if item is not None) for match in CSS_URLS.finditer(css))
        refs.extend(CSS_IMPORTS.findall(css))
    if suffix == ".js":
        refs.extend(ref for ref in JS_ASSETS.findall(text) if not ref.startswith("/api/"))
    if suffix in (".webmanifest", ".json"):
        refs.extend(json_resources(json.loads(text)))
    return [resource for ref in refs if (resource := local_resource(ref, path)) is not None]


class PackagedPayloadIntegration(unittest.TestCase):
    def tearDown(self):
        mobile_host.stop()

    def request(self, port, path, cookie=None):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            headers = {"Cookie": cookie} if cookie else {}
            connection.request("GET", path, headers=headers)
            response = connection.getresponse()
            return response.status, response.getheader("Content-Type", ""), response.read()
        finally:
            connection.close()

    def assert_image_policy(self, port):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        try:
            connection.request("GET", "/")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            policy = response.getheader("Content-Security-Policy", "")
            response.read()
            directives = {words[0]: words[1:] for part in policy.split(";") if (words := part.split())}
            self.assertEqual(directives["img-src"], ["'self'", "data:", "blob:"],
                             "Saved portraits and local upload previews must both render")
            self.assertEqual(directives["script-src"], ["'self'"], "Image permissions must not broaden script origins")
            self.assertEqual(directives["connect-src"], ["'self'", "blob:"], "Only the same server and in-memory local export blobs are fetchable")
        finally:
            connection.close()

    @contextmanager
    def running_archive(self, host):
        host.stop()
        blob = packaged_bytes()
        self.assertGreaterEqual(packager.validate(io.BytesIO(blob)), len(packager.REQUIRED))
        with tempfile.TemporaryDirectory(prefix="nightcity-packaged-") as temp:
            payload = Path(temp) / "payload"
            payload.mkdir()
            with ZipFile(io.BytesIO(blob)) as archive:
                archive.extractall(payload)
                expected = {entry.filename.removeprefix("static/"): archive.read(entry)
                            for entry in archive.infolist() if not entry.is_dir()}
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            with patch.object(host.backend.Handler, "log_message", lambda *args: None):
                result = json.loads(host.start(str(Path(temp) / "host-data"), str(payload), "",
                                              "package-gm", secrets.token_urlsafe(24), port))
                self.assertTrue(result["running"], result)
                self.assertEqual(result["error"], "")
                try:
                    yield port, payload, expected
                finally:
                    host.stop()

    def test_actual_archive_serves_every_html_css_js_and_manifest_dependency(self):
        with shipped_host() as host, self.running_archive(host) as (port, payload, expected):
            self.assert_image_policy(port)
            for path, frame_value, ancestor in [("/", "DENY", "'none'"), ("/atlas/index.html", "SAMEORIGIN", "'self'")]:
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                connection.request("GET", path)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader("X-Frame-Options"), frame_value)
                self.assertIn("frame-ancestors " + ancestor, response.getheader("Content-Security-Policy"))
                response.read(); connection.close()
            # Crawl generated HTML first: version queries, CSS imports/fonts/textures,
            # manifest icons and public JS references, without an authenticated session.
            pending = deque(["/", "/atlas/index.html"])
            checked = set()
            while pending:
                path = pending.popleft()
                if path in checked:
                    continue
                checked.add(path)
                name = unquote(urlsplit(path).path).removeprefix("/") or "index.html"
                self.assertTrue(name in expected, f"Frontend refers to an asset absent from APK: {path}")
                status, mime, body = self.request(port, path)
                self.assertEqual(status, 200, f"Unauthenticated frontend dependency: {path}")
                self.assertEqual(mime.split(";", 1)[0], EXPECTED_MIME[Path(name).suffix.lower()], path)
                self.assertEqual(body, expected[name], f"Served bytes differ from APK: {path}")
                pending.extend(dependencies(path, body))
            # Also check lazy JS-composed assets, previews and every other archive file.
            # Never silently skip an asset because its suffix is new.
            for name, content in sorted(expected.items()):
                path = "/" + name
                suffix = Path(name).suffix.lower()
                self.assertIn(suffix, EXPECTED_MIME, f"Declare the browser MIME for new asset: {path}")
                status, mime, body = self.request(port, path)
                self.assertEqual(status, 200, f"Packaged public asset: {path}")
                self.assertEqual(mime.split(";", 1)[0], EXPECTED_MIME[suffix], path)
                self.assertEqual(body, content, path)
                for resource in dependencies(path, body):
                    resource_name = unquote(urlsplit(resource).path).removeprefix("/") or "index.html"
                    self.assertTrue(resource_name in expected, f"Missing transitive dependency: {path} -> {resource}")
            self.assertTrue(any("/fonts/" in path for path in checked), "Entry CSS font dependencies were not crawled")
            self.assertTrue(any("/style-textures/" in path for path in checked), "Entry CSS textures were not crawled")
            self.assertTrue(any("/icons/" in path for path in checked), "Manifest icons were not crawled")
            status, mime, body = self.request(port, "/api/version")
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["version"], host.backend.APP_VERSION)
            print(f"Packaged HTTP: {len(checked)} entry dependencies and {len(expected)} exact public assets passed.")

    def test_public_assets_cannot_publish_private_json_traversal_or_symlinks(self):
        with shipped_host() as host, self.running_archive(host) as (port, payload, expected):
            private = b"private host data must never become a frontend asset"
            for name in ("private.json", "catalog/private.json", "art/private.json", "style-textures/private.json"):
                target = payload / "static" / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(private)
            outside = payload / "secret.png"
            outside.write_bytes(private)
            (payload / "static/art/outside.png").symlink_to(outside)
            (payload / "static/atlas/outside.png").symlink_to(outside)
            (payload / "static/leaked.js").symlink_to(payload / "static/private.json")
            rejected = [
                "/private.json", "/catalog/private.json", "/art/private.json", "/style-textures/private.json",
                "/art/outside.png", "/leaked.js", "/art/../private.json", "/art/%2e%2e/private.json",
                "/fonts/%2e%2e/%2e%2e/secret.png", "/style-textures/%2e%2e/private.json",
                "/icons/%2e%2e/private.json", "/catalog/%2e%2e/private.json", "/%2e%2e/secret.png",
                "/art/%2f../secret.png", "/art/%00.png", "/art/..%5cprivate.json",
                "/atlas/tracker.sqlite3", "/atlas/server.py", "/atlas/%2e%2e/private.json", "/atlas/outside.png",
                "/host-data/tracker.sqlite3", "/backups/manual.sqlite3", "/server.py", "/mobile_host.py",
                "/art", "/fonts", "/icons", "/catalog", "/style-textures", "/missing-theme.css",
            ]
            # Authentication must not turn a private static filename into an asset.
            with host.backend.connect() as db:
                owner = db.execute("SELECT id FROM users WHERE id=1").fetchone()["id"]
                token = secrets.token_urlsafe(32)
                db.execute("INSERT INTO sessions(token,user_id,csrf,expires) VALUES(?,?,?,?)",
                           (host.backend.hashlib.sha256(token.encode()).hexdigest(), owner, secrets.token_urlsafe(32),
                            int(time.time()) + host.backend.SESSION_SECONDS))
                db.commit()
            self.assertEqual(self.request(port, "/api/me", host.backend.COOKIE + "=" + token)[0], 200)
            for cookie in (None, host.backend.COOKIE + "=" + token):
                for path in rejected:
                    status, mime, body = self.request(port, path, cookie)
                    self.assertIn(status, (401, 404), path)
                    self.assertNotIn(private, body, path)
            # A future built stylesheet is public without another router edit.
            stylesheet = payload / "static/future-section.css"
            stylesheet.write_bytes(b".future { color: #ff285c; }")
            status, mime, body = self.request(port, "/future-section.css?v=next")
            self.assertEqual((status, mime.split(";", 1)[0], body), (200, "text/css", stylesheet.read_bytes()))

    def test_root_layout_is_rejected_before_creating_database(self):
        bad_zip = io.BytesIO()
        with ZipFile(bad_zip, "w") as archive:
            archive.writestr("index.html", "bad old packaging")
            archive.writestr("app.js", "bad old packaging")
            archive.writestr("style.css", "bad old packaging")
        with self.assertRaisesRegex(ValueError, "static/index.html"):
            packager.validate(io.BytesIO(bad_zip.getvalue()))
        with shipped_host() as host, tempfile.TemporaryDirectory(prefix="nightcity-invalid-payload-") as temp:
            host.stop()
            payload = Path(temp) / "payload"
            payload.mkdir()
            with ZipFile(io.BytesIO(bad_zip.getvalue())) as archive:
                archive.extractall(payload)
            data = Path(temp) / "host-data"
            result = json.loads(host.start(str(data), str(payload), "", "", "", 8080))
            self.assertFalse(result["running"])
            self.assertFalse(data.exists(), "Invalid payload cannot initialize or change a player's database")
