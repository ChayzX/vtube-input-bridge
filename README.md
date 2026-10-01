# Game Input Relay for VTube Studio

A Windows app and a background receiver bridge keyboard and mouse state from a gaming PC to VTube Studio on the stream PC. The gaming app transmits UDP on port 5055. The receiver creates 13 custom VTube Studio input parameters and updates them while packets arrive. The same app shows receiver status on the stream PC. Closing either app window leaves it in the system tray.

## Repository layout

- `windows_app/`: Pantry's windowed sender, raw mouse capture, tests, and the tray status UI used on both PCs.
- `vts_input_relay/`: Canada's background UDP-to-VTube-Studio receiver.
- `shared/`: version 1 packet types; `simulator/`: development packet generator.
- `gaming_input_relay/`: legacy console sender (desktop cursor capture only).
- `scripts/`: build/test scripts; `docs/`: setup and verification instructions.

## Mouse tracking during gameplay

The sender defaults to desktop cursor position. Games can hold that cursor still while reading physical mouse movement separately. Enable **Game mouse mode (for locked cursor)** in the gaming-PC app for those games. It receives background Windows Raw Input, accumulates relative movement between packets, and converts it to bounded mouse-position values. Motion returns toward center while idle; sensitivity is adjustable from 0.1 to 5. The raw movement event counter confirms that movement is arriving, even with the app in the tray. Switch the mode off when you want the model to follow a visible desktop cursor. Settings persist under `%APPDATA%\VTubeInputBridge\mouse-mode.txt`.

The packet format, receiver, and model mappings are unchanged by game mode. **Install this update on Pantry only; Canada does not need an update or restart.** The sender observes mouse input without moving the cursor or sending input to the game. Automated movement/UDP tests and a Windows registration smoke test cover the implementation; a physical in-match test is required before calling game compatibility verified. See [verification instructions](docs/Gameplay-Mouse-Verification.md).

## Setup

1. Turn on **Start API** in VTube Studio on the stream PC. The API normally uses `ws://127.0.0.1:8001`.
2. On the stream PC, run `vts_input_relay.exe --source <gaming-PC-LAN-IP>` as a background task, then run `VTubeInputBridge.exe --receiver` in the signed-in user's session. The receiver listens on `0.0.0.0:5055` and writes `status.json` next to its token file. If both PCs are on the same `10.0.0.x/24` network, use Canada's LAN address `10.0.0.119` as the sender destination; Tailscale is not needed for this bridge. Permit inbound UDP 5055 in Windows Firewall only from the gaming PC's private address.
3. Approve **Game Input Relay** by **ChayzX** when VTube Studio asks. The token is saved under `%LOCALAPPDATA%\VTubeInputRelay\vts-token.txt` for later starts.
4. The receiver also feeds the gaming mouse coordinates into VTube Studio's built-in `MousePositionX` and `MousePositionY` inputs. Models already mapped to those inputs will respond to the gaming mouse. Map any other `Game*` tracking inputs to the desired Live2D outputs in VTube Studio's model parameter settings; the receiver does not alter saved model mappings.
5. On the gaming PC, disable and stop any existing task that runs `gaming_input_relay.exe`. Install and run `VTubeInputBridge.exe --sender` in the signed-in gaming user's session. Its default destination is `10.0.0.119`; the Start button begins sending at about 60 Hz. The current app captures mouse position, mouse buttons, letters, digits, numpad digits, and supported special keys. The app's sign-in checkbox registers it under the current user's Run key with `--sender --autostart`.

The custom inputs are `GameMouseX`, `GameMouseY`, `GameMouseDX`, `GameMouseDY`, `GameMouseLeft`, `GameMouseRight`, `GameKeyW`, `GameKeyA`, `GameKeyS`, `GameKeyD`, `GameKeyShift`, `GameKeyCtrl`, and `GameKeySpace`. Mouse positions range from -1 to 1; deltas range from -2 to 2; buttons and keys are 0 or 1.

The sender also includes an optional `pressed_keys` array of Windows virtual-key codes. The receiver reads the loaded model's expression list and activates matching key or mouse-button expressions while input is held, then deactivates them on release. Matching ignores case, spaces, and punctuation in expression filenames, so a model can use names such as `W.exp3.json` or `left_click.exp3.json`. The receiver falls back to W/A/S/D, Shift, Ctrl, Space, and mouse buttons when the sender is older. After the feed stops for two seconds, held expressions are released. Models need corresponding expressions to show keys; mouse movement needs a Live2D mapping from `MousePositionX/Y` or `GameMouseX/Y`. The bridge cannot create those model assets or mappings automatically.

The legacy console sender remains available as `gaming_input_relay.exe` with `--destination`, `--port`, `--rate`, and `--simulate`, but it must not run alongside the app sender. Receiver options are `--bind <IP:port>`, `--vts-url <local WebSocket URL>`, `--token-file <path>`, and `--status-file <path>`. The receiver only accepts packets from `--source`, rejects invalid or out-of-order data, and retries the VTube Studio connection after a disconnect. VTube Studio releases plugin-controlled parameters about one second after updates stop.

## Updating a PC

