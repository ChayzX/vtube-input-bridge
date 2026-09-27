VTube Input Bridge for the gaming PC
====================================

This package replaces the console sender with a windowed app and system tray icon.
The stream PC (Canada/Truffles) is 10.0.0.119. The gaming PC is 10.0.0.112.
No Tailscale connection is needed for this LAN relay.

1. Extract the ZIP on the gaming PC.
2. Exit an existing VTube Input Bridge app from its system tray menu before
   installing this update. If the old console sender is installed, find its
   Task Scheduler task, record its name/action, disable it, and stop it.
   Confirm gaming_input_relay.exe no longer appears in Task Manager.
3. Run Install-GamingPC.ps1 in the signed-in gaming user's PowerShell session.
   If script execution is restricted, the agent can run:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-GamingPC.ps1
   The installer creates VTube Input Bridge shortcuts on the Desktop and in
   the Start menu. The shortcuts launch the sender and start sending.
4. The app starts sending to 10.0.0.119 on UDP 5055. Its checkbox makes it start
   sending when the gaming user signs in. Close the window to keep it in the tray;
   use the tray menu's Exit command to stop it.
   For matches that lock the cursor, enable "Game mouse mode (for locked cursor)".
   Move the mouse during a match and confirm the raw movement event count rises.
   Adjust Game mouse sensitivity if needed. Movement returns toward center while
   idle. Turn Game mouse mode off to follow desktop cursor position in menus.
   Mode and sensitivity are remembered at the next sign-in.
5. On Canada, the VTube Input Bridge window should show Receiving input, with an
   increasing packet count, while the gaming PC is signed in. Move the mouse and
   press W to confirm GameMouseX/GameMouseY/GameKeyW change in VTube Studio.
6. Reboot the gaming PC and verify the app and feed start again. Restart VTube
   Studio on Canada and verify the receiver reconnects.

The sender reads the current desktop's mouse and keys. It sends mouse position,
button state, letters, digits, numpad digits, and supported special keys over
UDP. It reports packets sent,
which alone does not prove the stream PC received them; check Canada's app.

Canada's receiver checks the loaded model for matching key and mouse-button
expressions. Keyboard Greenie and Keyboard Greenie OPT have those expressions.
It also drives MousePositionX/Y for models that map them. Models without those
expressions or mappings need them added before they can show that input.

This game-mouse update goes on the gaming PC only. Canada needs no installation,
restart, or mapping change. A physical in-match test is still needed to verify
the fix with your game. The sender observes input and does not move the cursor
or inject input into the game. Settings live in %APPDATA%\VTubeInputBridge.
