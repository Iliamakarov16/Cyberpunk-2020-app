"""Verify source bytes and exercise packaged battle Python from an unsigned/signed APK.

This is a real HTTP/SQLite test using extracted app.imy modules, not Android
Activity/WebView/device execution. Synthetic accounts and temporary DBs only.
"""
import argparse,io,sys,tempfile,unittest,importlib
from pathlib import Path
from zipfile import ZipFile
p=argparse.ArgumentParser(description=__doc__);p.add_argument('apk',type=Path);args=p.parse_args()
source=Path(__file__).resolve().parents[1];python=source/'android/app/src/main/python'
modules=[f.stem for f in sorted(python.glob('*.py'))]
patterns=['test_cover_actions_http.py','test_private_battle_vision_http.py','test_firing_actions_http.py','test_melee_action_http.py','test_loadout_action_http.py','test_training_guided_setup.py']
with tempfile.TemporaryDirectory(prefix='nc-apk-battle-') as temp:
    with ZipFile(args.apk) as package,ZipFile(io.BytesIO(package.read('assets/chaquopy/app.imy'))) as archive:
        for name in modules:
            blob=archive.read(name+'.py')
            if blob!=(python/(name+'.py')).read_bytes():raise SystemExit(name+' source mismatch')
            Path(temp,name+'.py').write_bytes(blob)
        with ZipFile(io.BytesIO(package.read('assets/server.zip'))) as static:
            wanted={f.relative_to(source/'payload').as_posix():f for f in (source/'payload/static').rglob('*') if f.is_file()}
            if set(static.namelist())!=set(wanted):raise SystemExit('APK runtime asset names mismatch')
            for name,path in wanted.items():
                if static.read(name)!=path.read_bytes():raise SystemExit('APK runtime asset mismatch: '+name)
    sys.path.insert(0,temp)
    for name in ['battle_cover','battle_cover_scene','battle_ballistics','battle_vision','battle_loadout','battle_ranged','cp2020_melee','shared_battle','crew_atlas','server','mobile_host']:
        module=importlib.import_module(name)
        if Path(module.__file__).parent!=Path(temp):raise SystemExit(name+' not loaded from APK')
    loader=unittest.TestLoader();suite=unittest.TestSuite()
    for pattern in patterns:suite.addTests(loader.discover(str(source/'tests'),pattern=pattern))
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():raise SystemExit(1)
    print('Exact APK Python and all public assets verified; packaged authenticated battle HTTP checks passed. Device execution not claimed.')
