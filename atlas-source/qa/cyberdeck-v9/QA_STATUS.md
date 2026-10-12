# Atlas cyberdeck interface v9 · source checkpoint

Date: 2026-10-11. Application source target: Crew 0.17.6. Web-first candidate; no APK built.

## Changes

- Frameless full-viewport SVG map with compact identity/menu, bottom search/zoom/overview controls, and selected-location drawer.
- The same five existing Crew palettes. Default inheritance from the application; optional Atlas-only UI/map overrides. Raster and SVG map tokens remain synchronized without geometry reconstruction or runtime filter chains.
- Passive gesture-driven optical register and truthful relative zoom. No idle rotation, geographic camera offsets, hidden hit-area movement, or new per-label work during pointer bursts.
- A 560 ms readiness decoration. It never delays usable content, skips immediately on interaction, and obeys effects-off, reduced motion and page lifecycle. The React host owns Crew entry; the standalone page uses the identical CSS and does not double-play in Crew.
- Existing geography, published plans, catalog, POI IDs/coordinates, image assets, source-density limit, campaign editing, private marker filtering and local-note ownership are preserved.

## Verified source and integration

- Full `npm run check` with `CREW_ATLAS_SOURCE` pointing to the actual application source passed. It includes real authenticated Crew HTTP sessions, CSRF, role checks, create/reveal/move/delete, secret separation, draft/retry/Back/download/account-isolation and source preservation checks.
- Separate Python `test_crew_atlas*.py`: 17 tests passed.
- The actual self-hosted application frontend builds successfully (1978 modules). Its shell includes the transition stylesheet; static dependencies validate in an isolated QA web-payload ZIP. No Android APK was built or signed, and the Android asset archive was not replaced.
- All 125 base/UI/map palette combinations passed, including inherited parent motion, malformed storage, repeat page restoration, overrides, reset, and preference-storage failure.
- Performance contract: 120 pointer events schedule one camera frame; camera frames do not measure/rewrite marker geometry. Source-density zoom cap remains unchanged.
- React host transition, existing CityAtlas, map-to-battle-to-map navigation and guest appearance tests passed. Focused lint and component TypeScript passed. Whole-project TypeScript remains blocked by the pre-existing absent .openai/hosting.json used by vite.config.ts; it is not reported as passed.
- Independent review found and verified two fixes: parent animations-off propagation into the iframe; explicit host persisted-pagehide cancellation. Its retained probes are in qa-review.
- Generated Crew runtime is 115 files, 36,911,102 bytes, manifest SHA256 123838dabf70a6804076e81563f2eb1984cf50406f1ef221bd0a79ba233f3a23. Both web-source/public/atlas and payload/static/atlas match every generated file.

## Browser gate

The exact derived read-only Atlas is published on the existing owner-private main/combat test Site. Actual authenticated Chrome checks passed at 390×844, 844×390, 320×568 and 667×375: initial composition, search/results, bounded source-plan details, all five linked palettes, independent UI/map persistence and reset, actual SVG camera/relative-ring updates, effects-off with usable zoom, and Back restoration. Search result panes remain 438/205/162/190 pixels high respectively. No CSS correction was needed. See `BROWSER_QA.md` for deployment and evidence.

The browser roundtrip is longer than the 560 ms opening cue; exact sub-second early-skip timing and system reduced-motion are covered by source tests, not claimed as observed browser emulation. Browser layout evidence does not establish physical Android multitouch, IME, FPS or power use.

## Durable restoration

The source delta was applied to a fresh copy of the verified 0.17.5 cover source. Its full Atlas aggregate, including real Crew HTTP, passes. Both restored runtime mirrors match all115 generated files. The restored self-hosted frontend builds: HTML/CSS/Atlas bytes match, and app.js executable text matches after ignoring Vite-generated path-only region comments. The source delta deliberately excludes unfinished Aim work and does not replace the Android asset archive or build an APK.