**One-click update for the gaming PC.** After building, run `.\scripts\New-GamingPCInstaller.ps1 -Tag <release tag>`. It cross-checks `build\VTubeInputBridge-GamingPC.zip` against `build\SHA256SUMS.txt` and writes `build\Update-VTubeInputBridge-GamingPC.cmd`, a single file with the package and its SHA256 embedded. The streamer double-clicks it as the signed-in gaming user; no token, download, or PowerShell commands are needed. It refuses a package that fails its checksum, disables and stops any old `gaming_input_relay.exe` task, exits the running app, runs the package's `Install-GamingPC.ps1`, and records the version where `Update-VTubeBridge.ps1` looks for it. Windows shows an unsigned-file warning for a downloaded `.cmd` (choose **Run**, or **More info > Run anyway**). Gmail blocks `.cmd` attachments, so send it another way, such as Discord or a cloud-drive link.

`scripts/Update-VTubeBridge.ps1` downloads the newest release for that PC's role, verifies it against the release's `SHA256SUMS.txt`, and runs the matching installer. It refuses to install a package with no checksum entry or a mismatch, and skips the install if that release is already installed (`-Force` reinstalls). The repository is private, so each PC needs a read-only token.

**One-time setup per PC** (Pantry and Canada each get their own token so either can be revoked separately):

1. On GitHub: Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token. Name it for the PC, set an expiry, choose **Only select repositories** > `ChayzX/vtube-input-bridge`, and under Repository permissions set **Contents: Read-only** (Metadata read is added automatically). Nothing else.
2. On that PC, store it for the signed-in user (a new PowerShell window is needed afterwards):

```powershell
[Environment]::SetEnvironmentVariable('VTUBE_BRIDGE_TOKEN', '<paste token>', 'User')
```

3. Fetch the updater (re-run to pick up a newer copy):

```powershell
$h = @{ Authorization = "Bearer $env:VTUBE_BRIDGE_TOKEN"; Accept = 'application/vnd.github.raw' }
Invoke-WebRequest -Headers $h -UseBasicParsing -OutFile "$env:USERPROFILE\Update-VTubeBridge.ps1" -Uri 'https://api.github.com/repos/ChayzX/vtube-input-bridge/contents/scripts/Update-VTubeBridge.ps1'
```

**Updating**

```powershell
# Gaming PC (Pantry), as the signed-in gaming user; -StopApp exits a running sender first
& "$env:USERPROFILE\Update-VTubeBridge.ps1" -Role Gaming -StopApp

# Stream PC (Canada), in an administrator PowerShell; stop the bridge first (the installer will not interrupt it)
& "$env:USERPROFILE\Update-VTubeBridge.ps1" -Role Stream -GamingPC <gaming-PC-LAN-IP>
```

The Stream PC installer needs an administrator shell, and the token must be visible there: store it as the same user that opens the elevated shell, or pass `-Token <token>`. Use `-Tag <release tag>` to pin a version. To publish an update, run `scripts\build-windows.ps1`, then create a release that includes both ZIPs and `build\SHA256SUMS.txt`: `gh release create <tag> build\*.zip build\SHA256SUMS.txt`.

## Build and test

On Windows, install a Rust toolchain with its native linker and run:

```powershell
.\scripts\build-windows.ps1
```

This tests and builds the app and receiver, then writes separate GamingPC and StreamPC ZIPs under `build/`. It does not install either package. Use `-SkipReceiver` to build only the app/GamingPC ZIP. The stream installer refuses to interrupt a running bridge. Instructions are included in each ZIP.

On Linux, `cargo test --workspace --locked` tests the Rust workspace. With Mono and its WinForms/Web.Extensions assemblies installed, `bash scripts/test-mono.sh` runs the pure app and UDP tests and compiles the Windows app. Raw Input registration must be tested on Windows. The GitHub Actions Windows job runs that smoke test and uploads both packages. Binaries, local runtime files, and tokens are excluded from Git.

## Optional Stream Deck and reactive companion (preview)

`control_app/`, `streamdeck_plugin/`, and `media_helper/` add a separate **VTube Control** tray app. Pantry's Stream Deck can select Canada OBS scenes, control Canada Spotify, and trigger saved VTube Studio hotkeys. An experimental sandboxed Fugi renderer on Pantry relays transparent PNGs to a Canada Web Item. Real Discord speaking-state behavior and native Windows deployment remain unverified.

Tracking sources/installers are untouched. Controls start disabled, install into versioned directories, and have a separate rollback script and backup record. No code automatically edits OBS scenes, VTS model mappings or Stream Deck profiles. Read [setup and rollback](docs/Control-Setup.md) and [build limits](docs/Control-Build-Status.md) before installing.

**One-click install on the gaming PC.** After building, `.\scripts\New-ControlInstaller.ps1` wraps the pantry package and the Stream Deck plugin into `build\Install-VTubeControl-GamingPC.cmd` (about 200 MB, so share it as a cloud-drive link). Double-clicking it as the signed-in gaming user verifies both payloads' SHA256, runs `Install-Control.ps1 -Role pantry` (no startup entry or firewall rule), hands the plugin to Stream Deck, and opens the companion with controls still disabled. Pairing, the stream PC companion, and the VTube Studio Web Item remain the manual steps in the setup guide.

Build: Node 24+, .NET 10 SDK, `./scripts/build-controls.ps1`. The packaged Windows companion and Spotify helper include their runtimes; end users do not need Node/.NET for the companion. Stream Deck 7.1+ supplies the plugin's Node 24 runtime.
