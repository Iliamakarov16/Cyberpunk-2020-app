# Hosting from this computer

Runs the same GM server as the Android app (website, Atlas map, shared battle, iPhone install page) on this Mac.

    python3 host_computer.py          # or double-click host.command

- First run builds `payload/` if it is missing. That needs the dependencies installed first: `npm ci` in `atlas-source`, `npx pnpm@11.25.0 install --frozen-lockfile` in `web-source`. After that, starting the server only needs Python 3.
- First launch asks for the GM login. There are no passwords: every account is just a unique login, and anyone who types a login signs in as that account.
- Players on the same Wi-Fi open the "Players" address it prints. iPhones can open `/mobile/install-ios` for the home-screen icon.
- Data: `~/Library/Application Support/Night City Crew` (change it with `--data`). Daily and migration backups go to `backups/` inside it.
- Options: `--port 8080`, `--local-only`, `--lan-ip 192.168.x.x`, `--build` (rebuild after source changes).
- If macOS asks whether Python can accept incoming connections, click Allow. Ctrl+C stops the server.

The server only serves plain HTTP on your local network. Don't port-forward it to the internet as is.
