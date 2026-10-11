# VTube Input Bridge setup and rollback

VTube Input Bridge includes the tracking app and runs the Streaming PC's relay itself. The app runs in the signed-in user's session. Closing its window keeps it in the tray; choosing **Exit VTube Input Bridge** from the tray stops the relay and the app. It keeps using UDP 5055 and does not change OBS or VTube Studio settings. The installer adds firewall rules so the two PCs can reach each other (below); nothing else changes firewall rules.

In this guide the **Gaming PC** is the PC you play on, with the Stream Deck and Discord. The **Streaming PC** is the PC that runs VTube Studio and usually OBS.

## Installing

There is one installer for both PCs: `Install-VTubeInputBridge.cmd` (made by `scripts/New-ControlInstaller.ps1`). Double-click it as the signed-in user, on each PC, while you are not streaming.

- **Which PC is this?** The installer asks once, with two buttons: **Gaming PC** (plays the game, has the Stream Deck) or **Streaming PC** (runs OBS and VTube Studio). It does not ask when it already knows: on a PC that has the app it uses the saved role, and a PC with the old `VTube Input Relay` task is the Streaming PC.
- **Streaming PC, first time from the old setup:** Windows asks once for administrator approval. The installer saves the old relay task and its Gaming PC address, then stops and removes only that task. If the app is running, the installer closes it for this step and opens it again afterwards. If it fails, the reason is shown and the old task is left as it was. A brand-new Streaming PC needs nothing extra: tracking starts once the PCs are paired.
- **Gaming PC:** the installer hands the Stream Deck plugin to Stream Deck, which asks you to confirm.
- **Firewall (both PCs):** the first time, Windows asks for approval to add inbound rules: **VTube Input Bridge (PC link)** (TCP 5056), **VTube Input Bridge (pairing)** (TCP and UDP 5059) and, on the Streaming PC, **VTube Input Bridge (tracking)** (UDP 5055). They allow these ports only on private networks and only from your local network, so they keep working when the other PC's address changes or the app is updated. Older VTube Control rules are replaced. Later installs ask again only if the rules are missing or changed. If you say no, the PCs cannot reach each other: run the installer again and accept the prompt. The network must be set to Private in Windows.
- The installer and the app themselves run without administrator rights. On the Streaming PC, VTube Studio may ask once to allow **Game Input Relay**.

When it finishes, a dialog reports the result. On success, clicking **OK** opens the app and the installer window closes. On failure the window stays open with the details; take a screenshot, then close it with its X button.

For scripted installs: `VTC_ROLE=pantry` (Gaming PC) or `VTC_ROLE=canada` (Streaming PC) skips the question; `VTC_QUIET=1` shows no dialogs at all (the role must then come from `VTC_ROLE` or an existing install). Exit codes: 0 installed, 1 failed, 2 cancelled, 3 the PC could not be identified.

If a Streaming PC update stopped halfway (the old task is gone but the app says the relay setup is incomplete, or the restore tool set up the Gaming PC sender on it), run `scripts/Fix-StreamPC.cmd` there as the signed-in user, with the newest installer in Downloads or on the Desktop. It recreates `relay-config.json` from the migration record and runs that installer as the Streaming PC.

## Updating

Run the newest `Install-VTubeInputBridge.cmd` the same way; it keeps the PC's role, settings and pairing.

The app's own updater runs the same file with `VTC_UPDATE=1`. That mode never shows a dialog or a Windows prompt: it reads the role from `%APPDATA%\VTubeControl\role.txt`, waits up to 20 seconds for the app to close (then closes it), installs, writes the outcome to `%LOCALAPPDATA%\VTubeControl\last-update.json` (`version`, `ok`, `message`, `at`) and starts the app again in the tray. Because it cannot ask for approval, two things still need a double-click of the installer: the one-time Streaming PC relay migration, and firewall rules that are missing (for example because the prompt was declined at install). The app shows the message when that is needed. A newer Stream Deck plugin is also left for you to install when you are not streaming.

### Installing by hand

