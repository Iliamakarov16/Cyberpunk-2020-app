"""Losslessly recompress an UNSIGNED Gradle APK; run SDK zipalign, then sign.
Stored entries remain stored (Chaquopy .imy assets rely on this). No file bytes
are changed. Never use this on a signed APK; signatures must be made afterward.
"""
from pathlib import Path
from zipfile import ZipFile
import copy,sys
source,target=map(Path,sys.argv[1:])
if source.resolve()==target.resolve():raise SystemExit('Use a separate output path')
with ZipFile(source) as old,ZipFile(target,'w') as out:
 names=old.namelist()
 if len(names)!=len(set(names)):raise SystemExit('Duplicate APK entries')
 if any(n.startswith('META-INF/') and n.endswith(('.RSA','.DSA','.EC','.SF')) for n in names):raise SystemExit('Input has a signature; unsigned APK required')
 for item in old.infolist():
  info=copy.copy(item);info.extra=b''
  out.writestr(info,old.read(item.filename),compress_type=item.compress_type,compresslevel=9)
with ZipFile(source) as old,ZipFile(target) as new:
 assert old.namelist()==new.namelist()
 for name in old.namelist():
  assert old.read(name)==new.read(name),name
  assert old.getinfo(name).compress_type==new.getinfo(name).compress_type,name
print('All APK entry bytes and stored/compressed modes preserved; bytes',source.stat().st_size,'->',target.stat().st_size)
