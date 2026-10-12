# Atlas appearance synchronization correction

Scope: upcoming 0.17.6 source. No published 0.17.5 archive/APK changed.

## Reproduced failure

`theme.js` disconnected its same-origin parent appearance observer on `pagehide`, using a one-shot listener. It neither reread appearance nor reconnected on `pageshow`. A restored document could retain the old palette and stop receiving later parent changes. The new regression failed before the patch: expected `original`, actual `maelstrom`.

This establishes a reproducible lifecycle defect, not proof of the user's exact device interaction. Normal initial 2020 raster selection and the five distinct baked assets were already present. The source print and 2077/reference images intentionally retain their original artwork.

## Correction

- Reconnect parent observation and reapply current appearance on every `pageshow`; disconnect on every `pagehide`.
- Refresh appearance when returning to visible state.
- Emit the existing `nightcity-interface-change` notification after a local appearance update; native `storage` does not notify its writer document.
- Send current root appearance attributes from the iframe host rather than stale persisted settings when storage is blocked.
- Keep the existing five palette identifiers and `nc-atlas:appearance` event detail `{palette,treatment,digital}`. No geometry, camera, selection, asset, or filter-stack change.

## Verification

- New `checks/theme-sync.mjs`: all five palettes, two repeated restore cycles, standalone storage and embedded parent paths, raster href selection, subsequent live observation, unchanged camera/selection, exactly one raster and no live map filter.
- Extended `checks/dossier.mjs`: regression for restore and observer reconnect; existing untrusted-origin/source rejection preserved.
- Extended host and guest settings tests: explicit same-window notification and all five current/live appearance payloads, including stale persistence.
- Entire Atlas `npm run check` passes, including campaign, visibility and local-notes suites. Full log: `qa/palette-sync-check.log`.
- Existing battle appearance and launch-flow suites pass.
- Main web typecheck is blocked by a pre-existing missing `./.openai/hosting.json` import in `vite.config.ts`; the compiler reported no changed-file errors. This is not a full typecheck pass.

These are DOM/hook tests, not physical Android/browser pixel or FPS validation. Main build owner must regenerate standard Crew runtime assets before a native candidate; the private Site owner applies its own allowlisted refresh and publish workflow.

## Integration completed after the initial report

The standard Crew client was regenerated. Exactly theme.js changed in each production runtime copy (web-source/public/atlas and payload/static/atlas). All runtime paths and bytes match the generated manifest. The full Atlas suite was rerun with CREW_ATLAS_SOURCE set: the actual Crew HTTP cookie/CSRF/create/reveal/move/delete/private-projection checks passed along with DOM/lifecycle checks. Host CityAtlas and guest appearance tests passed again.

The separate private combat/Atlas website published the same bounded fix at commit eb41faae. Actual browser Back → appearance palette → Forward was checked for all five palettes; chrome and raster agreed and camera remained unchanged. This is browser evidence, not physical Android GPU/IME validation. No new APK was built; assembly awaits the owner's approval of the web result.
