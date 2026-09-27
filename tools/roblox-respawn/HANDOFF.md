# Handoff: Roblox Quick Respawn

## What the user wants
- On Windows, pressing **Tab** in Roblox should reset their character (quickly, over and over).
- It should **only** work when:
  1. Roblox (`RobloxPlayerBeta.exe`) is the active window, and
  2. OP Auto Clicker (assumed `AutoClicker.exe`) is running.
- The user does **not** want AutoHotkey. They want something that just runs with nothing to install.
- They're in a hurry (they said they'll get kicked if they don't keep resetting).

## What exists (branch `claude/great-brown-6gkg6s`, folder `tools/roblox-respawn/`)
- `RobloxRespawn.ps1`: a PowerShell script with inline C# (`Add-Type`).
  - Installs a low-level keyboard hook (`WH_KEYBOARD_LL`).
  - On a real (not injected) Tab press, when the conditions above are true, it swallows Tab and, on a background thread, sends Esc → R → Enter as scancodes via `keybd_event` (60 ms apart by default).
  - Settings at the top: `$ClickerName`, `$RobloxName`, `$StepDelay`.
- `RobloxRespawn.bat`: double-click launcher (runs the .ps1 minimized with `-ExecutionPolicy Bypass`).
- `README.md`: user instructions.

## How to start it (no download)
Paste into Win+R:
```
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm 'https://raw.githubusercontent.com/yamn123omar-cyber/fling-game-webstie/claude/great-brown-6gkg6s/tools/roblox-respawn/RobloxRespawn.ps1')"
```
The raw URL was checked and returns HTTP 200.

## Status / not verified
- **Never tested on Windows.** The previous AI was working on a Linux cloud server with no access to the user's PC.
- Unconfirmed:
  - Whether OP Auto Clicker's process is really named `AutoClicker` (check Task Manager → Details).
  - Whether Roblox accepts the scancode keystrokes.
  - Whether a 60 ms delay is enough for Roblox's reset menu.
- Manual fallback: Esc → R → Enter.
- Most Roblox games have a respawn cooldown (about 5 s), so pressing faster won't respawn faster.

## Likely next steps
1. Have the user run the Win+R line and report what the window shows.
2. If Tab does nothing:
   - Check the auto clicker's process name.
   - Try a larger `$StepDelay` (100–150).
   - Try `SendInput` instead of `keybd_event`.
3. Optional: add a startup shortcut (`shell:startup`) or package the tool as an .exe.
