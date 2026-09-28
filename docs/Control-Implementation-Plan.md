# Stream Deck and Reactives Implementation Plan

> For agentic workers: use superpowers:executing-plans inline. The user authorized execution of the draft design on 2026-09-28; keep all work local and installed PCs untouched.

Goal: optional Stream Deck controls for Canada OBS/Spotify, plus an experimental transparent Fugi visual relay from Pantry into Canada VTube Studio.
Architecture: add a separate Electron tray companion with an authenticated local API and certificate-pinned HTTPS LAN API. A supported Stream Deck SDK plugin talks only to Pantry's local companion. Existing tracking binaries and installers are unchanged.
Tech stack: Node/Electron, Elgato SDK, OBS WebSocket v5, VTS API, self-contained .NET 10 Windows media helper.
Spec: ../Stream-Deck-Reactives-Draft-Plan.md (source design outside this worktree).

## Global constraints
- No deployment or changes to Pantry or Canada in this task.
- New controls default disabled; only explicit configuration starts listeners/adapters.
- Install into a distinct versioned directory, create unique shortcuts and reversible startup/firewall changes; preserve prior versions and configuration backups.
- Local API: loopback TCP 5057 + per-user random token. LAN API: HTTPS 5056 + pairing token, SHA256 certificate pin and peer IP restriction. Overlay: loopback TCP 5058, read-only capability URL.
- Commands have IDs, a 10-second maximum lifetime, bounded queues, duplicate suppression, no automatic command retry. Unknown outcomes stay unknown.
- No Discord RPC tunneling, credentials in Git, arbitrary command execution, or access to tracking receiver tokens.
- The Fugi relay remains experimental until tested in a real Discord call; transparent PNG output and timeout clearing must be tested locally.

## Review focus
1. Unauthorized HTTP origins, peer addresses, certificate mismatch: reject before executing actions.
2. Lost acknowledgements/duplicates/expired commands: never replay one-shot actions, reject conflicting IDs.
3. Spotify absent with another media app active: return unavailable; never send global media keys.
4. Frozen visual feed: clear the remote overlay rather than display a stale speaking avatar.
5. Rollback after preexisting app/config/startup/firewall: restore exactly the managed artifacts, leave tracking untouched.

## Task 1: Transport and configuration
Files: control_app/src/{commands,server,client,config,frames}.mjs, control_app/test/*.test.mjs.
Interfaces: dispatcher.execute(command) -> Promise<result>; createApi(options) -> HTTP server; requestPeer(pair,method,path,body) -> Promise<result>; FrameStore accepts bounded PNGs and expires stale frames.
- [x] Write tests for command expiry, conflicting/duplicate IDs, queue bounds, auth/origin/source rejection, pinned TLS requests, malformed/oversized bodies and stale frames.
- [x] Observe failures, implement and run node --test.
- [x] Commit transport and tests.

## Task 2: App adapters
Files: control_app/src/{obs,vts,media,adapters}.mjs, media_helper/{MediaHelper.csproj,Program.cs}, protocol fixture tests.
Interfaces: dispatch(action,args) -> JSON result; supported actions: obs.scenes, obs.scene, spotify.play/pause/next/previous/status, vts.hotkeys/trigger, reactive.start/stop/status.
- [x] Write protocol tests with real local fake OBS/VTS servers and media process boundary tests. Observe failures.
- [x] Implement connection/auth/timeout cleanup, scene/hotkey discovery, Spotify-specific session selection.
- [x] Run tests and cross-compile self-contained Windows helper; commit.

## Task 3: Tray UI and reactive rendering
Files: control_app/src/{main,renderer,preload,reactive}.mjs, control_app/ui/*.
Interfaces: UI configure/enable/import/export pairing/start/stop/login browser; rendering publishes latest PNG through peer API; Canada serves only a read-only local overlay URL.
- [x] Test URL validation, frame bounds, navigation isolation and output transparency with a controlled Electron fixture.
- [x] Implement sandboxed Fugi browser and bounded 10fps PNG relay, status/configuration UI and tray lifecycle.
- [x] Verify local UI and mark actual Fugi/Discord and Windows behavior unverified; commit.

## Task 4: Stream Deck plugin
Files: streamdeck_plugin/src/*, *.sdPlugin/{manifest.json,ui/*,imgs/*}, tests.
Interfaces: property inspector persists target/action/args; plugin reads per-user local connection file and sends one expiring command per press. Provides dropdown discovery and polling feedback without replay.
- [x] Write tests for settings->command mapping, invalid settings, offline/error feedback, credential and protocol handling.
- [x] Implement Elgato SDK action and property inspector; build and validate package; commit.

## Task 5: Reversible packaging and verification
Files: scripts/{build-controls.*,Install-Control.ps1,Rollback-Control.ps1}, docs/Control-Setup.md, docs/Control-Build-Status.md, additive CI job.
- [x] Test installer/rollback against temporary managed files where Windows tooling is available; otherwise explicitly record unavailable native gates.
- [x] Produce versioned separate Pantry/Canada ZIPs and plugin with checksums; package installed runtime dependencies and media helper.
- [x] Run complete control/plugin tests, Rust regression tests, native C# tests when available, static package checks and branch review.
- [x] Preserve branch and baseline commit bd58b63; write manifest of artifacts, verification limits and exact rollback steps. No auto installation, merging or production settings changes.

## Completion limits

Local build tasks completed. Native Windows deployment, actual Stream Deck hardware, native Spotify playback and Fugi/Discord/VTS verification remain explicit gates; no installation was performed. Rollback filesystem/ownership logic and installer dry runs were exercised locally; real Windows registry/COM/firewall changes were not.

## Execution rulings
- The native worktree tool cannot find the nested repository; created a Git worktree under outputs/vtube-control-worktree on feature/stream-deck-reactives.
- Existing sender/receiver is additive integration only: new companion runs beside it rather than replacing it. This makes rollback independent of input tracking.
- Electron supplies a sandboxed Chromium renderer for the experimental visual relay; no undocumented Fugi API or raw Discord endpoint is exposed.
