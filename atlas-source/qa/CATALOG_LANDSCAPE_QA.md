# Catalog short-landscape correction · 2026-10-11

## Actual defect

Authenticated cloud-browser QA of the real production Atlas iframe at 844 × 390 CSS px found a 286px catalog panel. Its 65px heading and 206px search/filter area left #results only 16px high, entirely padding. Two search results for «Тотентанц» were effectively inaccessible.

## Bounded fix

Only `public/style.css` changes at runtime.

- At viewport heights ≤500px and widths ≥600px, the catalog uses a two-column grid: search/filter controls on the left, independently scrollable results on the right, shared heading above.
- Explicit top/bottom constraints prevent the mobile-width breakpoint from collapsing the grid. Embedded mode preserves its 16px top inset.
- At heights ≤500px and widths ≤599px, the entire catalog scrolls and result cards no longer flex-shrink into an unusable pane. The heading remains sticky.
- Search/filter controls retain a minimum 44px touch target. Normal-height portrait layouts are unchanged.
- No map data, marker coordinates, app JavaScript, account state or backend changed.

## Verification

Passed:
- Full `npm run check`, including the new CSS structural contracts imported by `checks/map-ui.mjs`.
- Focused `checks/catalog-layout.mjs`, `checks/map-ui.mjs`, `checks/map-performance.mjs`, and `checks/visibility.mjs`.
- Actual published browser at 844 × 390: #results clientHeight=233 and scrollHeight=233, compared with 16 before the fix. Both «Тотентанц» cards are fully visible and 70px tall.
- Expanding filters retains the 233px results pane; the left controls scroll independently.
- Measured buttons/selects are at least 44px high; the search field is 48px.
- Activating the first result opens its actual detail title and canonical page reference.
- All 111 generated Crew files match both runtime copies; only style.css changed from the previous snapshot.

This is real cloud-browser viewport QA, not a physical phone/WebView/keyboard or FPS measurement. Extra 667 × 375 and 390 × 360 viewport checks are supplementary and remain with the browser QA task.

## Integration identity

- `public/style.css` SHA256: 099f8d6b265705b3b1b0758d09f3c9881701f205f248c2849690ccbfdffe747b
- Updated `qa/crew-client-manifest.json` SHA256: 9093e305a652287a9735b21e1abee3ceddef116abfa09977511a26111d217adb
- Full aggregate log: `qa/catalog-landscape-checks.log`
- Runtime sync report: `qa/catalog-landscape-integration.json`

The prior renderer-only manifest recorded in MAP_RENDERING_V8.md is historical; this manifest includes the subsequent responsive catalog correction.
