# Rebuild 0.17.7 game-day source

This source is the clean tested release, with the integrated Atlas and Russian session guide. No unfinished localization,3D prototype, signing material or user database is included.

The archive omits generated Android build/cache output, node_modules, the duplicated payload/static directory, mirrored web-source/public/atlas, and the generated Android server.zip. Recreate them in this order:

1. Install the pinned frontend dependencies using web-source/pnpm-lock.yaml and the Atlas dependencies. Use Node22.13 or later and Python3.
2. In atlas-source run npm run build:crew. Copy the complete dist/crew-client directory to web-source/public/atlas.
3. In web-source run node scripts/build-selfhost.mjs ABSOLUTE_SOURCE_ROOT/payload/static.
4. From the source root run python3 scripts/package_payload.py. It validates the complete browser/Android payload before generating android/app/src/main/assets/server.zip.
5. Run the frontend scripts/test-*.mjs, self-hosted TypeScript, Python unittest discovery, Atlas npm run check with CREW_ATLAS_SOURCE=ABSOLUTE_SOURCE_ROOT, and the Java extractor tests. Atlas DOM tests may need NODE_OPTIONS=--max-old-space-size=1536 because they retain several complete maps.
6. Use official Gradle8.11.1, JDK17 and Android SDK35 for android assembleRelease. Keep package app.nightcity.crew.mobile, version170701/0.17.7-mobile.1 and the existing owner's signing identity. No key is supplied here; do not generate a replacement key for an update.
7. Run scripts/recompress_unsigned_apk.py if needed, sign with the existing key, then verify DEX, certificate, ZIP alignment and scripts/verify_apk_session.py plus verify_apk_battle.py against the final APK.

QA reports distinguish source/HTTP/DOM/Java checks from actual device execution. The old test raw-file mismatch was a committed SQLite WAL checkpoint; the final test stabilizes the baseline while retaining exact bytes, all-table equality and the no-initialize guard. No backend behavior was changed for it.
