# VTube Input Bridge setup and rollback

VTube Input Bridge 0.3.0-preview.3 includes the tracking app and runs the Streaming PC's relay itself. The app runs in the signed-in user's session. Closing its window keeps it in the tray; choosing **Exit VTube Input Bridge** from the tray stops the relay and the app. It keeps using UDP 5055 and does not change OBS or VTube Studio settings. The one-click installer adds one firewall rule for the link between the PCs (below); nothing else changes firewall rules.

In this guide the **Gaming PC** is the PC you play on, with the Stream Deck and Discord. The **Streaming PC** is the PC that runs VTube Studio and usually OBS.

## Installing

`Install-VTubeInputBridge-GamingPC.cmd` and `Install-VTubeInputBridge-StreamPC.cmd` (made by `scripts/New-ControlInstaller.ps1`) install the app for the signed-in user and start it. Install them while you are not streaming.

- On the Streaming PC, the installer asks once for Windows administrator approval. It saves the old relay task and its source address, then stops and removes only the old `VTube Input Relay` scheduled task.
- On both PCs it also asks for approval to add an inbound rule for this version of the app on TCP 5056 (private networks, local subnet, group **VTube Input Bridge**), replacing the previous version's rule. If you decline, Windows asks when the app first listens: allow VTube Input Bridge on private networks, or the other PC cannot connect.
- The installer and the app themselves run without administrator rights. The app uses a new per-user VTube Studio token, so VTube Studio may ask for approval again. The old ProgramData executable and token are kept for rollback. Do not run `Install-StreamPC.ps1` again.

When the installer finishes, it reports the result in a dialog. On success, clicking **OK** opens the app and the installer window closes by itself. On failure the installer window stays open with the details; take a screenshot, then close it with its X button. For scripted installs, set `VTC_QUIET=1` to skip the dialog.

If a Streaming PC update stopped halfway (the old task is gone but the app says the relay setup is incomplete, or the restore tool set up the Gaming PC sender on it), run `scripts/Fix-StreamPC.cmd` there as the signed-in user, with the newest StreamPC installer in Downloads or on the Desktop. It recreates `relay-config.json` from the migration record and runs that installer. If the old task is still present it only runs the installer, which migrates the task.

### Installing by hand

1. Verify the ZIP checksum and extract the package for the PC. Exit the running VTube Input Bridge from its tray first.
2. In PowerShell, run `./Install-Control.ps1`. It installs into `%LOCALAPPDATA%\VTubeControl\versions\<version>`, creates Desktop and Start menu **VTube Input Bridge** shortcuts, and records backups. It does not launch the app, enable startup, or add a firewall rule by default.
3. Optional flags: `-EnableStartup` adds a per-user Run entry; `-EnableFirewall -PeerAddress <other-PC-IP>` creates a private-network inbound TCP 5056 rule. The firewall option needs an elevated PowerShell under the same Windows account that will run the app. Confirm both PCs' current addresses first.
4. On the Streaming PC, run `Migrate-StreamPCRelay.ps1` as administrator once before opening the new app. It keeps the task XML and the Gaming PC's address under `%LOCALAPPDATA%\VTubeControl\retired`. If the task is already gone, use the existing `%APPDATA%\VTubeControl\relay-config.json`; do not guess an address.

## First run and pairing

Open **VTube Input Bridge** on both PCs. The window opens on **Home**, which shows whether you are live-ready and a card for tracking, the PC link and each app. The card at the bottom of the sidebar shows which PC you are on (set by the installer).

