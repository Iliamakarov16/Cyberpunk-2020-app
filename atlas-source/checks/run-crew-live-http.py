"""Run the actual JS adapter against an ephemeral real Crew host, without fixtures of its API."""
import json
from pathlib import Path
import subprocess
import sys

if len(sys.argv) != 2:
    raise SystemExit('Usage: python checks/run-crew-live-http.py /absolute/path/to/Crew_Source')
crew = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(crew / 'tests'))
from test_crew_atlas_http import CrewAtlasHTTP

fixture = CrewAtlasHTTP('test_real_sessions_no_spoofing_csrf_origin_private_notes_and_reveal')
try:
    fixture.setUp()
    fixture.party()
    # Test-session cookies go only through this child process pipe; never logs/files.
    payload = dict(port=fixture.port, campaignId=int(fixture.base.rsplit('/', 1)[1]),
                   ownerCookie=fixture.owner.cookie, playerCookie=fixture.peer.cookie)
    result = subprocess.run(['node', str(Path(__file__).with_name('crew-live-http.mjs'))],
                            input=json.dumps(payload), text=True, capture_output=True, timeout=90)
    print(result.stdout, end='')
    if result.returncode:
        print(result.stderr, end='', file=sys.stderr)
        raise SystemExit(result.returncode)
finally:
    fixture.doCleanups()
