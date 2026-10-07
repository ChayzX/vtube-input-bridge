# VTube Control preview build status

## Lifecycle update (2026-10-07)

Source version is now 0.3.0-preview.2. Canada relay ownership, task migration, and sender acknowledgement changes are implemented locally but have not been built, tested, or installed. The previous verification below describes the earlier preview only; it does not verify this update. No changes were made to either PC.

Connection review: the prior Pantry `Sending` status was local-send evidence only. Preview.2 adds a sequence-matched acknowledgement after Canada accepts a packet and VTube Studio applies it; Pantry now distinguishes that from unconfirmed local sending. Canada still filters by the exact saved Pantry source IP and retries VTube Studio websocket failures every three seconds. The new app supervisor is intended to restart receiver exits. A wrong Pantry IP, a VTS authorization/API issue, or a blocked reply path still needs diagnosis and cannot be fixed by retrying alone. The Windows cross-build and the UDP reply under the installed PC firewall policy remain unverified.

Version: 0.2.0-preview.1. Built on Linux for Windows x64. No Pantry or Canada installation, program restart, firewall change, OBS configuration, VTS configuration or Discord/Fugi account authorization was performed.

Automated verification covers command expiry/deduplication/admission, auth/origin/source filtering, certificate pin-before-token, local OBS/VTS protocol fixtures, Spotify session selection, configuration serialization, safe Fugi routes and browser permissions, transparent offscreen rendering, and relay frame timeout clearing. Results: 21 control tests, 4 plugin tests, 12 Rust regression tests and 4 Spotify identity checks passed; both PowerShell installer/rollback fixture suites passed. Electron tests passed for transparent output, settings-page rendering and production-renderer-to-frame-store timeout clearing. Both npm dependency audits reported zero known vulnerabilities. The Windows x64 media helper cross-compiled successfully. Elgato packaged the plugin with one warning: unauthenticated access to the private repository URL returned 404.

The legacy Mono suite could not run in this session: `scripts/test-mono.sh` exited 127 because `mcs` is unavailable. Its sources and the existing tracking installers are unchanged from bd58b63. This is an environment verification gap, not a passing test claim.

The Stream Deck SDK plugin builds locally and is checked with Elgato’s validator. The private repository URL may produce a validator warning when checked without authentication.

Remaining Windows gates: native Spotify media session control, Stream Deck hardware and installed runtime compatibility, installer/rollback with actual Windows registry/shortcuts/firewall, signed-in-user startup, actual Fugi/Discord speaking updates and VTS Web Item rendering, simultaneous game mouse tracking under control load. Cross-compilation and simulated app protocols do not prove these gates. Packages are unsigned previews.

Rollback is additive: the baseline tracking commit is bd58b63 and its sources/installers are unchanged. Keep installed tracking packages. New companion directories/startup/firewall/shortcuts have independent names and rollback records.
