# Atlas / Crew integration

This candidate keeps the complete standalone Atlas and adds a separate Crew client build. The released 0.17.2 source and APK are not modified by this directory.

## Cartography and appearance

- Detailed source imagery, all catalogue IDs, 2020 coordinates, plans, historical layers and NCART data are preserved. Eight original source files remain byte-identical. `atlas-data.json` and generated `data.js` differ only in `coverage.geographicBase`, corrected from a stale 2077 label to the actual cleaned 2020 reference. The check reverses exactly that recorded string and verifies the original hashes, proving no other bytes changed. See `qa/preserved-source-hashes.json`, `qa/source-metadata-corrections.json` and `checks/dossier.mjs`.
- The default 2020 base is an ink rendering of the existing cleaned image. SVG filters remove the blue-water texture, distinguish vegetation and convert the existing linework to the active Crew palette. No new roads are generated. The actual source coastline is used, without clipping to the coarser digitized coast.
- `Исходный цветной обзор` preserves the original print comparison. Source plans and 2077 remain independent reference layers; coordinates are never silently reprojected.
- `dossier.css` contains only isolated iframe styling. The five palettes match Crew. `theme.js` shares the existing `nc20.interface.v1` preference and preserves boot choices/other fields. Texture stays on panel headers; map labels, input values and numbers are not distressed.
- Search, era tabs and tools remain in one top bar. Selecting a location opens the existing collapsed bottom card. There is no permanent legend or extra bottom navigation.

## Build and include

1. Run `npm ci` and `npm run check` in this directory.
2. Run `npm run build:crew`.
3. Copy only `dist/crew-client/**` into Crew's static `atlas/` mount. Never copy this repository, `worker/`, `db/`, `node_modules/`, `qa/` or `dist/server/` into that public mount.
4. The generated client excludes standalone `campaign.js`. It uses `crew-campaign.js` and `crew-bridge.js`, backed by the actual Crew session and campaign membership.
5. Allow the mounted `.html`, `.js`, `.css`, `.json`, `.svg`, `.webp`, `.jpg`, `.png`, `.woff` and `.txt` resources. Paths must remain contained beneath the static mount. Allow framing only from this same application origin. No blanket frame-policy relaxation.
6. The iframe CSP permits only same-origin scripts/network and local/data/blob images. There are no inline scripts or eval. `connect-src 'self'` is needed for the authenticated Crew marker API.

## Parent contract

URL: `/atlas/index.html?crew=1&campaignId=<actual Crew campaign ID>&mode=gm|player`.

The mode is presentation, never authorization. Parent props must come from the selected campaign. Keep the parent character/battle drafts mounted when opening the iframe.

Messages are accepted only when `event.origin === location.origin` and `event.source` is the exact parent/frame window. Version is 1.

- Parent → `nc-crew:resume`: after the hidden iframe becomes visible, restore its actual aspect ratio without resetting selected location, editor or zoom. A zero-size hidden SVG is ignored.
- Parent → `nc-crew:back`: dismiss one map surface first; editor changes are guarded. Child acknowledges with `nc-atlas:back-handled`.
- Child → `nc-atlas:ready`, `nc-atlas:state` (`dirty`, `busy` booleans), `nc-atlas:exit`.
- Child → `nc-atlas:selection`: public location identity/source metadata only. Campaign secrets are not posted.
- Parent → `nc-crew:theme` (`settings`: existing preference JSON string or null). Same-origin only. The child also listens for storage changes and observes same-origin parent appearance attributes.

## Backend contract

The main source's `crew_atlas.py` owns namespaced `crew_atlas_*` tables. It uses actual Crew campaigns and accepted members, and neither imports nor trusts the standalone Sites campaign identity.

GET `/api/campaigns/{id}/atlas?view=gm|player` returns the current projection, revision and authenticated `viewer:{id,username}`. Each mutation first verifies `/api/me` against the editor’s original viewer and obtains its current CSRF token in memory; an account switch closes the old private draft instead of sending it under the new account.

POST `/atlas/markers`, PUT `/atlas/markers/{uuid}` and DELETE `/atlas/markers/{uuid}` require a unique command ID and `expectedVersion`. Create/update carry a full `marker` object. Each successful response includes a receipt and the fresh projection. Retries reuse the command ID; a stale revision is an explicit conflict, never an automatic overwrite.

Only the actual campaign GM can write. Player queries select only revealed markers and never select private note columns. Server checks membership on every request, including duplicate commands. Marker UUIDs, exact coordinates, source-map IDs, reveal state and private GM notes are included in the private campaign transfer extension and full backup.

## Private notes and export

- Synchronized marker GM notes remain server-private and are omitted from player projections.
- Separate per-location local notes require a verified GM viewer and are keyed by account ID, username and campaign ID on this origin. They are not encrypted or synchronized. Legacy global standalone notes are not imported into any Crew account. Standalone behavior is preserved.
- Access or identity changes clear displayed local notes and stale copy dialogs. Storage-failed drafts remain in memory under their original scope, survive location changes, and never render or block a different account. The current owner can retry saving, copy, continue editing or explicitly discard them before exit.
- “Скачать справочник” exports the static catalogue only. It hands a size-limited, exact-name Blob to the verified parent. Crew’s parent CSP permits `connect-src 'self' blob:` so its in-memory Blob fetch is allowed; the iframe’s API CSP remains same-origin only. Campaign markers and private notes travel through the existing private campaign transfer/backup, not this catalogue download.

## Share behavior

Revealed markers synchronize through the campaign API. A link is only a navigation shortcut for a logged-in approved member on that same server; it does not grant access. The native host uses a loopback origin. Such an address must not be advertised to players: the UI explains that players use the existing host connection address and open the campaign map. No IP address is guessed.

## Verification boundaries

`qa/*-overview.png` are static exports of the actual map SVG after its real JavaScript layer/label logic. They are not browser screenshots. The five palettes were inspected. `render-dossier.mjs` embeds a lossless PNG encoding of the source WebP for Inkscape compatibility; shipping assets are unchanged.

JSDOM validates app interactions, source integrity, theme preferences, campaign editor, scoped local notes, quota-failure recovery and navigation/lifecycle logic. Run `CREW_ATLAS_SOURCE=/path/to/NightCity_Crew_0.17.3-mobile.1_Source npm run check` for the full editor suite including its real HTTP stage. The independent `python checks/run-crew-live-http.py /path/to/NightCity_Crew_0.17.3-mobile.1_Source` also executes the actual JavaScript adapter against the live local Crew HTTP server with isolated ephemeral data. SQLite and real HTTP tests in the main source validate auth, mutations, CAS/dedup, restart, export/import and backups. These tests do not establish native touch geometry, keyboard behavior, SVG-filter performance on Android or final WebView layout.

The cloud browser cannot reach this executor's localhost, and file URLs are blocked by browser policy. Existing direct Chromium launches also fail on the runtime's socket/IPC constraints. No browser security restriction was disabled and no public preview was deployed.
