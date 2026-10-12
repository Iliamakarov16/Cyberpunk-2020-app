"""Check actual APK Python/static bytes and LAN HTTP entry for Android/Safari clients.
Uses only ephemeral accounts and SQLite files. This is not physical iOS/Android execution.
"""
import argparse,io,sys,tempfile,unittest,importlib,json,socket,http.client,hashlib,secrets
from pathlib import Path
from zipfile import ZipFile
p=argparse.ArgumentParser();p.add_argument('apk',type=Path);args=p.parse_args()
source=Path(__file__).resolve().parents[1];python=source/'android/app/src/main/python'
with tempfile.TemporaryDirectory(prefix='nc-apk-session-') as temp:
 root=Path(temp);code=root/'code';payload=root/'payload';code.mkdir();payload.mkdir()
 with ZipFile(args.apk) as package,ZipFile(io.BytesIO(package.read('assets/chaquopy/app.imy'))) as archive:
  for path in python.glob('*.py'):
   blob=archive.read(path.name)
   assert blob==path.read_bytes(),path.name
   (code/path.name).write_bytes(blob)
  with ZipFile(io.BytesIO(package.read('assets/server.zip'))) as static:
   expected={f.relative_to(source/'payload').as_posix():f for f in (source/'payload/static').rglob('*') if f.is_file()}
   assert set(static.namelist())==set(expected)
   for name,path in expected.items():
    blob=static.read(name);assert blob==path.read_bytes(),name
    dest=payload/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(blob)
 sys.path.insert(0,str(code))
 import mobile_host
 assert Path(mobile_host.__file__).parent==code
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 status=json.loads(mobile_host.start(str(root/'data'),str(payload),'192.168.43.1','qa-host',secrets.token_urlsafe(30),port))
 assert status['running'],status
 count=0
 try:
  for path in expected:
   route='/' if path=='static/index.html' else '/'+path.removeprefix('static/')
   c=http.client.HTTPConnection('127.0.0.1',port,timeout=10)
   c.request('GET',route,headers={'Host':f'192.168.43.1:{port}','User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1'})
   r=c.getresponse();blob=r.read();assert r.status==200,(route,r.status)
   assert blob==expected[path].read_bytes(),route
   c.close();count+=1
  print(f'{count} actual APK assets served byte-for-byte through the LAN browser-client HTTP route.')
 finally:mobile_host.stop()
 for name in ['battle_cover','battle_cover_scene','battle_ballistics','battle_vision','battle_loadout','battle_ranged','cp2020_melee','shared_battle','crew_atlas','server','mobile_host']:
  module=importlib.import_module(name);assert Path(module.__file__).parent==code,name
 loader=unittest.TestLoader();suite=unittest.TestSuite()
 for pattern in ['test_crew_atlas*.py','test_session_readiness*.py','test_mobile_host.py']:
  suite.addTests(loader.discover(str(source/'tests'),pattern=pattern))
 result=unittest.TextTestRunner(verbosity=2).run(suite)
 if not result.wasSuccessful():raise SystemExit(1)
 print('Packaged Atlas/session, persistence/restart and backup/restore tests passed. Physical Safari/Wi-Fi/device execution is not claimed.')
