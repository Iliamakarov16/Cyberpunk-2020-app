"""Build or check the exact directory layout consumed by the Android host.

python3 scripts/package_payload.py              # package payload/static
python3 scripts/package_payload.py --check     # validate embedded server.zip
"""
import argparse
from pathlib import Path, PurePosixPath
import os
import re
import tempfile
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "static/index.html",
    "static/atlas/index.html",
    "static/atlas/crew-campaign.js",
    "static/atlas/crew-bridge.js",
    "static/atlas/theme.js",
    "static/atlas/app.js",
    "static/atlas/dossier.css",
    "static/app.js",
    "static/battle-ui.css",
    "static/art/enemies-v1/04-gang-enforcer.png",
    "static/art/enemies-v1/05-glam-pistolier.png",
    "static/art/enemies-v1/06-riot-security.png",
    "static/art/enemies-v1/07-dock-shotgunner.png",
    "static/art/enemies-v1/08-razor-runner.png",
    "static/art/enemies-v1/09-corporate-operative.png",
    "static/art/enemies-v1/10-salvage-heavy.png",
    "static/art/enemies-v1/11-security-carbine.png",
    "static/appearance-init.js",
    "static/style.css",
    "static/dossier-theme.css",
    "static/deck-connection.css",
    "static/cyberoptic-preview.css",
    "static/access-settings.css",
    "static/campaign-dossier.css",
    "static/portrait-editor.css",
    "static/campaign-controls.css",
    "static/city-atlas-transition.css",
    "static/atlas/cyberdeck.js",
    "static/atlas/cyberdeck.css",
    "static/atlas/atlas-palette.css",
    "static/atlas/city-atlas-transition.css",
    "static/record-controls.css",
    "static/fonts/Dossier-Bold.woff",
    "static/fonts/Dossier-BoldItalic.woff",
    "static/style-textures/photocopy-grain-v1.png",
    "static/style-textures/dry-ink-v1.png",
)
CSS_URLS = re.compile(r"url\(\s*(?:'([^']*)'|\"([^\"]*)\"|([^\s)]*))\s*\)", re.I)
CSS_IMPORTS = re.compile(
    r"@import\s+(?:url\(\s*(?:'([^']*)'|\"([^\"]*)\"|([^\s)]*))\s*\)|'([^']*)'|\"([^\"]*)\")",
    re.I,
)


def local_css_asset(reference, source):
    """Resolve a browser CSS path inside static/, rejecting escaped traversal."""
    reference = reference.strip()
    if not reference or reference.startswith("#"):
        return None
    url = urlsplit(reference)
    if url.scheme or url.netloc:
        return None
    path = unquote(url.path)
    if "\x00" in path or "\\" in path:
        raise ValueError("Unsafe CSS dependency in " + source + ": " + reference)
    if not path:
        return source
    parts = [] if path.startswith("/") else list(PurePosixPath(source).parts[1:-1])
    for part in path.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not parts:
                raise ValueError("CSS dependency escapes static/ in " + source + ": " + reference)
            parts.pop()
        else:
            parts.append(part)
    return "static/" + "/".join(parts)


def validate_css_dependencies(zip_file, entries):
    """Check every stylesheet and recursively check imports, even without .css suffixes."""
    by_name = {entry.filename: entry for entry in entries}
    pending = [entry.filename for entry in entries if not entry.is_dir() and entry.filename.lower().endswith(".css")]
    checked = set()
    while pending:
        source = pending.pop()
        if source in checked:
            continue
        checked.add(source)
        try:
            css = zip_file.read(source).decode("utf-8-sig")
        except UnicodeDecodeError as error:
            raise ValueError("Stylesheet is not valid UTF-8: " + source) from error
        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        references = [(next(value for value in match.groups() if value is not None), False)
                      for match in CSS_URLS.finditer(css)]
        references.extend((next(value for value in match.groups() if value is not None), True)
                          for match in CSS_IMPORTS.finditer(css))
        for reference, is_import in references:
            name = local_css_asset(reference, source)
            if name is None:
                continue
            entry = by_name.get(name)
            if entry is None or entry.is_dir() or entry.file_size <= 0:
                raise ValueError("Stylesheet " + source + " requires a nonempty file: " + name)
            if is_import and name not in checked:
                pending.append(name)


def validate(archive):
    with ZipFile(archive) as zip_file:
        entries = zip_file.infolist()
        names = {entry.filename for entry in entries}
        for name in REQUIRED:
            entry = zip_file.getinfo(name) if name in names else None
            if entry is None or entry.is_dir() or entry.file_size <= 0:
                raise ValueError("Game payload must contain a nonempty file: " + name)
        if len(entries) > 10000 or sum(entry.file_size for entry in entries) > 128 * 1024 * 1024:
            raise ValueError("Game payload exceeds the Android installer limits")
        if len(names) != len(entries):
            raise ValueError("Duplicate payload entries")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if not entry.filename.startswith("static/") or path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
                raise ValueError("Payload entries must stay inside static/")
        if zip_file.testzip() is not None:
            raise ValueError("Corrupt payload archive")
        validate_css_dependencies(zip_file, entries)
        return len(entries)


def package(static, output):
    static, output = Path(static), Path(output)
    for name in REQUIRED:
        file = static / name.removeprefix("static/")
        if not file.is_file() or file.stat().st_size <= 0:
            raise ValueError("Build the frontend in payload/static before packaging; missing or empty: " + name)
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="server-", suffix=".zip", dir=output.parent)
    os.close(descriptor)
    try:
        with ZipFile(temporary, "w", ZIP_DEFLATED, compresslevel=9) as zip_file:
            for file in sorted(static.rglob("*")):
                if file.is_symlink():
                    raise ValueError("Payload cannot contain symlinks")
                if file.is_file():
                    zip_file.write(file, "static/" + file.relative_to(static).as_posix())
        count = validate(temporary)
        os.replace(temporary, output)
        return count
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    archive = ROOT / "android/app/src/main/assets/server.zip"
    count = validate(archive) if arguments.check else package(ROOT / "payload/static", archive)
    print(f"Android payload verified: {count} entries inside static/")
