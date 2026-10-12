# Atlas refinement polish: published browser QA

Verified 2026-10-12, 00:40–00:42 UTC. This is the bounded resolution-step polish approved after the original coarse-to-sharp effect; no layout or map-content revision.

## Release and source

- Owner-private Site: https://night-city-mobile-test.adamantispolaris.chatgpt.site
- Direct route: https://night-city-mobile-test.adamantispolaris.chatgpt.site/atlas/
- Project: appgprj_6acae70644f081919cca210aad3ca357
- Prior commit retained: 6e91b79c3748e82d4cf40e07abd0742ca9ded739
- Published commit: 53be7024c4884bc7b35f2bb631704a6c5633cfb7
- Saved version: appgprj_6acae70644f081919cca210aad3ca357~appgver_da2a09f59f588191b85ad2851318dc49
- Deployment: appgdep_6acc2c6232548191a78ad4be62874fbb
- Native deployment succeeded: 2026-10-12T00:40:13.873919+00:00
- Archive SHA256: 763bd52f5c6262f71a39e0c49e8f326cc75ca1df6207adec4763dd8da9afccf3
- Source one-file freeze SHA256: 7e4852dca828b8a2722e429d2974e764763cdc256a316141a7069e1c41b4f1d7
- raster-refinement.js: 10,474 bytes; SHA256 01db78313b64d13b4fefbf2f37a8e565f7fe1201bb35848280798edb3889e616
- Derived read-only manifest SHA256: 7507da6dadfc5eb77bdc978cc4f0ed2eb8ccf7fdf6e2fd97108ebce7ed9dee7f

Access was freshly verified as custom owner-only: one owner, no groups, no external visitors. Audience unchanged. Source packaging and push used the supported Sites helper; publication used the owner-private deployment operation.

## Exact preservation and automated checks

Only raster-refinement.js and its derived provenance manifest differ in the Site output. All 156 other deployed files remain byte-identical out of 158 total. This includes the original map rasters, app JS/CSS bundle, combat and logo editor. No assets were added or removed.

The read-only Atlas test passed all 114 allowlisted files, frozen hashes, sanitized JSON/JS/export, static references, DOM boot/search/panels, fixed player mode, note isolation, zoom and gesture batching, eras, NCART and five palettes. Build passed. The existing large main JavaScript chunk warning remains informational; no bundle bytes changed.

Source delta is limited to scratch size 96 square, sample tiers 4/7/12/24/48/96, and local age thresholds 60/130/205/285/365/445 ms before clearing to the original raster. Existing 900 ms envelope, canvas budgets and lifecycle logic remain unchanged.

## Actual cloud-browser observations

The published HTTPS Site was opened in the existing authorized cloud Chrome profile, with a normal same-origin QA iframe. No browser security changes, injected application behavior or private-state inspection were used.

- Normal portrait entry created the real refinement canvas. Consecutive actual captures showed coarse-to-fine original raster pixels, with the separate vector labels remaining crisp.
- Zoom-in updated the SVG viewBox immediately from width 880 to 660. Consecutive captures showed the localized refinement progressing through the extra resolution steps.
- Both entry and zoom finished with zero temporary canvases/overlays. The original image element remained present and used assets/geography-2020/dossier-v8/carmine.webp. Visual inspection of the settled captures found the original sharp map intact.
- Replay from the settled tools drawer via Enter started a preview wave. ArrowRight cancelled it immediately and moved the map; ordinary pan alone created no wave.
- Landscape replay also displayed progressive source sampling and returned to zero canvases with the original raster visible.
- Actual widths at 390×844, 844×390, 320×568 and 667×375 equalled body scrollWidth. No horizontal overflow was observed. Measured compact-landscape menu/search/zoom/overview controls retained 44 px height; zoom/menu controls were 44×44 px.
- Captures were inspected directly. They remain internal QA evidence, outside the source archive.

No code defect or new layout blocker was found in this bounded retest. Earlier source and browser coverage for effects-off, cold-image readiness and interruption remains applicable because those lifecycle paths are byte-identical. This run did not re-test every unrelated editor or campaign feature.

## Limits

This verifies real SVG/Canvas2D rendering and HTML/CSS in the cloud browser, not physical Android/iOS gesture behavior, native WebView performance, FPS, thermals or the newly assembled APK. The browser viewport host is a static read-only Atlas; authenticated multiplayer and native host integration are covered separately by the release author. Reduced-motion and forced slow-network behavior were not emulated in this browser pass.

The map retains its existing source/confidence distinctions; the effect does not create new cartographic detail or establish that every reconstructed location is verified 2020 canon. The separate Little Italy 3D Site and its known WebGL context-null limitation are outside this update.
