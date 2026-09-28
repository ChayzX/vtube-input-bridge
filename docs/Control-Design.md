# Stream Deck and reactive avatars: design scope

Date: 2026-09-28. Status: locally implemented as an optional preview; no changes to Canada or Pantry. Native integration remains unverified.

## Intended outcome

The Stream Deck attached to Pantry controls OBS scenes and Spotify on Canada. Pantry runs Discord and joins the voice call. Other Discord participants’ Fugi reactive PNG avatars appear inside Canada’s VTube Studio. Both bridge applications keep their tray behavior and show connection status. The existing keyboard/mouse bridge remains usable while controls reconnect or fail.

The existing private repository is https://github.com/ChayzX/vtube-input-bridge. Its current UDP 5055 channel sends input state; it has no Stream Deck command channel.

## Recommended approach and alternatives

1. **Recommended: a Stream Deck plugin plus a companion control agent.** Each button selects its target PC, action and relevant scene or preset. This supports OBS, media controls and VTube Studio through one configuration and status flow. It adds a plugin and a reliable command connection.
2. **Existing plugins with direct remote app connections.** Evaluate this for OBS first. It may reduce custom work for scene switching, but Spotify and reactive controls still need their own integration and status handling.
3. **Remote keyboard shortcuts.** Simple initially, but focus and hotkey conflicts make these less dependable. Use supported app APIs for the proposed build.

## Components

- **Pantry Stream Deck plugin:** configurable actions, scene/preset dropdowns and button feedback for success, failure and disconnected state. Use the supported Elgato SDK after checking the installed Stream Deck version.
- **Control companion on each participating PC:** runs in the signed-in user’s session with the tray app. Canada needs this for user media sessions; the existing background tracking receiver is not the right process for Spotify controls.
- **Separate authenticated LAN command connection:** carries commands and responses, while UDP continues carrying tracking. Use encrypted transport with a paired peer identity and a firewall rule restricted to the other PC. Keep local app adapters on loopback.
- **OBS adapter on Canada:** connect to OBS WebSocket; fetch scenes, select a scene and report the current scene. Missing scenes and disconnected OBS produce visible errors.
- **Spotify adapter on Canada:** target Spotify’s Windows media session for play, pause, next and previous. Check supported operations and return an error when Spotify is unavailable. Do not fall back to controlling a different media app. Playlist selection, device transfer and cloud account controls are a separate extension.
- **VTube Studio adapter on Canada:** discover and trigger configured hotkeys for saved reactive Item Scenes. Use a separate API connection and token from tracking, so control requests cannot stall tracking updates.

## Command behavior

Use named supported actions rather than arbitrary remote scripts. Commands include a unique request ID, target, arguments and expiry. Respond with a result and updated state where available. Bound queues and remember recently completed IDs to suppress duplicates within the running session.

Prefer explicit actions such as “select scene” and “pause” over toggles. Never automatically replay next-track or toggle commands after a timeout or restart: the first attempt may already have happened. Report an uncertain result and refresh state. Reconnect with bounded backoff; service failures remain isolated.

## Fugi inside VTube Studio

VTube Studio Web Items support transparent webpages and saved Item Scenes. The proposed first route is Fugi’s group browser URL loaded as a Web Item, positioned beside the model and saved as an Item Scene. Buttons can load/unload the configured preset.

**Feasibility remains unverified:** Pantry is confirmed as the Discord voice-call host. Verify whether the Fugi source displayed on Canada receives speaking updates while the account is in a call on Pantry. Compare the same source on Pantry as a baseline, checking two participants speaking and going silent independently. The public Fugi page requires login and does not establish a supported cross-PC API. Do not assume a browser URL alone bridges voice state.

If that test fails, investigate a supported cross-PC integration or a separate visual relay rendered on Pantry and displayed through a Canada Web Item. For a visual relay, Pantry hosts the Fugi browser rendering, and Canada opens a local bridge webpage that displays the transported output. The transport and browser renderer are not selected yet: transparency, rendering cost, login compatibility, latency and recovery must be demonstrated before choosing that fallback. Do not expose Discord’s local RPC endpoint or account credentials across the LAN. An OBS-only overlay does not satisfy the requested placement inside VTube Studio.

Initial Web Item setup is manual: VTube Studio’s API cannot directly create arbitrary Web Items. Save the URL, dimensions and placement in an Item Scene, then configure its hotkey. Fugi login and browser URLs remain local and are excluded from Git and logs.

## Build sequence after design review

1. **Inventory and feasibility:** check Stream Deck/OBS/VTS versions and Fugi cross-PC behavior with Discord on Pantry in an agreed offline testing window. No production changes during planning. Resolve the reactive route before committing to its implementation.
2. **Control transport:** build pairing, command schema, acknowledgements, expiry, duplicate handling and fake adapters locally. Test disconnects and uncertain outcomes.
3. **OBS controls:** implement discovery, scene selection and state feedback; test against a disposable OBS instance.
4. **Spotify controls:** implement the interactive Windows media adapter; verify it selects Spotify when other media apps are present.
5. **Stream Deck plugin:** add target/action configuration and live feedback. Start with scene selection and basic Spotify controls.
6. **Reactives:** implement the route demonstrated by the feasibility test, with saved VTS presets and visible connection errors. Verify multiple participants speaking, silence, call changes and recovery.
7. **Packaging:** produce separate Pantry/Canada packages, the plugin installer, shortcuts, configuration migration and rollback instructions in the existing repository. Installation happens later in an agreed offline window.

## Acceptance checks

- A Pantry button changes the intended Canada OBS scene and shows the actual resulting scene.
- Media buttons operate Canada’s Spotify and never another app.
- Canada’s VTube Studio shows other participants’ correct idle/speaking PNG states with transparency.
- Disconnects produce clear status, expired commands are discarded, and reconnects do not repeat track skips or toggles.
- Keyboard/mouse tracking continues while OBS, media or reactive controls fail or reconnect.
- Native Windows tests and a physical two-PC test pass before calling the build verified. Local simulation alone is insufficient.

## Remaining technical decision

The confirmed host split is Pantry for Stream Deck and Discord, Canada for OBS, Spotify and VTube Studio. The remaining decision is whether Fugi works directly in Canada's Web Item or needs a supported relay from Pantry. No further user requirement is needed to describe the initial scope. Individual OBS scene names and button assignments can be selected during configuration rather than hardcoded.

## Primary references

- [Elgato Stream Deck SDK](https://github.com/elgatosf/streamdeck)
- [OBS WebSocket](https://github.com/obsproject/obs-websocket)
- [Windows media session controls](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager)
- [VTube Studio Web Items](https://github.com/DenchiSoft/VTubeStudio/wiki/Web-Items)
- [Fugi Reactive Images](https://reactive.fugi.tech/)

## Implementation selection

The selected companion is a separate Electron tray application plus a supported Elgato SDK plugin and a self-contained Windows media helper. Commands use reliable authenticated HTTPS with exact certificate pinning. Tracking sources/installers remain unchanged. Fugi public embed HTML/code confirms group/individual routes and local Discord connectivity; the experimental fallback renders on Pantry and serves transparent PNG output through a Canada loopback Web Item. Actual Discord speaking-state behavior remains an installation-time verification gate.
