# Night City Crew 0.17.4-mobile.1

Начни со [START_HERE.md](START_HERE.md). Подписанная тестовая сборка: постоянный package `app.nightcity.crew.mobile`, versionCode 170401, имя Night City Crew. Отдельная установка от старой ветки `.next`; перенос данных и его границы описаны в START_HERE.

Приватный ключ и пароли не включены. Владелец лично сохранил отдельную приватную копию; её чтение из Drive, холодное восстановление и повторная подпись проверены. Публичный сертификат находится в provenance/signing-public.

Для восстановления исходников: `python3 assemble_source.py`. Пользовательские базы, SDK и зависимости не включены.

- Android: Gradle8.11.1, JDK17, SDK35 / build-tools35.0.0
- Web: зависимости из lockfile; `node scripts/build-selfhost.mjs ABS_OUTPUT`
- TypeScript: `npx tsc --noEmit -p tsconfig.selfhost.json`
- Backend: `python3 -m unittest discover -s tests -p 'test_*.py'`
- Frontend: каждый `web-source/scripts/test-*.mjs` через Node
- Исторические результаты0.17.3 лежат в baseline/release-0.17.3.

Результаты и ограничения текущей сборки: QA_STATUS.md и RELEASE_INFO.json. Реальная установка и новая вёрстка на телефоне ещё не проверены. Публикации нет.
