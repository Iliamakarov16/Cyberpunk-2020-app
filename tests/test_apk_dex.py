"""Regression tests for the final-APK guard, independent of Gradle packaging."""
import importlib.util
import io
from pathlib import Path
import struct
import tempfile
import unittest
import warnings
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
import hashlib
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verify_apk_dex", ROOT / "scripts/verify_apk_dex.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


def signed_dex(data):
    data = bytearray(data)
    data[12:32] = hashlib.sha1(data[32:]).digest()
    struct.pack_into("<I", data, 8, zlib.adler32(data[12:]) & 0xFFFFFFFF)
    return bytes(data)


def dex(version=b"037"):
    # Minimal empty DEX with a real map list. These bytes do not mirror the
    # implementation: corruptions below must remain detectable even after hashes
    # are recomputed, and sequence tests use otherwise intact DEX files.
    data = bytearray(140)
    data[:8] = b"dex\n" + version + b"\0"
    struct.pack_into("<III", data, 32, len(data), 112, 0x12345678)
    struct.pack_into("<I", data, 52, 112)  # map_off
    struct.pack_into("<II", data, 104, 28, 112)  # data_size, data_off
    struct.pack_into("<I", data, 112, 2)
    struct.pack_into("<HHII", data, 116, 0x0000, 0, 1, 0)
    struct.pack_into("<HHII", data, 128, 0x1000, 0, 1, 112)
    return signed_dex(data)


def apk_bytes(entries, compression=ZIP_DEFLATED):
    output = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with ZipFile(output, "w", compression=compression) as apk:
            for name, content in entries:
                apk.writestr(name, content)
    return output.getvalue()


class APKDexValidation(unittest.TestCase):
    def check_apk(self, entries, compression=ZIP_DEFLATED):
        with tempfile.TemporaryDirectory(prefix="nightcity-dex-guard-") as temporary:
            apk = Path(temporary) / "test.apk"
            content = apk_bytes(entries, compression)
            apk.write_bytes(content)
            result = validator.verify_apk(apk)
            self.assertEqual(apk.read_bytes(), content, "Validator must never mutate signed APK bytes")
            return result

    def reject(self, entries, reason):
        with self.assertRaisesRegex(validator.APKDexError, reason):
            self.check_apk(entries)

    def test_single_and_contiguous_multidex_stored_or_deflated(self):
        for count in (1, 3, 12):
            for compression in (ZIP_STORED, ZIP_DEFLATED):
                with self.subTest(count=count, compression=compression):
                    names = ["classes.dex"] + [f"classes{i}.dex" for i in range(2, count + 1)]
                    entries = [(name, dex()) for name in reversed(names)]
                    entries += [("AndroidManifest.xml", b"manifest fixture"), ("assets/sample.dex", b"not root code")]
                    report = self.check_apk(entries, compression)
                    self.assertEqual(report["dexCount"], count)
                    self.assertEqual([item["name"] for item in report["dexFiles"]], names)
                    self.assertTrue(all(item["version"] == "037" for item in report["dexFiles"]))

    def test_shifted_shipped_four_five_six_sequence_is_rejected(self):
        self.reject([(f"classes{i}.dex", dex()) for i in (4, 5, 6)], "missing required root classes.dex")

    def test_primary_is_required_and_assets_copy_does_not_substitute(self):
        for entries in ([], [("classes2.dex", dex())], [("assets/classes.dex", dex())]):
            with self.subTest(entries=[name for name, _ in entries]):
                self.reject(entries, "missing required root classes.dex")

    def test_gaps_and_noncanonical_root_names_are_rejected(self):
        self.reject([(name, dex()) for name in ("classes.dex", "classes3.dex")], "contiguous")
        for name in ("classes1.dex", "classes02.dex", "classes0.dex", "classes-2.dex", "main.dex", "classes2.DEX"):
            with self.subTest(name=name):
                self.reject([("classes.dex", dex()), (name, dex())], "Noncanonical root DEX name")

    def test_duplicate_dex_and_non_code_zip_entries_are_rejected(self):
        for entries in (
            [("classes.dex", dex()), ("classes.dex", dex())],
            [("classes.dex", dex()), ("assets/data", b"one"), ("assets/data", b"two")],
        ):
            self.reject(entries, "Duplicate APK entry names")

    def test_empty_and_truncated_primary_or_secondary_are_rejected(self):
        for invalid in (b"", dex()[:111]):
            for name in ("classes.dex", "classes2.dex"):
                with self.subTest(name=name, length=len(invalid)):
                    entries = [("classes.dex", dex())] if name != "classes.dex" else []
                    self.reject(entries + [(name, invalid)], "empty or truncated")

    def test_corrupt_magic_or_unsupported_version_are_rejected(self):
        for offset, changed, reason in ((0, b"bad\n", "invalid DEX magic"),
                                        (7, b"!", "invalid DEX magic"),
                                        (4, b"041", "unsupported DEX version")):
            data = bytearray(dex())
            data[offset:offset + len(changed)] = changed
            self.reject([("classes.dex", signed_dex(data))], reason)

    def test_header_fields_are_checked_even_with_recomputed_integrity(self):
        for offset, value, reason in ((32, 141, "file size"), (36, 120, "header size"),
                                      (40, 0x78563412, "endian tag")):
            with self.subTest(offset=offset):
                data = bytearray(dex())
                struct.pack_into("<I", data, offset, value)
                self.reject([("classes.dex", signed_dex(data))], reason)

    def test_content_sha1_and_checksum_tampering_are_rejected(self):
        data = bytearray(dex())
        data[-1] ^= 1
        self.reject([("classes.dex", bytes(data))], "SHA-1 mismatch")
        data = bytearray(dex())
        data[8] ^= 1
        self.reject([("classes.dex", bytes(data))], "Adler32 mismatch")
        data = bytearray(dex())
        data[12] ^= 1
        struct.pack_into("<I", data, 8, zlib.adler32(data[12:]) & 0xFFFFFFFF)
        self.reject([("classes.dex", bytes(data))], "SHA-1 mismatch")

    def test_bad_container_is_rejected_and_cli_is_nonzero(self):
        with tempfile.TemporaryDirectory(prefix="nightcity-bad-apk-") as temporary:
            apk = Path(temporary) / "invalid.apk"
            apk.write_bytes(b"not a ZIP")
            with self.assertRaisesRegex(validator.APKDexError, "Cannot read APK"):
                validator.verify_apk(apk)
            with patch("sys.stderr", io.StringIO()) as stderr:
                self.assertEqual(validator.main([str(apk)]), 1)
                self.assertIn("APK DEX verification failed", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