1. **Tracking** works without pairing. On the Gaming PC, enter the Streaming PC's address under **Tracking** and choose **Start sending**.
2. **PC link**: check **This PC's address** on both PCs. Choose **Export pairing file**, copy the file to the other PC and choose **Import pairing file** there. Then do the same the other way round. Pairing files contain a connection credential: delete the copies afterwards. A replacement identity needs pairing again.
3. Remote controls switch on by themselves the first time a pairing file is imported. You can pause them under **PC link** or from the tray.
4. **Apps**: new installs start with OBS, Meld Studio, Spotify and VTube Studio turned on (and, on the Gaming PC, reactives). Settings saved by an older version keep their choices, except Meld Studio, which starts on. Turn off anything a PC does not use. Changes to text fields and switches on these pages are saved with the **Save** bar that appears at the bottom.
   - **OBS**: enter the WebSocket address and password from OBS > Tools > WebSocket Server Settings. If OBS WebSocket is not enabled, record its previous configuration before enabling it. Do not expose OBS WebSocket to the network for this setup.
   - **Meld Studio**: turn on **Settings > Advanced > Allow remote connections** in Meld. The app connects to `ws://127.0.0.1:13376` and only lists and switches scenes.
   - **Spotify** must be running in the same signed-in user session.
   - **VTube Studio**: the first request (for example **Test** on the VTube Studio card, or opening a VTube Studio hotkey key's settings in Stream Deck) makes VTube Studio ask to allow the **VTube Control** plugin. Click **Allow** in VTube Studio within 90 seconds, then try again. If the plugin is later removed in VTube Studio, the next request asks again.
5. Use **Test** on each card on **Home**, or the buttons under **Stream Deck > Try a command**, to check each app. A timeout may mean the action already happened: check the app before trying again.

## Stream Deck

The Stream Deck sits on the Gaming PC. It needs Stream Deck 7.1 or newer with its bundled Node 24 runtime. The Gaming PC installer hands `com.chayzx.vtubecontrol.streamDeckPlugin` to Stream Deck; existing buttons and profiles are untouched. Add **VTube Control > Bridge command** keys:

- Choose the PC and the action. For OBS and Meld Studio scenes and VTube Studio hotkeys, the list fills itself when you open the key's settings; choose **Refresh** after opening the app.
- Spotify: play, pause, next or previous. Spotify's Windows media session is used; unsupported actions fail visibly.
- VTube Studio hotkey: choose a saved Item Scene or other hotkey; the key is titled with the hotkey's name.
- Reactives show/hide control the overlay on the Streaming PC. Reactives start/stop control the renderer on the Gaming PC. The PC is set automatically for these.

Keys show the result for a moment, then their title returns. One press sends one command; nothing is retried or replayed after a reconnect. Do not configure stream start/stop, power operations or arbitrary shell commands: these are not supported.

## Reactive avatars in VTube Studio

Fugi's embed needs the local Discord app, so reactives are rendered on the Gaming PC, where the voice call runs, and shown on the Streaming PC.

1. Use Fugi on the Gaming PC to set up avatars and copy its **group browser-source** URL. The app supports Fugi's `/group` and `/individual/<Discord-ID>` embed pages only; account, login and settings pages are rejected.
2. On the Gaming PC, under **Reactives**, turn on **Render reactives on this PC**, paste the URL and save. **Sign in to Fugi** opens a window that is never sent to the Streaming PC; it shares the renderer's browser session, so signing in there is what the renderer uses. After signing in, start the renderer again. If Discord authorization cannot complete, stop and investigate rather than bypassing browser security.
3. The renderer starts by itself when the app launches (including at Windows sign-in) once the PCs are paired and a Fugi URL is saved, and restarts after saving settings. If the Fugi page cannot load yet, it keeps retrying. **Stop renderer** stops it until the next launch or save. It sends at most a 1024×512 PNG at up to 10 frames a second over the encrypted, certificate-pinned link. Browser camera and microphone permissions stay off; Discord's local endpoints are never forwarded over the network.
4. On the Streaming PC, under **Reactives**, choose **Copy** next to the Web Item URL. Add it to VTube Studio as a Web Item, turn on transparency, position it and save an Item Scene or hotkey. VTube Studio's API cannot create Web Items automatically.
5. Before relying on it on stream, check two people speaking separately, silence, joining and leaving, changing calls, stopping and restarting the renderer, and unplugging the network. The overlay clears two seconds after frames stop.

## If tracking does not connect

1. Look at **Tracking** on the Streaming PC first. **Waiting for VTube Studio** means open VTube Studio, enable its API, and approve **Game Input Relay** if it asks. **Waiting for the Gaming PC** means VTube Studio is connected but no recent input has arrived. **Receiver stopped** or **Restarting receiver** means the app is starting or recovering its relay.
2. On the Gaming PC, **Waiting for the Streaming PC** means the sender is running but has had no recent acknowledgement. Check that it is sending to the Streaming PC's current address, and that the address the Streaming PC accepts tracking from matches the Gaming PC's current address.
3. If the PCs' addresses changed, give them back their expected addresses (a reserved address in the router helps), or update the saved receiver source and the firewall rule by reinstalling. Do not create broader firewall rules to make the warning go away.
4. Update both PCs to the same version (0.3.0-preview.3 or later). An older Streaming PC relay does not send acknowledgements, so the Gaming PC keeps showing **Waiting for the Streaming PC** even when tracking works.
5. If both PCs are on the same version, the addresses match, and the Streaming PC says it is receiving input while the Gaming PC keeps waiting, the reply path is blocked. Check that the Windows network is set to Private on both PCs, since the firewall rule only covers private networks, then note the exact messages on both PCs.

## Getting the separate tracking app back

`scripts/Restore-SeparateTracking.cmd` restores the separate VTube Input Bridge window after a failed or unwanted update. Double-click it as the signed-in user; it needs no administrator rights.
- It detects the PC: the Streaming PC is the one with the old VTube Input Relay task or, after the migration, its migration record or `relay-config.json`.
- It stops the new app and removes it from sign-in, setting the old entry aside in `%LOCALAPPDATA%\VTubeControl\retired`.
- It finds the old app. It checks where the saved sign-in entry pointed, then the install folders, Downloads, Desktop and Documents, then the new install's own copy. As a last resort it uses a released copy embedded in the restore file and checked by SHA256.
- It copies the app to `%LOCALAPPDATA%\Programs\VTubeInputBridge`, restores its sign-in entry (and its shortcuts on the Gaming PC), and starts it.

It deletes no program files and never changes `vts_input_relay`. Rebuild the file with `scripts/New-RestoreTool.ps1 -ExePath <VTubeInputBridge.exe> -Version <tag>`.

The one-click installer installs the new app before retiring the old one. If the install fails, the old app keeps running.

## Pausing and full rollback

To pause quickly, choose **Pause remote controls** from the tray. It also takes the reactive overlay off stream on the Streaming PC (the Web Item goes blank) until remote controls are turned on again under **PC link**. Tracking keeps running; **Exit VTube Input Bridge** stops tracking too.

Full rollback:

1. Exit **VTube Input Bridge** from its tray on the PC being rolled back; this also stops its tracking. Leave OBS and VTube Studio running.
2. On the Streaming PC, restore the old relay task from an elevated PowerShell: `./Restore-StreamPCRelay.ps1 -Record '<path printed by the migration>'`. The app must be exited first. This registers and starts the exact task XML saved during migration.
3. Run `./Rollback-Control.ps1 -Record '<path printed by installer>\rollback.json'`. Use an elevated shell if the installer added a firewall rule.
4. It restores backed-up shortcuts, the optional startup entry and the app's settings, and removes only its version folder and its own firewall rule. Older versions and tracking files are kept. Use `-KeepSettings` to keep the app's current settings.
5. In Stream Deck, remove the plugin by hand. Back up a Stream Deck profile before editing it if you need to restore key assignments exactly.
6. Remove the reactive Web Item or Item Scene by hand, or restore the saved VTube Studio item configuration. Any manual OBS or VTube Studio changes are outside the installer: note them beforehand and reverse those exact changes.

Rollback checks its version, settings, shortcut and backup paths, recognizes shortcuts that are already restored, and can resume after an interruption. Installers refuse to replace a running app and record partial installs for rollback. Rollback refuses to overwrite shortcuts or startup entries that were edited afterwards; restore the intended files from the printed backup location if that guard fires. Browser cookies from Fugi may remain after rollback; they do nothing without the app and can be removed separately.
