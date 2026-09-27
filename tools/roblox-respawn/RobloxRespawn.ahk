; Roblox Quick Respawn - AutoHotkey v2
; Press Tab in Roblox to reset your character (Esc -> R -> Enter).
; Only works while Roblox is the active window AND OP Auto Clicker is running.

#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent

; ---- settings ----
ClickerExe := "AutoClicker.exe"          ; OP Auto Clicker's process name
RobloxExe  := "RobloxPlayerBeta.exe"     ; Roblox game client
ResetKey   := "Tab"                      ; key that triggers a respawn
StepDelay  := 60                         ; ms between Esc, R and Enter
; ------------------

SetKeyDelay 20, 20
A_IconTip := "Roblox Respawn (waiting for OP Auto Clicker)"
SetTimer UpdateTip, 1000

IsReady(*) => WinActive("ahk_exe " RobloxExe) && ProcessExist(ClickerExe)

HotIf IsReady
Hotkey "$" ResetKey, Respawn
HotIf

Respawn(*) {
    Send "{Esc}"
    Sleep StepDelay
    Send "r"
    Sleep StepDelay
    Send "{Enter}"
}

UpdateTip() {
    global
    A_IconTip := ProcessExist(ClickerExe)
        ? "Roblox Respawn: ACTIVE (" ResetKey " = reset in Roblox)"
        : "Roblox Respawn (waiting for OP Auto Clicker)"
}
