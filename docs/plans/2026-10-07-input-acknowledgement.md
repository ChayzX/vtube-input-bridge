# Input Acknowledgement Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show when Pantry input has been accepted and applied by Canada, and retry local sender restarts while tracking remains enabled.

**Architecture:** Canada returns a sequence-matched UDP acknowledgement from its existing port 5055 socket after VTube Studio applies input. Pantry receives it on the same ephemeral UDP socket used for sending and presents an acknowledgement freshness state. CI cross-compiles and includes the Windows relay inside the versioned Canada app package.

**Tech Stack:** Rust/Tokio relay, C#/.NET Framework sender, Electron/Node UI and supervisor, PowerShell packaging, GitHub Actions with MinGW.

## Global Constraints

- Do not deploy, run installers, migrate, or modify either PC.
- Do not add or run tests in this task.
- Do not create or modify firewall rules, VTube Studio settings, OBS settings, or gaming PC configuration.
- Keep input UDP port 5055 and the exact Canada source-IP filter.
- Treat acknowledgements as proof of an accepted packet and successful VTube Studio injection request, not proof of a model visibly reacting.

---

### Task 1: Receiver acknowledgement and Windows payload

**Files:**
- Modify: `vts_input_relay/src/main.rs`
- Modify: `scripts/build-controls.ps1`
- Modify: `.github/workflows/build.yml`
- Modify: `control_app/src/main.mjs`

**Interfaces:**
- Consumes: the existing version 1 JSON `Packet` with `sequence` and sender endpoint returned by `UdpSocket::recv_from`.
- Produces: JSON `{type:"ack",version:1,sequence:<u64>}` sent to the source endpoint only after the VTS injection and expression update complete.
- Produces: `control_app/relay/vts_input_relay.exe` in each Canada application package.

- [x] After the existing source-IP and packet checks and successful VTS calls, send the acknowledgement. A failure to send the reply is logged and does not terminate input relay.
- [x] Cross-compile `vts_input_relay` for `x86_64-pc-windows-gnu`, package its executable in the app manifest, and launch the versioned copy from Canada.
- [x] Confirm by code review that legacy ProgramData task files remain untouched and that the prior migration rollback still points to its preserved executable.

### Task 2: Pantry acknowledgement state and retry behavior

**Files:**
- Modify: `windows_app/SenderRuntime.cs`
- Modify: `windows_app/HeadlessSender.cs`
- Modify: `control_app/src/plugins/tracking.mjs`
- Modify: `control_app/ui/app.js`

**Interfaces:**
- Consumes: matching ACK datagrams from the configured Canada address and destination UDP port, with a sequence below the sender's next sequence.
- Produces: `receiverConnected`, `lastAckSequence`, and `lastAckUnixMs` status fields.
- Produces: Pantry states `Connected` and `Waiting for Stream PC`; local send count remains explicitly a sent-packet count.

- [x] Receive on the same `UdpClient` used for UDP 5055 sends; discard invalid JSON, wrong sender address/port, unsupported versions, future sequence numbers, and stale/out-of-order acknowledgement updates.
- [x] Consider the receiver connected only when a valid acknowledgement is no older than 2.5 seconds.
- [x] Retry a stopped sender with bounded backoff while the user's start preference remains enabled; explicit Stop clears retry state.
- [x] Show Canada-facing checks when Pantry keeps sending without a recent ACK.

### Task 3: Documentation and review

**Files:**
- Modify: `docs/Control-Setup.md`
- Modify: `docs/Control-Build-Status.md`
- Create: `docs/specs/2026-10-07-input-acknowledgement-design.md`

- [x] Document state meanings, common failure interpretation, exact update requirement on both PCs, and the firewall limitation.
- [x] Review the diff for protocol consistency, package paths, and unchanged firewall/task rollback boundaries.
- [x] Defer compilation, tests, Windows firewall verification, and two-PC verification; report these limitations explicitly.

## Unresolved decisions

None. The user approved the acknowledgement design. Deployment and live two-PC verification remain separate actions.
