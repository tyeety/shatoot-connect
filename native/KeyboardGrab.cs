using System.Runtime.InteropServices;
using System.Text.Json;
using System.Collections.Concurrent;

// Only intercept physical keys while the explicitly focused viewer owns foreground.
static class KeyboardGrab {
    delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint Key, Scan, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr Window; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public int X, Y; public uint Private; }
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Hook callback, IntPtr instance, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string? name);
    public static int Probe() {
        Hook callback = (code, message, data) => CallNextHookEx(IntPtr.Zero, code, message, data);
        var hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        bool ok = hook != IntPtr.Zero && UnhookWindowsHookEx(hook); GC.KeepAlive(callback);
        Console.WriteLine(JsonSerializer.Serialize(new { keyboardHookInstalledAndReleased = ok })); return ok ? 0 : 1;
    }
    public static void Run(IntPtr target) {
        if (target == IntPtr.Zero) return;
        int ended = 0; var events = new ConcurrentQueue<object>(); var pressed = new HashSet<uint>(); string layout = KeyboardSync.Current();
        _ = Task.Run(() => { while (Console.ReadLine() != null) {} Volatile.Write(ref ended, 1); });
        Hook callback = (code, message, pointer) => {
            if (code < 0) return CallNextHookEx(IntPtr.Zero, code, message, pointer);
            var key = Marshal.PtrToStructure<KeyData>(pointer);
            if ((key.Flags & 0x10) != 0 || GetForegroundWindow() != target) return CallNextHookEx(IntPtr.Zero, code, message, pointer);
            bool down = (key.Flags & 0x80) == 0;
            // Emergency disconnect remains an ordinary local OS shortcut.
            bool ctrl = pressed.Contains(0xA2) || pressed.Contains(0xA3) || GetAsyncKeyState(0x11) < 0;
            bool shift = pressed.Contains(0xA0) || pressed.Contains(0xA1) || GetAsyncKeyState(0x10) < 0;
            if (key.Key == 0x7B && ctrl && shift) { if (down) events.Enqueue(new { emergency = true }); return new IntPtr(1); }
            if (down) pressed.Add(key.Key); else pressed.Remove(key.Key);
            if (down && ((shift && (key.Key is 0xA2 or 0xA3 or 0xA4 or 0xA5)) || ((ctrl || pressed.Contains(0xA4) || pressed.Contains(0xA5)) && (key.Key is 0xA0 or 0xA1)) || (key.Key == 32 && (pressed.Contains(0x5B) || pressed.Contains(0x5C))))) {
                events.Enqueue(new { release = true, layoutSwitch = true }); return new IntPtr(1);
            }
            events.Enqueue(new { vk = key.Key, scan = key.Scan, extended = (key.Flags & 1) != 0, down, layout, ctrl, shift });
            return new IntPtr(1);
        };
        var hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) { Console.WriteLine("{\"error\":\"Keyboard capture could not start.\"}"); return; }
        Console.WriteLine("{\"ready\":true}");
        try {
            long sampled = 0;
            while (Volatile.Read(ref ended) == 0) {
                if (GetForegroundWindow() != target && pressed.Count > 0) { pressed.Clear(); events.Enqueue(new { release = true }); }
                while (PeekMessage(out var message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessage(ref message); }
                // No IPC, layout lookup, disk access or stdout writes in the hook callback.
                while (events.TryDequeue(out var value)) {
                    var json = JsonSerializer.Serialize(value);
                    if (json.Contains("layoutSwitch")) { KeyboardSync.Cycle(); layout = KeyboardSync.Current(); }
                    Console.WriteLine(json);
                }
                if (Environment.TickCount64 - sampled >= 80) { layout = KeyboardSync.Current(); sampled = Environment.TickCount64; }
                Thread.Sleep(2);
            }
        } finally { UnhookWindowsHookEx(hook); GC.KeepAlive(callback); }
    }
}
