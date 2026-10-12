# Atlas cyberdeck presentation: browser acceptance

Date: 2026-10-11, 12:30–12:35 UTC.
Published owner-private URL: https://night-city-mobile-test.adamantispolaris.chatgpt.site/atlas/
Project: appgprj_6acae70644f081919cca210aad3ca357
Commit: 892f712feb33ccfdfc326d18b3c61e0e5745c0b4
Version: appgprj_6acae70644f081919cca210aad3ca357~appgver_66661e59f2188191baca70f5096423ae
Deployment: appgdep_6acb814106708191948277378e66a246, succeeded 2026-10-11T12:30:01.705382+00:00
Derived read-only manifest SHA256: 404b39dc7b7d1f6f25cf1d3876c8bb4a90de0f92805e44e93f02e1368b78a690
Deployment archive SHA256: dc7d5b95e5824996afef09aa374d0805f5916f8b7908124282f8ac0e116fc127
Canonical generated Crew manifest: 123838dabf70a6804076e81563f2eb1984cf50406f1ef221bd0a79ba233f3a23

## Scope and checks
The existing read-only standalone adapter copied 113 allowlisted runtime files. Campaign scripts, personal notes and write controls remain excluded/disabled. The four explicitly transformed files are index.html, app.js, atlas-data.json and data.js; output/source hashes are retained in readonly-manifest.json. The main battle implementation was unchanged. Full host regression: 280 unit cases, shared BattleApp integrations, Atlas DOM tests and viewport tests passed. Build and 150-file asset audit passed. Prior deployed source eb41faaec3508d12f50ad44c10ae5adfd313fdc0 was retained.

Actual authenticated cloud Chrome rendered the SVG map, HTML and CSS in same-origin iframes at 390×844, 844×390, 320×568 and 667×375. This is responsive layout testing, not a physical phone, keyboard or FPS claim. No browser security setting was changed.

- Initial map and controls render with the requested compact overlay composition. Portrait controls are 44px high; zoom/menu targets are 44×44. No horizontal document overflow in checked sizes.
- Search for Тотентанц returns two distinct source records. Results areas are 438px at 390×844, 205px at 844×390, 162px at 320×568 and 190px at 667×375. Both cards fit in every tested viewport.
- Selecting the Core Rulebook record opens a bounded, independently scrollable detail sheet. At 320×568 the sheet is x8/y208.64/w304/h295.36; content area192px. Its source warning explicitly distinguishes the fan overview match from the original source address. The “Исходный план” control routes to assets/core-2020.webp, labelled64numbers/printed221/PDF222.
- All five linked palettes select matching interface tokens and dossier raster assets. Independent ultraviolet UI/amber map survive reload. Relinking restores application Carmine. Static reference artwork remains source-colored.
- Actual zoom changes SVG viewBox (880-wide to660-wide), updates relative ×1.33 and settles optical arcs; ring pointer-events is none and no idle CSS animation is present.
- Effects-off hides the ring, applies is-paused and0s transitions while map zoom continues (×1.78). Effects-on and application-linked defaults were restored.
- Direct /atlas/ URL verified after redirect. Navigation to main test and Back restores map/palette; no opening layer remains stuck.
- The browser roundtrip is longer than the560ms entry effect. Exact early-skip timing and reduced-motion behavior were source-tested, not claimed as directly observed browser emulation.

Screenshots retained locally for internal visual review, not included in the source archive. Root inspected the initial portrait/landscape captures. Source confidence labels and existing coordinates were preserved; no blanket claim that all overview geography or POI positioning is exact canon is made.
