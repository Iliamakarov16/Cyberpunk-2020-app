"""Packaging checks for required UI assets and recursively imported CSS resources."""
import importlib.util
import io
from pathlib import Path
import re
import tempfile
import unittest
from zipfile import ZipFile, ZIP_DEFLATED


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nightcity_payload_contract", ROOT / "scripts/package_payload.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


def archive(files):
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as package:
        for name, content in files.items():
            package.writestr(name, content)
    return io.BytesIO(output.getvalue())


def required_fixture():
    return {name: b"required nonempty asset" for name in packager.REQUIRED}


def imported_fixture():
    files = required_fixture()
    files.update({
        "static/style.css": b'@import "styles/frame.css" screen;',
        "static/styles/frame.css": b"@import url('./nested/theme.asset?revision=2');",
        "static/styles/nested/theme.asset": (
            b'@import "/style.css";'
            b"@font-face{src:url('../../fonts/extra.woff2?revision=2#glyph')}"
            b".panel{background-image:url('../images/paper.png#layer')}"
        ),
        "static/fonts/extra.woff2": b"font bytes",
        "static/styles/images/paper.png": b"image bytes",
    })
    return files


class PayloadContract(unittest.TestCase):
    def test_android_payload_refresh_and_service_actions_match_release_identity(self):
        gradle = (ROOT / "android/app/build.gradle").read_text()
        host = (ROOT / "android/app/src/main/java/app/nightcity/crew/HostService.java").read_text()
        package = re.search(r"applicationId '([^']+)'", gradle).group(1)
        version = re.search(r"versionName '([^']+)'", gradle).group(1)
        self.assertEqual(re.search(r'PAYLOAD_VERSION = "([^"]+)"', host).group(1), version,
                         "An APK update must invalidate the native extracted-web-payload marker")
        for action in ("START", "STOP"):
            self.assertIn('ACTION_' + action + ' = "' + package + '.' + action + '_HOST"', host)
        web = (ROOT / "web-source/lib/app-version.ts").read_text()
        self.assertIn(version.split('-')[0], web)

    def assert_invalid_asset(self, files, name):
        with self.assertRaisesRegex(ValueError, re.escape(name)):
            packager.validate(archive(files))

    def test_current_embedded_archive_is_complete(self):
        count = packager.validate(ROOT / "android/app/src/main/assets/server.zip")
        self.assertGreaterEqual(count, len(packager.REQUIRED))

    def test_each_critical_asset_must_exist_and_be_nonempty(self):
        for name in packager.REQUIRED:
            for empty in (False, True):
                with self.subTest(asset=name, empty=empty):
                    files = required_fixture()
                    if empty:
                        files[name] = b""
                    else:
                        del files[name]
                    self.assert_invalid_asset(files, name)

    def test_current_css_mask_and_atlases_must_exist_and_be_nonempty(self):
        with ZipFile(ROOT / "android/app/src/main/assets/server.zip") as package:
            current = {entry.filename: package.read(entry) for entry in package.infolist() if not entry.is_dir()}
        for name in (
            "static/art/silhouette-mask.webp",
            "static/art/item-atlas-ink-v1.png",
            "static/art/inventory-atlas-v2.png",
        ):
            for empty in (False, True):
                with self.subTest(asset=name, empty=empty):
                    files = dict(current)
                    if empty:
                        files[name] = b""
                    else:
                        del files[name]
                    self.assert_invalid_asset(files, name)

    def test_relative_imports_resolve_nested_font_and_image_and_handle_cycles(self):
        files = imported_fixture()
        self.assertEqual(packager.validate(archive(files)), len(files))

    def test_each_transitive_import_font_and_image_must_exist_and_be_nonempty(self):
        for name in (
            "static/styles/frame.css", "static/styles/nested/theme.asset",
            "static/fonts/extra.woff2", "static/styles/images/paper.png",
        ):
            for empty in (False, True):
                with self.subTest(asset=name, empty=empty):
                    files = imported_fixture()
                    if empty:
                        files[name] = b""
                    else:
                        del files[name]
                    self.assert_invalid_asset(files, name)

    def test_all_css_files_are_checked_even_when_not_imported(self):
        files = required_fixture()
        files["static/preview/extra.css"] = b".preview{background:url('../images/missing.png')}"
        self.assert_invalid_asset(files, "static/images/missing.png")

    def test_query_only_url_resolves_to_source_stylesheet(self):
        files = required_fixture()
        files["static/style.css"] = b'.a{background:url("?revision=3#fragment")}'
        self.assertEqual(packager.validate(archive(files)), len(files))

    def test_fragments_data_external_urls_and_comments_do_not_require_files(self):
        files = required_fixture()
        files["static/style.css"] = b'''
            @import "https://example.invalid/remote.css";
            @import url('//example.invalid/another.css');
            .a{mask:url(#local-mask)}
            .b{background:url("data:image/svg+xml;base64,PHN2Zz4=")}
            .c{background:url(https://example.invalid/image.png)}
            .d{background:url("blob:https://example.invalid/image")}
            .e{background:url()}
            /* @import "absent.css"; .unused{background:url('/absent.png')} */
        '''
        self.assertEqual(packager.validate(archive(files)), len(files))

    def test_decoded_paths_cannot_escape_static_or_contain_null_or_backslash(self):
        for reference in ("../../private.png", "/../private.png", "%2e%2e/private.png",
                          "fonts/%00private.woff", "fonts\\private.woff"):
            with self.subTest(reference=reference):
                files = required_fixture()
                files["static/style.css"] = f'.a{{background:url("{reference}")}}'.encode()
                with self.assertRaisesRegex(ValueError, "Unsafe CSS dependency|escapes static/"):
                    packager.validate(archive(files))

    def test_failed_dependency_validation_preserves_previous_archive(self):
        with tempfile.TemporaryDirectory(prefix="nightcity-package-contract-") as temporary:
            root = Path(temporary)
            static = root / "static"
            files = required_fixture()
            files["static/style.css"] = b".a{background:url('/art/absent.png')}"
            for name, content in files.items():
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(content)
            output = root / "server.zip"
            output.write_bytes(b"previous valid archive")
            with self.assertRaisesRegex(ValueError, "static/art/absent.png"):
                packager.package(static, output)
            self.assertEqual(output.read_bytes(), b"previous valid archive")
            self.assertEqual(list(root.glob("server-*.zip")), [])


if __name__ == "__main__":
    unittest.main()
