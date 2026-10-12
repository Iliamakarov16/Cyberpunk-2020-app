"""Validate the root DEX sequence and integrity of a final, unmodified APK.

    python3 scripts/verify_apk_dex.py path/to/application.apk

verify_apk(path) returns a JSON-compatible report and raises APKDexError (a
ValueError) on failure. It uses only Python's standard library and never writes
or repackages the APK. This is a packaging guard, not an Android device install.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
from zipfile import BadZipFile, ZipFile
import zlib

SUPPORTED_DEX_VERSIONS = {b"035", b"037", b"038", b"039", b"040"}
DEX_HEADER_SIZE = 0x70
SECONDARY_DEX = re.compile(r"classes([2-9]|[1-9][0-9]+)\.dex\Z")


class APKDexError(ValueError):
    """The APK cannot provide the canonical, intact root DEX sequence."""


def dex_index(name):
    if name == "classes.dex":
        return 1
    match = SECONDARY_DEX.fullmatch(name)
    if match is None:
        raise APKDexError("Noncanonical root DEX name: " + name)
    try:
        return int(match.group(1))
    except ValueError as error:
        raise APKDexError("Noncanonical root DEX name: " + name) from error


def verify_dex(data, name):
    """Validate ordinary Android DEX headers and their two integrity fields."""
    if len(data) < DEX_HEADER_SIZE:
        raise APKDexError(name + ": empty or truncated DEX header")
    if data[:4] != b"dex\n" or data[7:8] != b"\0":
        raise APKDexError(name + ": invalid DEX magic")
    version = data[4:7]
    if version not in SUPPORTED_DEX_VERSIONS:
        raise APKDexError(name + ": unsupported DEX version " + repr(version))
    checksum = struct.unpack_from("<I", data, 8)[0]
    file_size, header_size, endian_tag = struct.unpack_from("<III", data, 32)
    if file_size != len(data):
        raise APKDexError(name + ": declared DEX file size differs from actual bytes")
    if header_size != DEX_HEADER_SIZE:
        raise APKDexError(name + ": invalid DEX header size")
    if endian_tag != 0x12345678:
        raise APKDexError(name + ": invalid or unsupported DEX endian tag")
    if hashlib.sha1(data[32:]).digest() != data[12:32]:
        raise APKDexError(name + ": DEX SHA-1 mismatch")
    if zlib.adler32(data[12:]) & 0xFFFFFFFF != checksum:
        raise APKDexError(name + ": DEX Adler32 mismatch")
    return {"name": name, "size": len(data), "version": version.decode("ascii"),
            "sha256": hashlib.sha256(data).hexdigest()}


def verify_apk(path):
    """Return the final APK's DEX report, or reject missing/gapped/corrupt code."""
    path = Path(path)
    try:
        with ZipFile(path) as apk:
            entries = apk.infolist()
            duplicates = sorted(name for name, count in Counter(entry.filename for entry in entries).items()
                                if count > 1)
            if duplicates:
                raise APKDexError("Duplicate APK entry names: " + ", ".join(duplicates))
            root_dex = [entry for entry in entries if "/" not in entry.filename
                        and entry.filename.lower().endswith(".dex")]
            by_index = {}
            for entry in root_dex:
                index = dex_index(entry.filename)
                by_index[index] = entry
            if 1 not in by_index:
                raise APKDexError("APK is missing required root classes.dex")
            indexes = sorted(by_index)
            if indexes != list(range(1, len(indexes) + 1)):
                names = ", ".join(by_index[index].filename for index in indexes)
                raise APKDexError("Root DEX sequence must be contiguous from classes.dex: " + names)
            reports = [verify_dex(apk.read(by_index[index]), by_index[index].filename) for index in indexes]
    except APKDexError:
        raise
    except (OSError, BadZipFile, RuntimeError) as error:
        raise APKDexError("Cannot read APK: " + str(error)) from error
    return {"apk": str(path.resolve()), "primaryDex": "classes.dex", "dexCount": len(reports),
            "dexFiles": reports}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(verify_apk(args.apk), indent=2))
    except APKDexError as error:
        print("APK DEX verification failed: " + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
