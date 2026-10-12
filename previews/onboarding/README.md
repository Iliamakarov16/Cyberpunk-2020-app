# NC Crew onboarding preview 0.3.0 — checkpoint

Design status: this is a preserved test checkpoint, not an approved final tutorial. The inline Анри call treatment was rejected and awaits an in-world 2020 mobile-game-style revision. The role cards were not rejected. This snapshot retains that rejected inline design for reproducibility; subsequent separate call experiments are not included.

Standalone Russian mobile interaction prototype. Original player flow: invitation → hero selection → creation → review → readiness → first action. New optional Анри text guide and separate local host flow: campaign setup → review → simulated invitation → simulated lobby.

## Local and optional by design

The first text call is an explicitly labeled scene, not a real call or user-detection feature. Анри is a friendly netrunner guide; all dialogue is centralized in `guideLine()` / `guideView()` in `app.mjs`. No audio, portrait, media permission, passwords or authentication. “Да, помоги” opens the player/GM choice; “Пропустить” and “Уже знаком” dismiss the guide and are remembered. The call and contextual hint collapse inline. Help (`?` / accessible name “Помощь и настройки превью”) replays the call in place, toggles hints for the current step, and opens the branch chooser without replacing drafts. Escape dismisses the incoming call, collapses an active hint, or closes Help. The original player invitation is usable without answering the guide.

Host setup accepts a name, premise and explicit GM STAT budget. The review produces an unmistakably учебное приглашение, with no link, join code, clipboard/send control or networking. A deliberate “Демо: добавить учебного игрока” action changes the local host lobby. Switching branches preserves the player's current step, sheets, cash receipt, pending action and the host's fields/progress independently. The host budget never overwrites a player draft.

No backend, real presence, character ownership, live session or campaign writes. Only scoped browser-local demo state is persisted. CSP denies all connections. A rejected/unavailable localStorage write shows a warning instead of claiming persistence. Same-origin persistence applies separately to public and private deployments.

## Compatibility

Storage schema remains **v1** and the key remains `nc-crew-preview:v1:preview-guest:night-shift-demo`. Existing 0.1.1 data is restored additively: player fields and cash rules are unchanged; absent guide/host fields get defaults. No localStorage clear, namespace move or silent reroll. `releases/0.1.1/` preserves the immutable pre-edit runtime, package and manifest for differential tests. Tests use a synthetic literal 0.1.1 session fixture plus differential migration against the old model.

Production reference is the saved 0.17.7 creation rules/catalogue. This interface does not replace the installed application. Budget 60 is an example GM campaign choice. Core cash is unchanged: monthly salary × max(1, floor(d6 / 3)); separate employment d6 of 5–6 means recently unemployed, per Core printed 25, 58–59. Rank 0 needs an explicit GM budget because the salary table starts at 1. Presets retain example rolls 3/2. Reload and Back never reroll.

## Run and test

Serve this directory over any local static HTTP server and open `index.html`; `qa.html` provides same-origin viewport sizes for browser inspection. Runtime has no dependencies. `npm test` runs model and DOM suites serially to keep browser-history timing checks isolated. `jsdom@26.1.0` is the sole declared dev dependency; the DOM harness imports it from the installed local package. Run `npm install` before `npm test`.

Public runtime allowlist: `index.html`, `style.css`, `app.mjs`, `model.mjs`, `data.mjs`, `qa.html`, `qa.mjs`. Do not publish source snapshots, test fixtures, reports or archives. `qa/runtime-manifest-030.json` records the 0.3.0 allowlist hashes. The manifest records the pre-publication freeze; `SOURCE_PROVENANCE.json` records the subsequent publication and bounded browser verification.

The catalogue is a bounded equipment subset. All ten Core roles and copied Core skills remain available. Lifepath is editable rather than inventing event tables. Cyberware purchases do not implicitly install it. Live campaign transport, GM ownership, invitation delivery and multiplayer readiness need separate production integration. DOM tests are not a physical-phone or native APK test. Serving or testing this directory does not publish a Site.

## 0.3.0 role selection

The identity step now has a compact cinematic CP2020 role deck. All ten Core roles are reachable through a horizontally scrollable role index, previous/next arrows, keyboard arrows/Home/End on the deck, or horizontal swipes on its artwork. Browsing is provisional: the displayed card is **not** the chosen role. Only the card’s explicit “Выбрать” button patches the character. The current selected role remains visible above the deck, and Continue validates that selection. Browsing never changes allocations, the saved character signature, cash rolls, readiness, or pending action.

“Список” is the experienced fast path: the existing native role selector commits deliberately on change, without a second confirmation. The mode switch itself never commits the displayed card. Both mode and provisional preview persist in additive `rolePicker` v1 state; the chosen role continues to live solely in the unchanged character draft. Missing/malformed old picker state safely defaults to cards and the draft’s selected role. Switching character slots aligns the preview to that character and retains the mode. No storage key/schema change or reroll.

Illustrations are ten original inline SVG equipment/technical scenes: armored vest/reticle, instrument/equalizer, cyberdeck/trace, circuit board/tools, medical case/vitals, camera/broadcast, badge, corporate briefcase/resources, contact/deal map, and nomad vehicle/road. No portraits, likenesses, external assets, fonts, or CP2077 artwork. Subtle role-specific sequences finish within four seconds; `prefers-reduced-motion: reduce` disables all decorative motion. No animation gates any action. Controls retain 44px minimum targets, with 46px deck controls. Compact and short-landscape CSS avoid fixed card heights.

Descriptions derive from the existing, unchanged `data.mjs` `CREATION_ROLES` catalogue: the first summary sentence describes the role; the remaining sentence provides the special-ability effect verbatim; Russian/English ability names remain unchanged. Team contribution text is a short non-mechanical paraphrase of those summaries and career skills. Techie and Medtechie are separate cards with separate visuals, abilities, and jobs.

Validation: 95 source/model/DOM tests pass (all original 75 plus 20 role tests). Covers ten roles and distinct SVGs, explicit commitment, compact mode, keyboard/swipe browsing, focus/live announcements, exact cash/allocations, reload/Back, old-v1 migration, malformed cache, host isolation, and reduced-motion/bounded-animation CSS. The DOM checks do not establish physical-device or pixel layout quality. The publisher subsequently verified the isolated public preview in a supported desktop browser at mobile-sized viewports. This is not a physical iPhone test. See `SOURCE_PROVENANCE.json` for the exact publication and evidence boundary. The APK and primary application are unchanged.

## Repository integration boundary

This directory is an isolated preview snapshot. No production authentication or app route is replaced. All runtime files match the reviewed 0.3.0 freeze. Repository packaging changes only this README and two test imports to remove workstation-specific paths, and adds scoped ignore/provenance files. Serve only the seven runtime allowlisted files for a public deployment; tests, old releases and provenance are development files.