1. Extract the package ZIP. Exit the running VTube Input Bridge from its tray first.
2. In PowerShell, run `./Install-Control.ps1 -Role pantry` (Gaming PC) or `-Role canada` (Streaming PC). It installs into `%LOCALAPPDATA%\VTubeControl\versions\<version>`, creates Desktop and Start menu **VTube Input Bridge** shortcuts, saves the role, installs the uninstaller and records backups. It does not launch the app, enable startup, or add firewall rules by default.
3. Optional flags: `-EnableStartup` adds a per-user Run entry; `-EnableFirewall` adds the firewall rules above (needs an elevated PowerShell under the same Windows account that will run the app).
4. On the Streaming PC, run `Migrate-StreamPCRelay.ps1` as administrator once before opening the new app. It reads only the Gaming PC's address from the old task and keeps the task XML (and any earlier relay-config.json) under `%LOCALAPPDATA%\VTubeControl\retired`. If the task is already gone, use the existing `%APPDATA%\VTubeControl\relay-config.json`; do not guess an address.

## Uninstalling

Open **Settings > Apps > Installed apps**, find **VTube Input Bridge** and choose **Uninstall** (or double-click `%LOCALAPPDATA%\VTubeControl\Uninstall-VTubeInputBridge.cmd`).

- It asks once: **Also delete settings and pairing?** Choose **No** (the default) to keep them for a later reinstall, **Yes** to delete them, or **Cancel** to remove nothing.
- It closes the app, then removes its shortcuts, its sign-in entry, its firewall rules (Windows asks for approval for that step only), the installed versions and, on the Gaming PC, the Stream Deck plugin (Stream Deck is closed for a moment and reopened).
- It does not touch OBS, VTube Studio or the old separate tracking app. The `retired` folder is kept. On a Streaming PC that was moved from the old relay task, the uninstaller does not bring that task back; it tells you how: run `Restore-StreamPCRelay.ps1` from `%LOCALAPPDATA%\VTubeControl\retired` in an administrator PowerShell with the `-Record` path it shows.
- For scripts: `Uninstall-VTubeInputBridge.cmd -Quiet` (or `VTC_QUIET=1`) asks nothing and keeps settings; add `-DeleteSettings` to delete them.

## First run and pairing

Open **VTube Input Bridge** on both PCs. The window opens on **Home**, which shows whether you are live-ready, a **Finish setting up** checklist that ticks itself off, and a card for tracking, the PC link and each app. The card at the bottom of the sidebar shows which PC you are on (set by the installer).

