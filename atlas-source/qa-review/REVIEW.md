# Atlas cyberdeck integration review

Status: PASS on the frozen source recorded in `tested-source-hashes.json`. No unresolved defects found within this review’s scope. Review completed 2026-10-11 UTC.

## Fixed defects

1. **Crew animations-off did not reach the iframe.** The new ring checked the child document’s `data-player-motion`, but the parent setting was not inherited. The theme bridge now copies and observes the same-origin parent setting. Independent tests passed for initial off, live on/off, and three pagehide/pageshow observer reconnect cycles, with immediate feedback/timer cancellation.
2. **The host entry cue survived persisted pagehide.** The host only observed visibility changes. An independent persisted-pagehide probe initially failed. The host now explicitly cancels the cue on pagehide and removes its listener during cleanup. The retained pagehide/pageshow test passes, including no replay.

## Evidence

- All eight catalog/geography/transit JS and JSON data files passed original SHA-256 provenance checks. The two catalog files have only the already-recorded `coverage.geographicBase` metadata correction. Exact current hashes and byte counts are in `tested-source-hashes.json`.
- Player-safe payloads, geographic coordinate systems and representative POI/source-plan selections were compared between source and the embedded runtime. The first comparison ran before the embedded mirror refresh; the mirror was subsequently refreshed at 12:24 UTC. The retained test now labels this comparison accurately as source/mirror parity, not an immutable historical baseline.
- Actual clamped camera values drive feedback. Wheel zoom at the detail limit causes no pulse, and settled idle has no pending RAF or feedback timers.
- Active standalone entry cancels for digital-off, motion-off, reduced motion, panel opening, hidden document, offscreen viewport, modal opening and pagehide; repeated readiness does not replay it.
- Same-origin Crew embedding does not play the standalone entry cue.
- The complete existing Crew DOM role/security, draft, Back, account-isolation and download scenarios also passed with `theme.js` and `cyberdeck.js` explicitly loaded by the independent wrapper. The standard Crew check does not itself load those two scripts.
- Existing `npm run check`, host integration and opening checks passed. The aggregate run performed in this review did not enable its optional live HTTP adapter.
- The parent separately reported the actual live HTTP/unit suite (17 tests) and full aggregate with `CREW_ATLAS_SOURCE` passed. Those are separate evidence, not claimed as independently rerun here.

## Retained independent checks

Run from `atlas-source`:

- `node qa-review/independent-integration.mjs`
- `node qa-review/independent-host-lifecycle.mjs`
- `node qa-review/crew-with-decoration.mjs`

These checks passed on the source hashes recorded alongside this report. Runtime files and existing tests were not edited by the reviewer.

## Limits

This review covers source contracts, DOM behavior, security/data boundaries and bounded scheduling. It does not establish real-browser layout, device/WebView gesture fidelity, raster decoding cost, GPU compositing, FPS or physical-device power use. Publisher browser QA and device QA remain distinct. No publication or APK was performed.
