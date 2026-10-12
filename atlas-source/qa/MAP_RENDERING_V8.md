# Atlas rendering update · 2026-10-11

## Final input and registration

- User-supplied direct URL: https://pd57k0blcbk.preview.infomaniak.website/wp-content/uploads/2024/09/NIGHT-CITY-WCBK-2020-scaled.jpg
- Downloaded original: 2560 × 2012; 1,047,282 bytes; SHA256 d2292baa77d2d7b46c8b41ab311ddc6e858dc91dd2c817fef506e996ec040991.
- Earlier in-chat attachment: 2048 × 1610. Embedded v7 original: 1536 × 1207. Final input has approximately 1.67× as many pixels per axis as v7.
- Same 1536 × 1207 logical source frame, crop [442, 0, 1536, 1207], and projection. Final effective crop is approximately 1823 × 2012. No POI, district, transit or campaign coordinates moved.
- Existing annotation-cleanup windows retain the older cleaned pixels, covering 6.952% of the original crop. Their detail has not become independently verified geometry.
- `qa/overview-v8-registration.json` records exact projection and source provenance. Raster appearance is precomputed into 2048-square lossless WebPs; no invented roads, upscaled “new detail”, or 2077 tiles substituted.

## Renderer and interaction changes

- One palette image replaces both live filtered SVG images and their filter surfaces. Five existing app palettes are supported, with the same-origin theme bridge unchanged. Printed original remains optional.
- Pointer events update camera state; requestAnimationFrame writes the latest viewBox at most once per scheduled frame. POI sorting, label placement and marker geometry refresh after a gesture settles. Wheel bursts settle after 120 ms. Pointer cancel/lost capture/page hide flush pending state.
- Removed synchronous SVG getBBox measurements from layout. Map labels remain 12 CSS px, selected label 14 CSS px. Text has a dark screen-scaled halo; configured text-to-halo contrasts are {"carmine": 16.42, "ultraviolet": 17.63, "amber": 16.81, "maelstrom": 17.75, "original": 15.92}.
- Source-density zoom bound uses 1024 / 2012 world units per source pixel, up to 2 CSS pixels per original pixel. A visible limit notice offers the selected location’s detailed source plan. Separate original sector plans (18 central plans, 1578 × 2082 each) and Corporate Plaza (1464 × 1809) provide more local detail, without pretending they are seamless overview tiles.
- All 25 districts retain labeled keyboard/click selectors. Editorial Voronoi masks are no longer painted as canonical boundary lines. Coordinates stay available for existing zoom/navigation.
- Approximate-sector and shared-parent POIs now show explicit precision badges and compact context. Name-matched points retain a source-caution note. The pre-existing MetalStorm district/point inconsistency is disclosed rather than silently corrected.

## Verification

Passed:
- Entire `npm run check`: catalog/source integrity; 25 districts, 433 catalog records and 64 core points; map UI; camera scheduling; campaign storage and permissions; all 625 NCART routes; five themes and trusted-origin theme behavior; Crew adapter CRUD, exact-coordinate move/cancel, delete/cancel, Back/Escape/draft recovery, download origin/ack, player filtering, account+campaign-scoped notes, and hidden-iframe lifecycle.
- Final `checks/map-performance.mjs` and `checks/map-ui.mjs` rerun after label-bound refinement.
- Camera contract at 390/640 px: 120 pointer moves queue one frame; zero per-marker writes during gesture frames; no getBBox calls; selection unaffected by pan; pinch, cancel, zoom limit and original-plan navigation pass.
- Real isolated Crew HTTP + browser adapter DOM: CSRF/session handling, create, exact-coordinate move/reveal, private player projection, forged role rejection, delete.
- Existing protected original assets and coordinate data verified unchanged by `checks/dossier.mjs`.
- Static map renders inspected at phone width in carmine and amber; overview checked. Palette assets use the same preserved registration.
- No-campaign static map initialization/search verified for the private web-test route.
- Generated Crew allowlist copied to both `web-source/public/atlas` and `payload/static/atlas`; all 111 files SHA-identical. Runtime manifest SHA256: 765f354be99c774e7b991fc75f62bbf4d84b35e205fcc47c16814314e9075bef. Exact changes: `qa/map-v8-integration.json`.

Limits:
- No physical-phone/WebView FPS or GPU memory measurements. DOM scheduling tests are not a frame-rate benchmark.
- Static SVG renders do not establish native browser touch or UI layout behavior.
- The source remains raster; arbitrary close zoom cannot show missing detail. Boundaries and most overview registrations remain approximate. Existing source data was not broadly relocated or re-audited.

## Source regeneration

Run `python3 scripts/build-overview-v8.py`, then `python3 scripts/build-dossier-basemaps.py` (Pillow and NumPy), then `npm run check` and `node scripts/build-crew-client.mjs`. New raw/clean intermediate rasters remain in the source archive but are omitted from runtime output. Source registration and color-bake manifests are in qa/.
