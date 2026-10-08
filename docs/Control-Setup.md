# VTube Control preview setup and rollback

VTube Input Bridge 0.3.0-preview.2 includes the tracking app and owns the Stream PC relay process. The app runs in the signed-in user's session. Closing its window hides it in the tray; choosing **Exit VTube Input Bridge** stops the relay and app. It keeps using UDP 5055 and does not change OBS, VTube Studio settings, or firewall rules.

## Install later, during an offline test window

`Install-VTubeInputBridge-GamingPC.cmd` and `Install-VTubeInputBridge-StreamPC.cmd` (made by `scripts/New-ControlInstaller.ps1`) install the app for the signed-in user and start it. On Canada, the one-click installer asks for a one-time UAC approval to save the old task and source address, then stop and remove only the old `VTube Input Relay` scheduled task. The installer itself and app remain non-elevated. The app uses a new per-user VTS token, so VTube Studio may ask for approval again. The old ProgramData executable and token are retained for rollback. Do not run `Install-StreamPC.ps1` again.

When the one-click installer finishes, it reports the result in a dialog. On success, clicking **OK** opens the app and the installer window closes by itself; no key press is needed. On failure the installer window stays open with the details; take a screenshot, then close it with its X button. Before this fix ([#6](https://github.com/ChayzX/vtube-input-bridge/issues/6)) the window ended with "Press any key to continue", which ignored key presses once the newly opened app, the firewall prompt or Stream Deck had keyboard focus. If you see that with an older installer, the install has already finished: close the window with X. For scripted installs, set `VTC_QUIET=1` to skip the dialog.

1. Verify the ZIP checksum and extract the package for the appropriate PC. Exit the current VTube Input Bridge app from its tray before installing the update.
2. In PowerShell, run `./Install-Control.ps1`. It installs into `%LOCALAPPDATA%\VTubeControl\versions\<version>`, creates Desktop and Start menu **VTube Input Bridge** shortcuts, and records backups. It does not launch the app, enable startup, or add a firewall rule by default.
3. Optional flags: `-EnableStartup` adds a separate per-user Run entry; `-EnableFirewall -PeerAddress <other-PC-IP>` creates a uniquely named private-network inbound TCP 5056 rule. The firewall option requires elevated PowerShell under the same Windows account that will run the companion. Pantry peer: `10.0.0.119`; Canada peer: `10.0.0.112`. Confirm current IPs first.
4. On Canada, if doing a manual install, run `Migrate-StreamPCRelay.ps1` as administrator once before opening the new app. It preserves the task XML and Pantry source under `%LOCALAPPDATA%\VTubeControl\retired`. If the task is already gone, use the existing `%APPDATA%\VTubeControl\relay-config.json`; do not guess an address. Open **VTube Input Bridge** on both PCs. Tracking appears at the top and works without pairing. Confirm its role and its own IP. Save while controls are disabled. Export that PC’s pairing file, securely transfer it, and import it on the other PC. Pairing files contain a connection credential: delete transfer copies afterward. A replacement identity requires pairing again.
5. New installs start with OBS, Meld Studio, Spotify and VTube Studio controls (and, on Pantry, Fugi rendering) turned on; Stream Deck controls switch on by themselves the first time a pairing file is imported. Settings saved by an older version keep their choices. Turn off anything a PC does not use. For Meld Studio, turn on **Settings > Advanced > Allow remote connections** in Meld; the app connects to `ws://127.0.0.1:13376` and only lists and switches scenes. Stream Deck buttons use the **Meld Studio — change scene** action with the scene name. Configure the OBS loopback WebSocket URL/password in this app. If OBS WebSocket is not enabled, record its previous configuration before enabling it manually. Do not expose OBS WebSocket to the LAN for this setup. Spotify must be running in the same signed-in user session. VTube Studio may ask to approve the separate **VTube Control** plugin when the first hotkey discovery request is made.
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

Closing the app window keeps it in the tray. **Exit VTube Input Bridge** stops the whole app and its managed relay child. Unexpected relay exits are restarted with backoff. Pantry shows **Connected** only after Canada acknowledges a packet that VTube Studio applied; **Waiting for Stream PC** means there has been no recent acknowledgement. On the gaming PC the experimental renderer starts by itself when the app launches (including at Windows sign-in) once the PCs are paired and a Fugi URL is saved, and restarts after settings are saved. **Stop renderer** stops it until the next launch or save.

## If tracking does not connect

1. Read Tracking on Canada first. **Waiting for VTube Studio** means open VTube Studio, enable its API, and approve **Game Input Relay** if it asks. **Waiting for gaming PC** means Canada is connected to VTube Studio but has not received recent input. **Receiver stopped** or **Restarting receiver** means the app is starting/recovering its relay.
2. On Pantry, **Waiting for Stream PC** means the sender is running but has not received a recent acknowledgement. Check that Pantry is sending to Canada's current LAN address and that Canada's displayed Pantry source matches Pantry's current LAN address.
3. If the PCs' addresses changed, restore their expected LAN addresses or update the saved receiver source and the existing restricted firewall rule through the normal setup process. Do not create broader firewall rules to make the warning disappear.
4. Update both PCs to preview.2. An older Canada relay does not send acknowledgements, so Pantry will keep showing **Waiting for Stream PC** even if the older setup is otherwise working.
5. If both PCs are on preview.2, both addresses match, and Canada says it is receiving input while Pantry remains waiting, the reply path is blocked. Record the exact messages on both PCs and stop there; the app does not change firewall rules automatically.

## Getting the separate tracking app back

`scripts/Restore-SeparateTracking.cmd` restores the separate VTube Input Bridge window after a failed or unwanted update. Double-click it as the signed-in user; it needs no administrator rights.
- It detects the PC: the stream PC is the one with the VTube Input Relay service.
- It stops the new app and removes it from sign-in, setting the old entry aside in `%LOCALAPPDATA%\VTubeControl\retired`.
- It finds the old app. It checks where the saved sign-in entry pointed, then the install folders, Downloads, Desktop and Documents, then the new install's own copy. As a last resort it uses a released copy embedded in the restore file and checked by SHA256.
- It copies the app to `%LOCALAPPDATA%\Programs\VTubeInputBridge`, restores its sign-in entry (and its shortcuts on the gaming PC), and starts it.

It deletes no program files and never changes `vts_input_relay`. Rebuild the file with `scripts/New-RestoreTool.ps1 -ExePath <VTubeInputBridge.exe> -Version <tag>`.

Since this fix, the one-click installer installs the new app before retiring the old one. If the install fails, the old app keeps running.

## Fast disable and full rollback

Fast disable: choose **Disable Stream Deck controls and reactives** from the tray. It also takes the reactive overlay off stream on Canada (the Web Item goes blank) until controls are enabled again. Mouse/keyboard tracking keeps running; **Exit VTube Input Bridge** stops tracking too. Remove only the new bridge-command buttons/plugin if desired.

Full rollback:

1. Exit **VTube Input Bridge** from its tray on the PC being rolled back; this also stops its tracking. Leave OBS and VTube Studio running.
2. On Canada, restore the old relay task with an elevated PowerShell: `./Restore-StreamPCRelay.ps1 -Record '<path printed by the migration>'`. The app must be exited first. This registers and starts the exact task XML saved during migration.
3. Run `./Rollback-Control.ps1 -Record '<path printed by installer>\rollback.json'`. Use an elevated shell if the installer added a firewall rule.
4. It restores backed-up shortcuts, optional startup value and companion settings; removes only its version directory and uniquely named firewall rule. Older versions and tracking files are retained. Use `-KeepSettings` if you intentionally want to preserve the companion’s current configuration.
5. In Stream Deck remove the new plugin manually. Back up a Stream Deck profile before editing it if you need to restore button assignments exactly.
6. Remove the new reactive Web Item/Item Scene manually, or restore the saved VTS item configuration. Any manual OBS/VTS configuration is outside the installer: record it beforehand and reverse those exact changes. No automation changes those applications’ settings.

Rollback validates its version, settings, shortcut and backup paths, recognizes already restored shortcuts, and can resume after interruption. Installers refuse to replace a running companion and record partial installs for rollback. Rollback refuses to overwrite shortcuts/startup entries that were edited afterward. Restore the intended original files from the printed backup location if that guard fires. Per-user browser cookies may remain after rollback; they are inert without the companion and can be removed separately if desired.
