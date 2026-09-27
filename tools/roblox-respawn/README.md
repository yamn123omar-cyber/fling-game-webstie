# Roblox Quick Respawn

Press **Tab** in Roblox to instantly reset your character (it presses Esc → R → Enter for you).

It only does anything when **both** are true:
- Roblox is the window you're in (Tab works normally everywhere else)
- OP Auto Clicker is running

Nothing to install — it uses PowerShell, which comes with Windows.

## Use it
1. Keep `RobloxRespawn.bat` and `RobloxRespawn.ps1` in the same folder.
2. Double-click `RobloxRespawn.bat`. It runs minimized in the taskbar; close that window to stop it.
3. To have it always ready, press `Win+R`, type `shell:startup`, and put a shortcut to `RobloxRespawn.bat` in that folder. It sits idle until OP Auto Clicker is open and you're in Roblox.

## Settings
Edit the top of `RobloxRespawn.ps1` (Notepad is fine):
- `$ClickerName` – if your OP Auto Clicker has a different process name (Task Manager → Details, drop the `.exe`).
- `$StepDelay` – increase (e.g. `100`) if the reset sometimes doesn't go through.

Note: most Roblox games have a respawn cooldown (~5s), so pressing faster won't respawn faster.
