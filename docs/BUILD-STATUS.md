# Build status — 2026-09-27

- Local Linux build: Windows GUI executable compiled with Mono against .NET Framework-compatible assemblies, with the application icon embedded.
- Local C# suites: BridgeCoreTests, SenderRuntimeTests, and MouseMotionTests passed. MouseMotionTests includes the stationary-cursor regression and actual loopback UDP delivery.
- Rust workspace: all 12 tests passed with the lockfile enforced.
- Windows receiver: built locally using the Rust Windows GNU target and MinGW. Its source was not changed by the game-mouse update.
- Native Windows Raw Input registration smoke test: supplied in the build script, but not yet executed. GitHub hosted runners did not start because the account's runner service was unavailable.
- Physical input during a real match: not yet verified. Use the gameplay verification checklist on Pantry.

The local build changed neither Pantry nor Canada's installed programs. The stream-PC package is included for repository completeness and future offline setup; the gameplay fix needs only Pantry's sender update.
