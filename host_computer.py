"""Run the Night City Crew GM server on this computer instead of an Android phone.

python3 host_computer.py                 # serve on the Wi-Fi/LAN address, port 8080
python3 host_computer.py --local-only    # only this computer (127.0.0.1)
python3 host_computer.py --build         # rebuild payload/static first

Uses the same backend and host adapter as the Android app (mobile_host.py), so
accounts, campaigns, battles, the Atlas map and the iPhone install page behave
the same. Data lives outside the repository so git operations never touch it.
"""
import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "android/app/src/main/python"))
import mobile_host  # noqa: E402

DEFAULT_DATA = Path.home() / "Library/Application Support/Night City Crew"


def lan_ip():
    """IPv4 address of the interface used for outgoing traffic; no packets are sent."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        try:
            probe.connect(("192.168.0.1", 9))
            return probe.getsockname()[0]
        except OSError:
            return ""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8080")))
    parser.add_argument("--data", type=Path, default=Path(os.getenv("DATA_DIR", DEFAULT_DATA)),
                        help=f"database directory (default: {DEFAULT_DATA})")
    parser.add_argument("--lan-ip", default="", help="LAN address to serve on (default: auto-detect)")
    parser.add_argument("--local-only", action="store_true", help="serve only on 127.0.0.1")
    parser.add_argument("--build", action="store_true", help="rebuild payload/static before starting")
    args = parser.parse_args()

    payload = ROOT / "payload"
    if args.build or not (payload / "static/index.html").is_file():
        print("Building web payload (needs installed dependencies, see README_REBUILD_0.17.7.md)...", flush=True)
        subprocess.run([sys.executable, str(ROOT / "assemble_source.py"), "--build"], check=True)

    lan = "" if args.local_only else (args.lan_ip or lan_ip())
    user = ""
    if mobile_host.needs_setup(args.data):
        print("First launch: create the GM (owner) account.")
        user = input("GM login (unique, letters, digits, _ . -): ").strip()

    result = json.loads(mobile_host.start(str(args.data), str(payload), lan, user, "", args.port))
    if not result.get("running"):
        raise SystemExit("Server did not start: " + result.get("error", "unknown error"))

    print(f"\nNight City Crew is running. Data: {args.data}")
    print(f"  This computer: {result['local_url']}")
    if result["lan_url"]:
        print(f"  Players (same Wi-Fi): {result['lan_url']}")
        print(f"  iPhone setup page:    {result['lan_url']}/mobile/install-ios")
    else:
        print("  LAN access is off; players on other devices cannot connect.")
    print("Press Ctrl+C to stop.\n", flush=True)

    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    try:
        stopped.wait()
    except KeyboardInterrupt:
        pass
    finally:
        print("Stopping server...", flush=True)
        mobile_host.stop()


if __name__ == "__main__":
    main()
