# Game Input Relay for VTube Studio

A Windows app and a background receiver bridge keyboard and mouse state from a gaming PC to VTube Studio on the stream PC. The gaming app transmits UDP on port 5055. The receiver creates 13 custom VTube Studio input parameters and updates them while packets arrive. The same app shows receiver status on the stream PC. Closing either app window leaves it in the system tray.

## Setup

1. Turn on **Start API** in VTube Studio on the stream PC. The API normally uses `ws://127.0.0.1:8001`.
2. On the stream PC, run `vts_input_relay.exe --source <gaming-PC-LAN-IP>` as a background task, then run `VTubeInputBridge.exe --receiver` in the signed-in user's session. The receiver listens on `0.0.0.0:5055` and writes `status.json` next to its token file. If both PCs are on the same `10.0.0.x/24` network, use Canada's LAN address `10.0.0.119` as the sender destination; Tailscale is not needed for this bridge. Permit inbound UDP 5055 in Windows Firewall only from the gaming PC's private address.
3. Approve **Game Input Relay** by **ChayzX** when VTube Studio asks. The token is saved under `%LOCALAPPDATA%\VTubeInputRelay\vts-token.txt` for later starts.
4. The receiver also feeds the gaming mouse coordinates into VTube Studio's built-in `MousePositionX` and `MousePositionY` inputs. Models already mapped to those inputs will respond to the gaming mouse. Map any other `Game*` tracking inputs to the desired Live2D outputs in VTube Studio's model parameter settings; the receiver does not alter saved model mappings.
5. On the gaming PC, disable and stop any existing task that runs `gaming_input_relay.exe`. Install and run `VTubeInputBridge.exe --sender` in the signed-in gaming user's session. Its default destination is `10.0.0.119`; the Start button begins sending at about 60 Hz. The current app captures mouse position, mouse buttons, letters, digits, numpad digits, and supported special keys. The app's sign-in checkbox registers it under the current user's Run key with `--sender --autostart`.

The custom inputs are `GameMouseX`, `GameMouseY`, `GameMouseDX`, `GameMouseDY`, `GameMouseLeft`, `GameMouseRight`, `GameKeyW`, `GameKeyA`, `GameKeyS`, `GameKeyD`, `GameKeyShift`, `GameKeyCtrl`, and `GameKeySpace`. Mouse positions range from -1 to 1; deltas range from -2 to 2; buttons and keys are 0 or 1.

The sender also includes an optional `pressed_keys` array of Windows virtual-key codes. The receiver reads the loaded model's expression list and activates matching key or mouse-button expressions while input is held, then deactivates them on release. Matching ignores case, spaces, and punctuation in expression filenames, so a model can use names such as `W.exp3.json` or `left_click.exp3.json`. The receiver falls back to W/A/S/D, Shift, Ctrl, Space, and mouse buttons when the sender is older. After the feed stops for two seconds, held expressions are released. Models need corresponding expressions to show keys; mouse movement needs a Live2D mapping from `MousePositionX/Y` or `GameMouseX/Y`. The bridge cannot create those model assets or mappings automatically.

The legacy console sender remains available as `gaming_input_relay.exe` with `--destination`, `--port`, `--rate`, and `--simulate`, but it must not run alongside the app sender. Receiver options are `--bind <IP:port>`, `--vts-url <local WebSocket URL>`, `--token-file <path>`, and `--status-file <path>`. The receiver only accepts packets from `--source`, rejects invalid or out-of-order data, and retries the VTube Studio connection after a disconnect. VTube Studio releases plugin-controlled parameters about one second after updates stop.

## Build and test

Run `cargo test` from this directory. Build the receiver with `cargo build --release --target x86_64-pc-windows-gnu -p vts_input_relay` from a Rust toolchain with the target and MinGW linker installed. Build the app on Windows with the .NET Framework C# compiler:

```cmd
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:winexe /win32icon:windows_app\bridge.ico /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /out:windows_app\VTubeInputBridge.exe windows_app\BridgeCore.cs windows_app\SenderRuntime.cs windows_app\WindowsInputCapture.cs windows_app\BridgeApp.cs
```

The app core and UDP sender tests are `windows_app\BridgeCoreTests.cs` and `windows_app\SenderRuntimeTests.cs`.
