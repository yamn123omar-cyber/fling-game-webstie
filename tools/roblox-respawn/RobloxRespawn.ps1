# Roblox Quick Respawn - no install needed (uses Windows PowerShell)
# Press Tab in Roblox to reset your character (Esc -> R -> Enter).
# Only works while Roblox is the active window AND OP Auto Clicker is running.

# ---- settings ----
$ClickerName = "AutoClicker"        # OP Auto Clicker process name (without .exe)
$RobloxName  = "RobloxPlayerBeta"   # Roblox game client process name
$StepDelay   = 60                   # ms between Esc, R and Enter
# ------------------

Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class RobloxRespawn {
    public static string ClickerName, RobloxName;
    public static int StepDelay;

    const int WH_KEYBOARD_LL = 13, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
    const int VK_TAB = 0x09, LLKHF_INJECTED = 0x10;
    const uint KEYEVENTF_SCANCODE = 0x08, KEYEVENTF_KEYUP = 0x02;

    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
    static HookProc proc = Hook;
    static IntPtr hook;
    static int busy;

    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);

    public static void Run() {
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
        Application.Run();
    }

    static bool Ready() {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        try {
            if (!Process.GetProcessById((int)pid).ProcessName.Equals(RobloxName, StringComparison.OrdinalIgnoreCase))
                return false;
        } catch { return false; }
        return Process.GetProcessesByName(ClickerName).Length > 0;
    }

    static IntPtr Hook(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            int vk = Marshal.ReadInt32(lParam);
            int flags = Marshal.ReadInt32(lParam, 8);
            bool down = wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN;
            if (vk == VK_TAB && (flags & LLKHF_INJECTED) == 0 && Ready()) {
                if (down && Interlocked.CompareExchange(ref busy, 1, 0) == 0)
                    new Thread(Respawn) { IsBackground = true }.Start();
                return (IntPtr)1; // swallow Tab so the player list doesn't toggle
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    static void Tap(byte scan) {
        keybd_event(0, scan, KEYEVENTF_SCANCODE, UIntPtr.Zero);
        Thread.Sleep(20);
        keybd_event(0, scan, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    static void Respawn() {
        Tap(0x01); Thread.Sleep(StepDelay);   // Esc
        Tap(0x13); Thread.Sleep(StepDelay);   // R
        Tap(0x1C);                            // Enter
        busy = 0;
    }
}
"@

[RobloxRespawn]::ClickerName = $ClickerName
[RobloxRespawn]::RobloxName  = $RobloxName
[RobloxRespawn]::StepDelay   = $StepDelay
Write-Host "Roblox Respawn running. Press Tab in Roblox (while OP Auto Clicker is open) to reset. Close this window to stop."
[RobloxRespawn]::Run()
