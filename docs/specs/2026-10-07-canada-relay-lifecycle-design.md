# Canada relay lifecycle and connection reliability

Date: 2026-10-07
Status: approved for local implementation; no installation or changes to Canada/Pantry.

## Goal

Make the Stream PC app own the VTube Input Relay process. Launching the app starts the relay; choosing Exit from the tray stops it and waits for it to exit. Closing the window continues to hide the app in the tray. Keep VTube Studio, OBS, the gaming PC, and firewall configuration untouched.

## Runtime design

- `TrackingReceiver` starts `vts_input_relay.exe` as a hidden child in the signed-in user's session. It passes the migrated Pantry IPv4 address and stores the VTS token and status below that user's `%LOCALAPPDATA%`.
- The relay gets an explicit managed mode. Closing the app's stdin asks the relay to stop; legacy scheduled-task mode continues to ignore stdin and is unchanged.
- The receiver supervises unexpected exits with bounded exponential delays. Intentional app shutdown cancels restart and waits for child exit; failure to stop is reported and must not be treated as clean shutdown.
- App shutdown is centralized so tray Exit, startup failure, and Electron quit all await plugin cleanup before `app.quit()`.
- Status distinguishes relay startup, receiver stopped, VTS disconnected, no recent Pantry packets, and recent input.

## One-time migration

- Preserve the existing scheduled task's source IPv4 and exported task XML in the user's retired app data before changing the task.
- A dedicated migration step, run with the required elevation, stops and unregisters only `VTube Input Relay`; it does not touch `vts_input_relay.exe` files, firewall rules, VTube Studio, OBS, or Pantry.
- The source address is saved to the current user's app config. The app must stop with a clear error if the task is missing, its action is unexpected, or no valid source address can be read. It must not guess an address or launch a competing relay.
- The SYSTEM token remains in ProgramData for rollback. The per-user relay will obtain its own VTS authorization token in the interactive session.
- Migration has a paired restore script using the saved task XML and source record. The Canada one-click installer can invoke migration through a separate UAC prompt; neither build nor this implementation runs it on a PC.

## Connection reliability findings and scope

- Pantry's sender is UDP and receives no acknowledgement from Canada. Its `Sending` state only proves the local UDP send call succeeded, not that Canada received the packet.
- The relay filters packets by the exact configured Pantry source IP. If Pantry's address changes, packets are rejected until configuration is updated.
- The relay retries VTube Studio websocket/authentication failures every three seconds, but a local UDP bind or other unrecoverable relay error exits the process. App supervision will recover from process exit, but does not fix wrong IPs, VTS API authorization, or missing firewall access.
- No connection protocol, firewall rule, OBS setting, or VTS setting changes are included in this work.

## Acceptance

- Opening the Canada app starts one per-user relay child using the saved source and per-user token/status paths.
- Tray Exit cancels restart timers, signals child shutdown through stdin EOF, waits for exit, then exits Electron.
- Unexpected relay termination is retried with backoff and reflected in the tracking status.
- Missing/malformed migration data fails closed with an actionable message.
- Migration can restore the prior task from its preserved XML. No migration or deployment is performed during this implementation.

## Operational diagnostics

When a streamer reports repeated reconnect attempts, collect the exact Tracking message from both PCs, Pantry destination IP and packet count, the relay `source`, `vts_connected`, `packets_received`, and `last_packet_unix_ms` values twice five seconds apart, and both PCs' current LAN addresses. This separates stale IP/configuration, receiver/VTS startup, and local sender status without conflating Stream Deck pairing with tracking.
