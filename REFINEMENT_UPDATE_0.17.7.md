# 0.17.7: accepted Atlas image refinement

The existing0.17.6 app remains a fallback. This update uses the same Android package and permanent signing identity. Install over the existing app; do not uninstall it or clear its data. If a session is already in progress, update at a break: stop the Android host, install, reopen and restart hosting, then let players reconnect. The host link is shown by the app; Wi-Fi/IP changes can require a new link.

The Atlas now reconstructs its actual source image in spatial regions on entry and zoom-in. Six intermediate source-resolution tiers make the accepted transition smoother; completion restores the unchanged full-resolution raster. No additional map detail is invented. Digital effects off, reduced motion and immediate input cancellation remain supported. Campaign data, controls and vector labels retain their original roles.

The change contains no translation, separate3D district or new combat rules. New asset extraction uses payload-v0.17.7-mobile.1 and was tested against the real0.17.6 payload while preserving a SQLite fixture, preferences and prior assets. Physical installation still needs the usual owner smoke test.
