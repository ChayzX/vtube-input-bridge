# Input delivery acknowledgement design

Date: 2026-10-07
Status: approved by user for local implementation; no PC deployment or firewall changes.

## Goal

Show whether Pantry's input packets are actually reaching Canada and being applied by VTube Studio. Keep the current UDP input transport and use the same sender socket for its response, so the app adds no listener port or firewall rule.

## Protocol

- Pantry continues sending version 1 input packets to Canada UDP 5055.
- After Canada validates a packet from the configured Pantry source IP, applies it through the authenticated VTube Studio API, and updates relay status, Canada replies to that datagram's source endpoint with a small JSON acknowledgement: `{type:"ack", version:1, sequence:<input sequence>}`.
- Pantry accepts an acknowledgement only from its configured Canada IPv4 address, source UDP port 5055, and for a sequence number it has sent. The existing UDP socket listens for replies on the ephemeral port used to send input.
- The sender is **Connected** only while acknowledgements are recent (2.5 seconds). It remains **Waiting for Stream PC** while local sends continue without a recent acknowledgement. Existing packet counts remain local-send counts; status adds acknowledgement state and last acknowledged sequence.
- If no acknowledgement arrives, show a concise prompt to check Canada Tracking status, Pantry/Canada addresses, and whether the updated relay is installed. Do not alter firewall rules automatically.
- Automatic sender start retries use bounded backoff after a local start/send error while start-on-launch remains enabled. An explicit Stop cancels retries.

## Packaging and deployment boundary

- Build the Rust relay for Windows x64 from the Linux CI build using the GNU Windows target and MinGW linker. Include it inside the immutable versioned app package and start that versioned copy after the existing one-time task migration.
- The legacy ProgramData executable/task remain available for the saved migration rollback. Normal app installation remains per-user; no app-level elevation is added.
- This code change does not run the build, tests, migration, or installer and does not change either PC.

## Failure interpretation

- No acknowledgement can mean the destination is wrong, the relay is stopped, Pantry's actual source IP differs from the saved filter, the receiver cannot authenticate/connect to VTube Studio, the packet was rejected, or a network policy blocked the reply. Canada Tracking status separates its VTS state and configured source; Pantry status establishes whether an acknowledgement returned.
- An acknowledgement proves a packet was accepted and its VTube Studio injection request completed. It does not prove the model has matching parameters or that the visible avatar reacts.

## Affected surfaces

- Rust relay: acknowledge accepted and applied input packets without exiting if a reply send fails.
- C# sender: receive/validate replies on its existing UDP socket and expose fresh acknowledgement status.
- Electron tracking plugin/UI: report Connected vs Waiting for Stream PC and retry a stopped sender while the user still wants sending enabled.
- CI/package scripts: cross-build and include the Windows relay binary for Canada.

## Review limitation

No matching PC status capture or packet trace was supplied, so this corrects the verified status blind spot and recovers transient sender stops; it cannot identify which of the listed causes occurred during any specific streamer session. A two-PC Windows run is still needed to verify the reply path under the installed firewall policy.
