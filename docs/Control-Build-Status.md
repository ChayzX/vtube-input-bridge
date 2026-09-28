# VTube Control preview build status

Version: 0.2.0-preview.1. Built on Linux for Windows x64. No Pantry or Canada installation, program restart, firewall change, OBS configuration, VTS configuration or Discord/Fugi account authorization was performed.

Automated verification covers command expiry/deduplication/admission, auth/origin/source filtering, certificate pin-before-token, local OBS/VTS protocol fixtures, Spotify session selection, configuration serialization, safe Fugi routes and browser permissions, transparent offscreen rendering, and relay frame timeout clearing. See the final build report for actual command results.

The Stream Deck SDK plugin builds locally and is checked with Elgato’s validator. The private repository URL may produce a validator warning when checked without authentication.

Remaining Windows gates: native Spotify media session control, Stream Deck hardware and installed runtime compatibility, installer/rollback with actual Windows registry/shortcuts/firewall, signed-in-user startup, actual Fugi/Discord speaking updates and VTS Web Item rendering, simultaneous game mouse tracking under control load. Cross-compilation and simulated app protocols do not prove these gates. Packages are unsigned previews.

Rollback is additive: the baseline tracking commit is bd58b63 and its sources/installers are unchanged. Keep installed tracking packages. New companion directories/startup/firewall/shortcuts have independent names and rollback records.
