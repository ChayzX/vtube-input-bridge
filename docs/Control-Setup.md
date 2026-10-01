# VTube Control preview setup and rollback

This is a separate optional companion. It does not replace VTube Input Bridge, change UDP 5055, modify tracking tasks, or read tracking authentication tokens. The preview was built locally; it has not been installed or tested on Pantry/Canada.

## Install later, during an offline test window

On the gaming PC, `Install-VTubeControl-GamingPC.cmd` (made by `scripts/New-ControlInstaller.ps1`) performs steps 1 and 2 with the default options and also opens the Stream Deck plugin installer and the companion. Continue from step 4.

1. Verify the ZIP checksum and extract the package for the appropriate PC. Keep the existing tracking app running.
2. In PowerShell, run `./Install-Control.ps1`. It installs into `%LOCALAPPDATA%\VTubeControl\versions\0.2.0-preview.1`, creates Desktop and Start menu **VTube Control** shortcuts, and records backups. It does not launch the app, enable startup, or add a firewall rule by default.
3. Optional flags: `-EnableStartup` adds a separate per-user Run entry; `-EnableFirewall -PeerAddress <other-PC-IP>` creates a uniquely named private-network inbound TCP 5056 rule. The firewall option requires elevated PowerShell under the same Windows account that will run the companion. Pantry peer: `10.0.0.119`; Canada peer: `10.0.0.112`. Confirm current IPs first.
4. Open **VTube Control** on each PC. Confirm its role and its own IP. Save while controls are disabled. Export that PC’s pairing file, securely transfer it, and import it on the other PC. Pairing files contain a connection credential: delete transfer copies afterward. A replacement identity requires pairing again.
5. On Canada enable OBS, Spotify and VTube Studio features as needed. Configure the OBS loopback WebSocket URL/password in this app. If OBS WebSocket is not enabled, record its previous configuration before enabling it manually. Do not expose OBS WebSocket to the LAN for this setup. Spotify must be running in the same signed-in user session. VTube Studio may ask to approve the separate **VTube Control** plugin when the first hotkey discovery request is made.
6. Enable controls on both companions and save. Existing tracking is unaffected. Test **List OBS scenes**, **List VTS hotkeys**, and **Pause Spotify** from Pantry with the target **Other PC**. A timeout may mean the action already happened: check the app before pressing again.

## Stream Deck on Pantry

Requires Stream Deck 7.1+ with its bundled Node 24 runtime. Install `com.chayzx.vtubecontrol.streamDeckPlugin` manually in Stream Deck. Existing buttons/profiles are untouched. Add **VTube Control → Bridge command** buttons:

- Other PC + OBS scene: fetch scenes, choose a scene name.
- Other PC + Spotify: play, pause, next or previous. Spotify-specific Windows media sessions are used; unsupported actions fail visibly.
- Other PC + VTube Studio hotkey: fetch hotkeys, choose the ID of a saved Item Scene or other desired hotkey.
- Other PC + Reactives show/hide: controls Canada’s received overlay.
- This PC + Reactives start/stop: controls Pantry’s renderer.

Button feedback reports disconnected/error/uncertain states. One press produces one command; no automatic retries or replays after reconnect. Connection polling is separate from tracking. Do not configure stream start/stop, power operations or arbitrary shell commands: these are outside this preview.

## Reactive avatars inside Canada VTube Studio

This route is experimental. Fugi’s public embed code requests local Discord connectivity, so rendering belongs on Pantry where the voice call runs. Actual Fugi/Discord permissions and speaking behavior still require a physical Windows test.

1. Use Fugi on Pantry to configure avatars and copy its **group browser-source** URL. The companion supports the verified `/group` and `/individual/<Discord-ID>` embed routes only. Account/login/settings pages are rejected. New custom/basic source formats need an explicit future compatibility update.
2. Enable experimental rendering on Pantry, paste the source URL, and save. The separate login window is never relayed; the renderer uses a separate browser session. The embed must obtain any required local Discord authorization. If authorization cannot complete, stop and investigate rather than bypassing browser security.
3. Start the renderer explicitly. The companion relays a maximum 1024×512 PNG image at up to 10 fps. Frames use authenticated, certificate-pinned LAN transport. Browser camera/microphone permissions stay disabled; the trusted Fugi embed may request loopback-network access to Discord. Discord RPC endpoints are not forwarded over the LAN.
4. On Canada copy the **Canada Web Item URL** from Canada’s companion. Manually load it as a VTube Studio Web Item, enable transparency, position it, and save an Item Scene/hotkey. The VTS API cannot automatically create arbitrary Web Items.
5. Verify at least two people speaking separately, silence, join/leave, changing calls, renderer stop/restart and LAN disconnect. The overlay clears after two seconds without frames. Renderer liveness is checked before upload; this does not establish that Fugi’s upstream Discord speaking state is fresh. Never call the integration verified based solely on the “sending images” status.

Closing the app window keeps it in the tray. **Exit VTube Control** stops this companion only. Saving settings stops the experimental renderer; restart it explicitly. Rendering does not auto-start after Windows logon.

## Fast disable and full rollback

Fast disable: choose **Disable controls** or **Exit VTube Control** from its tray. Mouse/keyboard tracking continues independently. Remove only the new bridge-command buttons/plugin if desired.

Full rollback:

1. Exit **VTube Control** from its tray on the PC being rolled back. Leave OBS, VTube Studio, VConnect and VTube Input Bridge running.
2. Run `./Rollback-Control.ps1 -Record '<path printed by installer>\rollback.json'`. Use an elevated shell if the installer added a firewall rule.
3. It restores backed-up shortcuts, optional startup value and companion settings; removes only its version directory and uniquely named firewall rule. Older versions and tracking are retained. Use `-KeepSettings` if you intentionally want to preserve the companion’s current configuration.
4. In Stream Deck remove the new plugin manually. Back up a Stream Deck profile before editing it if you need to restore button assignments exactly.
5. Remove the new reactive Web Item/Item Scene manually, or restore the saved VTS item configuration. Any manual OBS/VTS configuration is outside the installer: record it beforehand and reverse those exact changes. No automation changes those applications’ settings.

Rollback validates its version, settings, shortcut and backup paths, recognizes already restored shortcuts, and can resume after interruption. Installers refuse to replace a running companion and record partial installs for rollback. Rollback refuses to overwrite shortcuts/startup entries that were edited afterward. Restore the intended original files from the printed backup location if that guard fires. Per-user browser cookies may remain after rollback; they are inert without the companion and can be removed separately if desired.
