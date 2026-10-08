# Canada relay lifecycle implementation plan

Design: [2026-10-07-canada-relay-lifecycle-design.md](2026-10-07-canada-relay-lifecycle-design.md)

1. Add explicit managed stdin-EOF shutdown support to the Rust relay while keeping legacy task mode behavior intact.
2. Replace the Canada status-only plugin with a child-process supervisor using persisted source configuration and per-user token/status files; expose startup, VTS, packet, and failure status.
3. Centralize Electron shutdown so plugin cleanup is awaited on all quit paths.
4. Add migration and restore scripts that preserve task XML/source, unregister only the old task, and never change firewall/VTS/OBS settings. Include them in the Canada package and installer messaging.
5. Update user-facing setup/build docs with the one-time migration and connection diagnostic flow.
6. Review the full diff, especially fail-closed behavior and exact task identity. Do not install, run migration, build, or deploy on either PC as part of this work.

Verification is intentionally deferred: the user requested implementation/review but did not request running tests, and the repository host is Linux while relay lifecycle is Windows-specific.