1. **Pair the PCs** (once). On one PC open **PC link** and choose **Show a pairing code**. On the other PC open **PC link**, choose **Enter a code**, type the 6-digit code and choose **Pair**. Both PCs must be on the same home network, set to Private in Windows. Three wrong codes or five minutes close the code; start again if that happens.
2. Nobody types an IP address. Each PC finds its own address, and the PCs find each other again by themselves when the router gives either one a new address. Tracking follows: the Gaming PC sends to the Streaming PC's current address once they are paired.
3. Remote controls are on from the start. Keys for apps on the same PC work before pairing; keys for the other PC work once the PCs are paired. Pause them from the tray (**Pause remote controls**, then **Resume remote controls**) or under **PC link**.
4. If the PCs cannot see each other (some mesh Wi-Fi or guest networks block it), use **PC link › Pair with files instead**: export a pairing file on each PC and import it on the other, then delete the copies. A PC that was reinstalled or reset needs pairing again.
5. **Apps**: new installs start with OBS, Meld Studio, Spotify and VTube Studio turned on (and, on the Gaming PC, reactives). Settings saved by an older version keep their choices, except Meld Studio, which starts on. Turn off anything a PC does not use. Changes to text fields and switches on these pages are saved with the **Save** bar that appears at the bottom.
   - **OBS**: enter the WebSocket address and password from OBS > Tools > WebSocket Server Settings. If OBS WebSocket is not enabled, record its previous configuration before enabling it. Do not expose OBS WebSocket to the network for this setup.
   - **Meld Studio**: turn on **Settings > Advanced > Allow remote connections** in Meld. The app connects to `ws://127.0.0.1:13376` and only lists and switches scenes.
   - **Spotify** must be running in the same signed-in user session.
   - **VTube Studio**: the first request (for example **Test** on the VTube Studio card, or opening a VTube Studio hotkey key's settings in Stream Deck) makes VTube Studio ask to allow the **VTube Input Bridge** plugin. Click **Allow** in VTube Studio within 90 seconds, then try again. After updating from a version before 1.0 it asks once more, because the plugin was renamed. If VTube Studio is not running, the request says so instead of asking.
6. Use **Test** on each card on **Home**, or the buttons under **Stream Deck > Try a command**, to check each app. A timeout may mean the action already happened: check the app before trying again.

## Stream Deck

The Stream Deck sits on the Gaming PC. It needs Stream Deck 7.1 or newer with its bundled Node 24 runtime. On the Gaming PC the installer hands `com.chayzx.vtubecontrol.streamDeckPlugin` to Stream Deck; existing buttons and profiles are untouched. The actions are in the **VTube Input Bridge** category, one per job: **OBS scene**, **Meld Studio scene**, **VTube Studio hotkey**, **Spotify**, **Show/hide reactives** and **Reactive renderer**. Keys made with the old **Bridge command** action keep working (it is now **Advanced command**).

- Choose the PC. For OBS and Meld Studio scenes and VTube Studio hotkeys, the list fills itself when you open the key's settings; choose **Refresh** after opening the app.
- Spotify: play, pause, next or previous. Spotify's Windows media session is used; unsupported actions fail visibly.
- VTube Studio hotkey: choose a saved Item Scene or other hotkey; the key is titled with the hotkey's name.
- Reactives show/hide control the overlay on the Streaming PC. Reactives start/stop control the renderer on the Gaming PC. The PC is set automatically for these.

Keys show the result for a moment, then their title returns. A failed press says why on the key (**Not paired**, **Paused**, **Busy**, **Timed out**, **App off**, **Failed**) and the full reason appears in the key's settings under **Last press**. One press sends one command; nothing is retried or replayed after a reconnect. Do not configure stream start/stop, power operations or arbitrary shell commands: these are not supported.

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
3. Address changes are handled by themselves once the PCs are paired; **Logs** shows "The other PC's address changed" when it happens. If the PCs are not paired, pair them. The firewall rules allow the whole local network, so they need no change; if they are missing (the Windows prompt was declined), run the installer again. Do not create broader firewall rules to make the warning go away.
4. Update both PCs to the same version (**Advanced › Updates › Update both PCs** does this). An older Streaming PC relay does not send acknowledgements, so the Gaming PC keeps showing **Waiting for the Streaming PC** even when tracking works.
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

To pause quickly, choose **Pause remote controls** from the tray. It also takes the reactive overlay off stream on the Streaming PC (the Web Item goes blank) until you choose **Resume remote controls** in the tray or turn them on under **PC link**. Tracking keeps running; **Exit VTube Input Bridge** stops tracking too.

Full rollback:

1. Exit **VTube Input Bridge** from its tray on the PC being rolled back; this also stops its tracking. Leave OBS and VTube Studio running.
2. On the Streaming PC, restore the old relay task from an elevated PowerShell: `./Restore-StreamPCRelay.ps1 -Record '<path printed by the migration>'`. The app must be exited first. This registers and starts the exact task XML saved during migration.
3. Run `./Rollback-Control.ps1 -Record '<path printed by installer>\rollback.json'`. Use an elevated shell if the record names a firewall rule (installs before 1.0).
4. It restores backed-up shortcuts, the optional startup entry and the app's settings, and removes only its version folder (and, for installs before 1.0, its own firewall rule). Older versions and tracking files are kept. Use `-KeepSettings` to keep the app's current settings.
5. In Stream Deck, remove the plugin by hand. Back up a Stream Deck profile before editing it if you need to restore key assignments exactly.
6. Remove the reactive Web Item or Item Scene by hand, or restore the saved VTube Studio item configuration. Any manual OBS or VTube Studio changes are outside the installer: note them beforehand and reverse those exact changes.

Rollback checks its version, settings, shortcut and backup paths, recognizes shortcuts that are already restored, and can resume after an interruption. Installers refuse to replace a running app and record partial installs for rollback. Rollback refuses to overwrite shortcuts or startup entries that were edited afterwards; restore the intended files from the printed backup location if that guard fires. Browser cookies from Fugi may remain after rollback; they do nothing without the app and can be removed separately.

## Notifications

With the window closed, the tray icon shows a notification when tracking stops for 15 seconds after it had been working, when the other PC stops answering for 30 seconds, when it is back, when an update is ready, and after an update. Turn them off under **Advanced › Notifications**.
