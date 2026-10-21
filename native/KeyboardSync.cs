using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// Synchronize the focused host input thread with the guest's actual Windows KLID.
// The original layout of each touched window is restored when control ends.
sealed class KeyboardSync {
    static readonly Dictionary<uint, string> names = new();
    readonly Dictionary<string, IntPtr> loaded = new();
    readonly Dictionary<IntPtr, (uint thread, IntPtr layout)> originals = new();
    static bool Same(IntPtr a, IntPtr b) => unchecked((uint)a.ToInt64()) == unchecked((uint)b.ToInt64());
    static IntPtr FocusWindow() {
        var window = GetForegroundWindow();
        var thread = GetWindowThreadProcessId(window, out _);
        var info = new GUITHREADINFO { Size = Marshal.SizeOf<GUITHREADINFO>() };
        return GetGUIThreadInfo(thread, ref info) && info.Focus != IntPtr.Zero ? info.Focus : window;
    }
    public static string Current() {
        var window = FocusWindow(); var thread = GetWindowThreadProcessId(window, out _);
        var layout = GetKeyboardLayout(thread);
        uint cacheKey = unchecked((uint)layout.ToInt64()); if (names.TryGetValue(cacheKey, out var cached)) return cached;
        ActivateKeyboardLayout(layout, 0); // This helper's thread only, not the foreground app.
        var name = new StringBuilder(9);
        if (GetKeyboardLayoutName(name) && Same(GetKeyboardLayout(0), layout)) return names[cacheKey] = name.ToString().ToUpperInvariant();
        uint encoded = unchecked((uint)layout.ToInt64()); string language = (encoded & 0xffff).ToString("X4");
        if ((encoded >> 16) == (encoded & 0xffff)) return "0000" + language;
        using var layouts = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Keyboard Layouts");
        if (layouts != null) foreach (var id in layouts.GetSubKeyNames().Where(id => id.Length == 8 && id.EndsWith(language, StringComparison.OrdinalIgnoreCase))) {
            using var key = layouts.OpenSubKey(id);
            if (uint.TryParse(key?.GetValue("Layout Id") as string, System.Globalization.NumberStyles.HexNumber, null, out var variant) && variant == ((encoded >> 16) & 0x0fff)) return id.ToUpperInvariant();
        }
        return ""; // Do not silently substitute a different variant.
    }
    public bool Apply(string id) {
        if (!Regex.IsMatch(id, "\\A[0-9A-Fa-f]{8}\\z")) return false;
        var window = FocusWindow(); if (window == IntPtr.Zero) return false;
        var thread = GetWindowThreadProcessId(window, out _);
        var current = GetKeyboardLayout(thread);
        if (!loaded.TryGetValue(id, out var desired)) { desired = LoadKeyboardLayout(id, 0); if (desired == IntPtr.Zero) return false; loaded[id] = desired; }
        if (Same(current, desired)) return true;
        if (!originals.ContainsKey(window)) originals[window] = (thread, current);
        SendMessageTimeout(window, 0x50, IntPtr.Zero, desired, 3, 100, out _);
        return Same(GetKeyboardLayout(thread), desired);
    }
    public void Restore() {
        foreach (var (window, original) in originals) {
            if (IsWindow(window) && GetWindowThreadProcessId(window, out _) == original.thread) SendMessageTimeout(window, 0x50, IntPtr.Zero, original.layout, 3, 100, out _);
        }
        originals.Clear();
    }
    public static void Monitor() {
        var requests = new System.Collections.Concurrent.ConcurrentQueue<string>(); int ended = 0;
        _ = Task.Run(() => { string? line; while ((line = Console.ReadLine()) != null) if (line.Length <= 64) requests.Enqueue(line); Volatile.Write(ref ended, 1); });
        string? previous = null; long sampled = 0, cursorSampled = 0, lastLayoutSent = 0; int lastX = int.MinValue, lastY = int.MinValue; bool lastVisible = false;
        while (Volatile.Read(ref ended) == 0) {
            while (requests.TryDequeue(out var request)) Console.WriteLine(JsonSerializer.Serialize(new { layout = Current(), request }));
            if (Environment.TickCount64 - sampled >= 100) { var id = Current(); if (id != previous || Environment.TickCount64 - lastLayoutSent >= 250) { Console.WriteLine(JsonSerializer.Serialize(new { layout = id })); previous = id; lastLayoutSent = Environment.TickCount64; } sampled = Environment.TickCount64; }
            if (Environment.TickCount64 - cursorSampled >= 33) {
                var cursor = new CURSORINFO { Size = Marshal.SizeOf<CURSORINFO>() };
                if (GetCursorInfo(ref cursor)) { bool visible = (cursor.Flags & 1) != 0; if (cursor.X != lastX || cursor.Y != lastY || visible != lastVisible) { Console.WriteLine(JsonSerializer.Serialize(new { type = "host-cursor", x = cursor.X, y = cursor.Y, visible })); lastX = cursor.X; lastY = cursor.Y; lastVisible = visible; } }
                cursorSampled = Environment.TickCount64;
            }
            Thread.Sleep(10);
        }
    }
    [StructLayout(LayoutKind.Sequential)] struct CURSORINFO { public int Size, Flags; public IntPtr Handle; public int X, Y; }
    [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll")] static extern int GetKeyboardLayoutList(int count, [Out] IntPtr[] layouts);
    public static void Cycle() {
        var window = FocusWindow(); if (window == IntPtr.Zero) return;
        var layouts = new IntPtr[256]; int count = GetKeyboardLayoutList(layouts.Length, layouts); if (count < 2) return;
        var current = GetKeyboardLayout(GetWindowThreadProcessId(window, out _)); int index = Array.FindIndex(layouts, 0, count, item => Same(item, current));
        SendMessageTimeout(window, 0x50, IntPtr.Zero, layouts[(index + 1) % count], 3, 100, out _);
    }
    public static int SelfTest() => IndependentPointer.KeyboardSelfTest();
    public static IntPtr LayoutFor(IntPtr window) => GetKeyboardLayout(GetWindowThreadProcessId(window, out _));
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO { public int Size; public uint Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public RECT CaretRect; }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
    [DllImport("user32.dll")] static extern IntPtr ActivateKeyboardLayout(IntPtr layout, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetKeyboardLayoutName(StringBuilder name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadKeyboardLayout(string id, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
}
