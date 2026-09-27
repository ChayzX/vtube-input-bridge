# Gameplay mouse verification

## Current evidence

The existing sender reads `GetCursorPos`; games that lock or repeatedly center the desktop cursor can leave those coordinates stationary. This explains the reported match/menu difference, but the specific game has not yet been traced. The new app observes background raw relative movement and sends it through the same version 1 fields. It does not require receiver or model changes.

Local tests cover x86/x64 raw-packet layouts, signed movement, stationary-cursor movement, accumulated/drained frames, bounded output, return to center, sensitivity, mode resets, preservation of keyboard/buttons, and actual UDP delivery. The Windows smoke test exercises registration, cleanup, and re-registration. Neither simulates a game's physical mouse input.

## Pantry installation and real test

1. Arrange a brief sender update window. Record the running sender and its logon configuration. Exit the existing sender from its tray (or stop its legacy scheduled task). Never run two senders.
2. Extract the GamingPC ZIP and run `Install-GamingPC.ps1` as Pantry's signed-in gaming user. No changes are required on Canada.
3. Check destination `10.0.0.119`, packet counter, and desktop mouse/keyboard/click behavior.
4. Enable **Game mouse mode (for locked cursor)**. In a match, move the mouse left/right/up/down. Confirm the app's raw movement counter increases and the model responds on Canada. The counter is cumulative and includes movement observed in desktop mode; compare readings taken during the match.
5. Stop moving. Confirm the model returns toward center instead of remaining at the boundary. Adjust sensitivity if movement is too large or small.
6. Pause and switch back to desktop mode. Confirm cursor-position tracking works again and keyboard/click behavior still works in both modes.
7. Close the app window into the tray. Repeat in-match movement; it must still work. Reopen the window to inspect its counter/status.
8. At a convenient time, restart Pantry's sender and verify saved mode/sensitivity. A later Pantry reboot should start exactly one sender with those settings.

Do not restart VTube Studio, replace Canada's receiver, or modify its model mappings for this test.

## Interpreting failures

- Raw counter stays fixed during physical in-match movement: the capture path is not receiving events. Record the game, fullscreen/borderless mode, whether it runs elevated, and the sender error. Investigate that before changing Canada.
- Raw counter rises but model stays still: verify Pantry's outgoing packets and Canada's existing receiving status; then inspect live mouse parameter values using a separate read-only API connection during an agreed observation window.
- Raw capture fails to register: the app displays an error and cannot use game mode. Preserve that error; do not silently fall back and claim the game test passed.

## References

- [Windows Raw Input overview](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input): background delivery with `RIDEV_INPUTSINK`.
- [RAWMOUSE layout](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-rawmouse): relative X/Y values and distinction from absolute tablet input.
- [VTube Studio mouse input configuration](https://github.com/DenchiSoft/VTubeStudio/wiki/VTube-Studio-Settings): cursor-position ranges mapped to model input values.
