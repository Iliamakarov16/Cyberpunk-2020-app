"""Validate the clean release source; optionally rebuild generated public payload.

Install pinned frontend/Atlas dependencies first; see README_REBUILD_0.17.7.md.
No signing keys, user data or credentials are involved.
"""
from pathlib import Path
import argparse,hashlib,json,shutil,subprocess,sys
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--build',action='store_true');args=p.parse_args()
r=Path(__file__).resolve().parent;m=json.loads((r/'SOURCE_MANIFEST.json').read_text())
for item in m['files']:
 path=r/item['path']
 if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:
  raise SystemExit('Source mismatch: '+item['path'])
print('Verified',len(m['files']),'release source files.')
if args.build:
 subprocess.run(['npm','run','build:crew'],cwd=r/'atlas-source',check=True)
 shutil.copytree(r/'atlas-source/dist/crew-client',r/'web-source/public/atlas',dirs_exist_ok=True)
 subprocess.run(['node','scripts/build-selfhost.mjs',str(r/'payload/static')],cwd=r/'web-source',check=True)
 subprocess.run([sys.executable,str(r/'scripts/package_payload.py')],cwd=r,check=True)
 subprocess.run([sys.executable,str(r/'scripts/package_payload.py'),'--check'],cwd=r,check=True)
 print('Generated browser/Android payload ready. Build and sign Android separately with the existing owner key.')
else:
 print('Generated payload is intentionally omitted. After installing dependencies, use --build or follow README_REBUILD_0.17.7.md.')
