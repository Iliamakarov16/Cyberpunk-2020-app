# 0.17.7 final gates

528 Python tests passed on the final source,75 frontend scripts passed, selfhost TypeScript and web build passed. The initial aggregate had two outdated0.17.6 version-fixture assertions; these were updated to0.17.7 and the full528-test aggregate was repeated successfully. No runtime repair was needed for those assertions.

The final signed universal APK passed61 packaged session/persistence tests and42 packaged combat HTTP tests. All213 public browser assets were served byte-for-byte through the actual packaged server.782 production Java extraction checks and actual0.17.6→0.17.7 extraction/reuse passed, preserving a SQLite fixture, preferences and prior assets. The optional new raster script is now included in required native extraction integrity checks.

Independent verification confirmed the same package/certificate as0.17.6, both ABIs, binary manifest170701/0.17.7-mobile.1, DEX extraction marker,116 exact packaged Atlas files, and unchanged map geography. Python code differs from0.17.6 only in the application version string; battle/inventory/session mechanisms are unchanged.

Actual browser transition and layout findings are in BROWSER_QA_ATLAS_REFINEMENT_POLISH.md. No physical phone/FPS/Safari proof is implied.
