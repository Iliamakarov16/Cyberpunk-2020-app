# 0.17.7 refinement update

See RELEASE_INFO.json, REFINEMENT_UPDATE_0.17.7.md and qa/results/release-0.17.7 for this update. The prior0.17.6 verification below is retained as baseline history; current evidence is recorded separately.

# 0.17.6 game-day verification

Final APK SHA256: d51907fdb48de67b5fe7c2785394b88c81b8a91867ed07c0dcdb54149340fed1
Package: app.nightcity.crew.mobile · versionCode170601 · versionName0.17.6-mobile.1
Existing signing certificate SHA256: a2fa4bb60a344d90961b5f718301247655a5b15f5965ea6c80cb8c37fbb60117

## Passed
-528 Python tests across preserved backend, privacy, transactions, migration and asset delivery.
-75 frontend scripts and self-hosted TypeScript; production self-hosted build.
-Full Atlas aggregate including real authenticated GM/player HTTP editing, secret filtering, retries and lifecycle. A memory-limited earlier DOM run was rerun cleanly with1536MiB V8 heap; no assertions were skipped.
-Actual final APK code/assets:61 session/Atlas/backup/restart tests and42 battle tests; all212 public assets served byte-for-byte through the LAN HTTP route.
-766 production Java extractor tests against the signed APK; malformed/missing assets and data preservation.
-Actual old→new versioned payload extraction while preserving valid SQLite bytes, preferences and prior payload. Native marker, server/API and frontend version aligned.
-Independent46-check persistence audit; a1→57-page SQLite main-file discrepancy was reproduced as committed-WAL checkpoint timing with all28 logical tables unchanged. Final test checkpoints before the byte baseline and retains the exact-byte, logical-state and no-initialize assertions;12 repeated independent probes passed.
-Actual Tracker lessons navigation/reopening with tutorials disabled. New Russian guide covers connection, joining, Atlas, current shared battle, saved data and manual-loot limits.
-Previous Atlas browser QA at390×844,844×390,320×568 and667×375 remains applicable to unchanged map runtime. Its report is under atlas-source/qa/cyberdeck-v9.

## Not claimed
-Physical installation/upgrade on the owner's Android device, physical Safari and the group's real Wi-Fi still need a smoke test.
-New guide verification is actual component/hook and layout-contract coverage, not a new browser screenshot.
-No full-app EN/UK translation, experimental3D district or new loot-transfer mechanic is included.
-Source-based rule, canvas, DOM and HTTP checks do not prove all CP2020 mechanics, phone performance or exact OS keyboard behavior.

Final logs: qa/results/game-day-0.17.6. Historical reports remain in other QA/baseline folders and must not be read as fresh tests of this release.
