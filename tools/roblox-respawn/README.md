# Roblox Quick Respawn

Press **Tab** in Roblox to instantly reset your character (it presses Esc → R → Enter for you).

It only does anything when **both** are true:
- Roblox is the window you're in (Tab works normally everywhere else)
- OP Auto Clicker is running

## Setup (Windows)
1. Install [AutoHotkey v2](https://www.autohotkey.com/).
2. Double-click `RobloxRespawn.ahk`. A green "H" icon appears in the tray.
3. To have it always ready, press `Win+R`, type `shell:startup`, and put a shortcut to `RobloxRespawn.ahk` in that folder. It sits idle until OP Auto Clicker is open.

Optional: right-click the file → *Compile Script* to turn it into a normal `.exe`.

## Settings
Edit the top of the script:
- `ClickerExe` – if your OP Auto Clicker exe has a different name (check Task Manager → Details).
- `ResetKey` – change `Tab` to another key, e.g. `F`.
- `StepDelay` – increase if the reset menu sometimes doesn't register.

Note: Roblox games have a respawn cooldown (usually ~5s), so pressing faster won't respawn faster.
