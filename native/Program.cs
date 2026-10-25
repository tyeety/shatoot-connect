using System.Runtime.InteropServices;
using System.Text.Json;

// Narrow local stdin protocol. No shell execution or network listener.
Native.SetProcessDpiAwarenessContext(new IntPtr(-4));
if (args.Contains("--self-test")) { Environment.ExitCode = IndependentPointer.SelfTest(); return; }
if (args.Contains("--keyboard-monitor")) { KeyboardSync.Monitor(); return; }
if (args.Contains("--clipboard")) { ClipboardBridge.Run(); return; }
if (args.Contains("--wallpaper")) { Wallpaper.Write(); return; }
if (args.Length == 2 && args[0] == "--keyboard-grab" && long.TryParse(args[1], System.Globalization.NumberStyles.HexNumber, null, out var target)) { KeyboardGrab.Run(new IntPtr(target)); return; }
if (args.Contains("--keyboard-self-test")) { Environment.ExitCode = KeyboardSync.SelfTest(); return; }
if (args.Contains("--keyboard-hook-self-test")) { Environment.ExitCode = KeyboardGrab.Probe(); return; }
bool verifyCursor = args.Contains("--verify-cursor");
Native.GetCursorPos(out var initialCursor);
var keys = new HashSet<ushort>();
var physicalKeys = new Dictionary<int, KEYBDINPUT>();
var buttons = new HashSet<int>();
var independentPointer = new IndependentPointer();
bool sharedCursor = false;
var keyboardSync = new KeyboardSync();
int left = 0, top = 0, width = 1, height = 1;
void Mouse(uint flags, int data = 0) => Native.Inject(new INPUT { type = 0, u = new InputUnion { mi = new MOUSEINPUT { dwFlags = flags, mouseData = unchecked((uint)data) } } });
void Key(ushort key, bool up) {
    var scan = Native.ScanCode(key);
    Native.Inject(new INPUT { type = 1, u = new InputUnion { ki = new KEYBDINPUT { wVk = scan == 0 ? key : (ushort)0, wScan = scan, dwFlags = (scan == 0 ? 0u : 8u) | (up ? 2u : 0u) | (Native.Extended(key) ? 1u : 0u) } } });
}
void Release() {
    independentPointer.Release();
    foreach (var key in keys) Key(key, true);
    foreach (var physical in physicalKeys.Values) { var up = physical; up.dwFlags |= 2; Native.Inject(new INPUT { type = 1, u = new InputUnion { ki = up } }); }
    physicalKeys.Clear();
    foreach (var button in buttons) Mouse(button == 0 ? 4u : button == 2 ? 16u : 64u);
    keys.Clear(); buttons.Clear();
}
try {
    string? line;
    while ((line = Console.ReadLine()) != null) {
        if (line.Length > 4096) continue;
        try {
            using var doc = JsonDocument.Parse(line);
            var m = doc.RootElement;
            var type = m.GetProperty("type").GetString();
            if (type == "bounds") {
                Release(); left = m.GetProperty("x").GetInt32(); top = m.GetProperty("y").GetInt32();
                width = Math.Clamp(m.GetProperty("width").GetInt32(), 1, 32768);
                height = Math.Clamp(m.GetProperty("height").GetInt32(), 1, 32768);
                sharedCursor = m.TryGetProperty("sharedCursor", out var shared) && shared.ValueKind == JsonValueKind.True;
            } else if (type == "release") Release();
            else if (type == "exclude-window") { var value = m.GetProperty("handle").GetString(); if (ulong.TryParse(value, System.Globalization.NumberStyles.HexNumber, null, out var handle)) independentPointer.ExcludedWindow = unchecked((IntPtr)(long)handle); }
            else if (type == "exclude-windows") { independentPointer.ExcludedWindows.Clear(); foreach (var item in m.GetProperty("handles").EnumerateArray().Take(8)) if (ulong.TryParse(item.GetString(), System.Globalization.NumberStyles.HexNumber, null, out var handle)) independentPointer.ExcludedWindows.Add(unchecked((IntPtr)(long)handle)); }
            else if (type == "layout-stop") keyboardSync.Restore();
            else if (type == "layout") { var layout = m.GetProperty("layout").GetString() ?? ""; Console.WriteLine(JsonSerializer.Serialize(new { type = "layout-status", layout, ok = keyboardSync.Apply(layout) })); }
            else if (type == "move" || type == "button") {
                var x = m.GetProperty("x").GetDouble(); var y = m.GetProperty("y").GetDouble();
                if (!double.IsFinite(x) || !double.IsFinite(y)) continue;
                int screenX = left + (int)Math.Round(Math.Clamp(x, 0, 1) * (width - 1));
                int screenY = top + (int)Math.Round(Math.Clamp(y, 0, 1) * (height - 1));
                if (!sharedCursor || (buttons.Count == 0 && (independentPointer.HasPressed || independentPointer.IsExcludedAt(screenX, screenY)))) {
                    if (type == "move") independentPointer.Move(screenX, screenY);
                    else independentPointer.Button(m.GetProperty("button").GetInt32(), m.GetProperty("down").GetBoolean(), screenX, screenY);
                    continue;
                }
                Native.SetCursorPos(screenX, screenY);
                if (type == "button") {
                    int b = m.GetProperty("button").GetInt32();
                    if (b is not (0 or 1 or 2)) continue;
                    bool down = m.GetProperty("down").GetBoolean();
                    if (down ? buttons.Add(b) : buttons.Remove(b)) Mouse(b == 0 ? (down ? 2u : 4u) : b == 2 ? (down ? 8u : 16u) : (down ? 32u : 64u));
                }
            } else if (type == "wheel") {
                int dy = (int)Math.Clamp(m.GetProperty("dy").GetDouble(), -1200, 1200);
                int dx = (int)Math.Clamp(m.GetProperty("dx").GetDouble(), -1200, 1200);
                if (!sharedCursor || independentPointer.IsExcludedAt(left + (int)Math.Round(Math.Clamp(m.TryGetProperty("x", out var wx) ? wx.GetDouble() : 0, 0, 1) * (width - 1)), top + (int)Math.Round(Math.Clamp(m.TryGetProperty("y", out var wy) ? wy.GetDouble() : 0, 0, 1) * (height - 1)))) {
                    if (m.TryGetProperty("x", out var wheelX) && m.TryGetProperty("y", out var wheelY) && double.IsFinite(wheelX.GetDouble()) && double.IsFinite(wheelY.GetDouble())) {
                        independentPointer.Move(left + (int)Math.Round(Math.Clamp(wheelX.GetDouble(), 0, 1) * (width - 1)), top + (int)Math.Round(Math.Clamp(wheelY.GetDouble(), 0, 1) * (height - 1)));
                    }
                    independentPointer.Wheel(dx, dy); continue;
                }
                if (dy != 0) Mouse(0x0800, -dy);
                if (dx != 0) Mouse(0x1000, dx);
            } else if (type == "key" || type == "physical-key") {
                if (!m.TryGetProperty("layout", out _)) { Release(); Console.WriteLine(JsonSerializer.Serialize(new { type = "layout-status", layout = "", ok = false })); continue; }
                if (m.TryGetProperty("layout", out var layout) && !keyboardSync.Apply(layout.GetString() ?? "")) { Release(); Console.WriteLine(JsonSerializer.Serialize(new { type = "layout-status", layout = layout.GetString(), ok = false })); continue; }
                if (type == "physical-key") {
                    int scan = m.GetProperty("scan").GetInt32(), vk = m.GetProperty("vk").GetInt32();
                    if (scan is < 1 or > 127 || vk is < 1 or > 254) continue;
                    bool downPhysical = m.GetProperty("down").GetBoolean(), extended = m.GetProperty("extended").GetBoolean();
                    int id = scan | (extended ? 0x100 : 0); var physical = vk == 0x13 ? new KEYBDINPUT { wVk = 0x13 } : new KEYBDINPUT { wScan = (ushort)scan, dwFlags = 8u | (extended ? 1u : 0u) };
                    if (downPhysical) { physicalKeys[id] = physical; Native.Inject(new INPUT { type = 1, u = new InputUnion { ki = physical } }); }
                    else if (physicalKeys.Remove(id, out var previous)) { previous.dwFlags |= 2; Native.Inject(new INPUT { type = 1, u = new InputUnion { ki = previous } }); }
                    continue;
                }
                var code = m.GetProperty("code").GetString() ?? "";
                ushort key = Native.VirtualKey(code);
                if (key == 0) continue;
                bool down = m.GetProperty("down").GetBoolean();
                if (down) { keys.Add(key); Key(key, false); }
                else if (keys.Remove(key)) Key(key, true);
            }
        } catch (Exception e) when (e is JsonException or InvalidOperationException or KeyNotFoundException or FormatException or OverflowException) { }
    }
} finally {
    Release();
    keyboardSync.Restore();
    if (verifyCursor) { Native.GetCursorPos(out var finalCursor); Console.WriteLine(JsonSerializer.Serialize(new { cursorUnchanged = initialCursor.X == finalCursor.X && initialCursor.Y == finalCursor.Y, cursorMovedByHelper = Native.CursorMoveCount != 0 })); }
}

[StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
[StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
[StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
static class Native {
    static IntPtr physicalKeyLayout;
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr LoadKeyboardLayout(string id, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint MapVirtualKeyEx(uint key, uint mode, IntPtr layout);
    public static ushort ScanCode(ushort key) {
        // Load after the process DPI context has been established. Loading an IME
        // first can create a hidden window and lock in the wrong DPI context.
        if (physicalKeyLayout == IntPtr.Zero) physicalKeyLayout = LoadKeyboardLayout("00000409", 0);
        return (ushort)(MapVirtualKeyEx(key, 0, physicalKeyLayout) & 0xff);
    }
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out IndependentPointer.POINT point);
    public static int CursorMoveCount { get; private set; }
    [DllImport("user32.dll", EntryPoint = "SetCursorPos")] static extern bool SetCursorPosNative(int x, int y);
    public static bool SetCursorPos(int x, int y) { CursorMoveCount++; return SetCursorPosNative(x, y); }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    public static void Inject(INPUT input) {
        if (SendInput(1, [input], Marshal.SizeOf<INPUT>()) != 1) Console.Error.WriteLine("Input blocked (possibly elevated desktop).");
    }
    public static bool Extended(ushort k) => k is 0x21 or 0x22 or 0x23 or 0x24 or 0x25 or 0x26 or 0x27 or 0x28 or 0x2D or 0x2E or 0xA3 or 0xA5 or 0x5B or 0x5C or 0x6F or 0x90;
    public static ushort VirtualKey(string code) {
        if (code.Length == 4 && code.StartsWith("Key") && code[3] is >= 'A' and <= 'Z') return code[3];
        if (code.Length == 6 && code.StartsWith("Digit") && char.IsAsciiDigit(code[5])) return code[5];
        if (code.Length == 7 && code.StartsWith("Numpad") && char.IsAsciiDigit(code[6])) return (ushort)(0x60 + code[6] - '0');
        if (code.StartsWith('F') && int.TryParse(code.AsSpan(1), out int f) && f is >= 1 and <= 24) return (ushort)(0x70 + f - 1);
        return code switch {
            "Backspace" => 8, "Tab" => 9, "Enter" => 13, "Escape" => 27, "Space" => 32,
            "PageUp" => 0x21, "PageDown" => 0x22, "End" => 0x23, "Home" => 0x24,
            "ArrowLeft" => 0x25, "ArrowUp" => 0x26, "ArrowRight" => 0x27, "ArrowDown" => 0x28,
            "Insert" => 0x2D, "Delete" => 0x2E, "ShiftLeft" => 0xA0, "ShiftRight" => 0xA1,
            "ControlLeft" => 0xA2, "ControlRight" => 0xA3, "AltLeft" => 0xA4, "AltRight" => 0xA5,
            "MetaLeft" => 0x5B, "MetaRight" => 0x5C, "CapsLock" => 0x14,
            "NumpadAdd" => 0x6B, "NumpadSubtract" => 0x6D, "NumpadMultiply" => 0x6A,
            "NumpadDivide" => 0x6F, "NumpadDecimal" => 0x6E, "NumpadEnter" => 13,
            "NumLock" => 0x90, "ScrollLock" => 0x91, "ContextMenu" => 0x5D, "PrintScreen" => 0x2C, "Pause" => 0x13,
            "Semicolon" => 0xBA, "Equal" => 0xBB, "Comma" => 0xBC, "Minus" => 0xBD,
            "Period" => 0xBE, "Slash" => 0xBF, "Backquote" => 0xC0, "BracketLeft" => 0xDB,
            "Backslash" => 0xDC, "BracketRight" => 0xDD, "Quote" => 0xDE, _ => 0
        };
    }
}
