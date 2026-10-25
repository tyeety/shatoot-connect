using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text;

// Window-message input keeps the system cursor untouched. Apps that depend on raw
// hardware input/GetCursorPos may require the host's explicit shared-cursor option.
sealed class IndependentPointer {
    public IntPtr ExcludedWindow { get; set; }
    public HashSet<IntPtr> ExcludedWindows { get; } = new();
    bool Excluded(IntPtr window) => window != IntPtr.Zero && (window == ExcludedWindow || ExcludedWindows.Contains(window));
    public bool HasPressed => pressed.Count > 0;
    public bool IsExcludedAt(int px, int py) => Excluded(GetAncestor(WindowFromPoint(new POINT { X = px, Y = py }), 2));
    readonly Dictionary<int, Target> pressed = new();
    int x, y, lastX, lastY, lastButton = -1;
    long lastDown;
    IntPtr lastWindow;
    record Target(IntPtr Window, IntPtr Root, int Hit, RECT Bounds, int StartX, int StartY, bool NativeButton);
    static IntPtr Coordinates(int x, int y) => (IntPtr)((y & 0xffff) << 16 | (x & 0xffff));
    uint State() => (uint)((pressed.ContainsKey(0) ? 1 : 0) | (pressed.ContainsKey(2) ? 2 : 0) | (pressed.ContainsKey(1) ? 16 : 0) | (GetAsyncKeyState(0x10) < 0 ? 4 : 0) | (GetAsyncKeyState(0x11) < 0 ? 8 : 0));
    Target? At(int px, int py) {
        var window = WindowFromPoint(new POINT { X = px, Y = py });
        if (window == IntPtr.Zero) return null;
        var root = GetAncestor(window, 2);
        if (Excluded(root)) {
            // Only remote input skips the protected host panel. Physical host
            // input still uses the normal Windows hit test and its buttons work.
            var visited = new HashSet<IntPtr>(); bool found = false;
            for (root = GetWindow(root, 2); root != IntPtr.Zero && visited.Add(root); root = GetWindow(root, 2)) {
                if (Excluded(root) || !IsWindowVisible(root) || !IsWindowEnabled(root)) continue;
                if (DwmGetWindowAttribute(root, 14, out int cloaked, sizeof(int)) == 0 && cloaked != 0) continue;
                if (!GetWindowRect(root, out var rect) || px < rect.Left || px >= rect.Right || py < rect.Top || py >= rect.Bottom) continue;
                found = true; break;
            }
            if (!found) return null;
            window = root;
            for (int depth = 0; depth < 32; depth++) {
                var point = new POINT { X = px, Y = py }; if (!ScreenToClient(window, ref point)) break;
                var child = ChildWindowFromPointEx(window, point, 7);
                if (child == IntPtr.Zero || child == window) break; window = child;
            }
        }
        GetWindowRect(root, out var bounds);
        int hit = 1;
        if (window == root && SendMessageTimeout(window, 0x84, IntPtr.Zero, Coordinates(px, py), 2, 20, out var result) != IntPtr.Zero) hit = result.ToInt32();
        var className = new StringBuilder(256); GetClassName(window, className, className.Capacity);
        if(className.ToString()=="#32768")hit=1;
        bool nativeButton = className.ToString().Equals("Button", StringComparison.OrdinalIgnoreCase) || className.ToString().Contains(".BUTTON.", StringComparison.OrdinalIgnoreCase);
        return new Target(window, root, hit, bounds, px, py, nativeButton);
    }
    void Post(Target target, uint message, uint flags, bool screenCoordinates = false) {
        var point = new POINT { X = x, Y = y };
        if (!screenCoordinates && !ScreenToClient(target.Window, ref point)) return;
        if (!PostMessage(target.Window, message, (IntPtr)flags, Coordinates(point.X, point.Y))) Console.Error.WriteLine("Window-message input blocked.");
    }
    public void Move(int px, int py) {
        x = px; y = py;
        var target = pressed.Values.FirstOrDefault() ?? At(x, y);
        if (target is null) return;
        if (pressed.ContainsKey(0) && target.Hit == 2) {
            SetWindowPos(target.Root, IntPtr.Zero, target.Bounds.Left + x - target.StartX, target.Bounds.Top + y - target.StartY, 0, 0, 0x0015);
        } else if (target.Hit == 1) Post(target, 0x200, State());
    }
    public void Button(int button, bool down, int px, int py) {
        if (button is not (0 or 1 or 2)) return;
        x = px; y = py;
        Target? target;
        if (down) {
            if (pressed.ContainsKey(button)) return;
            target = At(x, y); if (target is null) return;
            pressed[button] = target;
            var targetClass=new StringBuilder(256);GetClassName(target.Root,targetClass,targetClass.Capacity);
            // Popup menus belong to the existing foreground owner. Activating
            // the popup itself dismisses Windows' menu loop before the click.
            if(targetClass.ToString()!="#32768")SetForegroundWindow(target.Root);
        } else {
            if (!pressed.Remove(button, out target)) return;
        }
        var menuClass=new StringBuilder(256);GetClassName(target.Root,menuClass,menuClass.Capacity);
        if(button==0&&menuClass.ToString()=="#32768"){
            if(!down)try{
                // System menu loops consult the physical cursor, so posted
                // clicks cannot reliably invoke their items. MSAA invokes the
                // item at the remote point without moving that cursor.
                if(AccessibleObjectFromPoint(new POINT{X=x,Y=y},out var accessible,out var child)==0){try{((dynamic)accessible).accDoDefaultAction(child);return;}finally{if(Marshal.IsComObject(accessible))Marshal.ReleaseComObject(accessible);}}
            }catch(COMException){}catch(Microsoft.CSharp.RuntimeBinder.RuntimeBinderException){}
            return;
        }
        if (target.Hit != 1) {
            if (!down && button == 0) {
                var releaseTarget = At(x, y);
                if (releaseTarget?.Root != target.Root || releaseTarget.Hit != target.Hit) return;
                uint command = target.Hit switch { 8 => 0xF020, 9 => IsZoomed(target.Root) ? 0xF120u : 0xF030u, 20 => 0xF060, _ => 0 };
                if (command != 0) PostMessage(target.Root, 0x112, (IntPtr)command, IntPtr.Zero);
            }
            return;
        }
        if (button == 0 && target.NativeButton) {
            // BM_CLICK delivers the pair atomically inside the standard button
            // procedure, so physical host motion cannot cancel the remote click.
            PostMessage(target.Window, 0xF3, down ? (IntPtr)1 : IntPtr.Zero, IntPtr.Zero);
            if (!down && At(x, y)?.Window == target.Window) PostMessage(target.Window, 0xF5, IntPtr.Zero, IntPtr.Zero);
            return;
        }
        uint message = button switch { 0 => down ? 0x201u : 0x202u, 2 => down ? 0x204u : 0x205u, _ => down ? 0x207u : 0x208u };
        if (down) {
            var now = Environment.TickCount64;
            if (lastWindow == target.Window && lastButton == button && now - lastDown <= GetDoubleClickTime() && Math.Abs(x - lastX) < 4 && Math.Abs(y - lastY) < 4) { message += 2; lastDown = 0; }
            else lastDown = now;
            lastWindow = target.Window; lastButton = button; lastX = x; lastY = y;
            Post(target, 0x200, State());
        }
        Post(target, message, State());
    }
    public void Wheel(int dx, int dy) {
        var target = At(x, y); if (target is null) return;
        if (dy != 0) Post(target, 0x20A, State() | (unchecked((uint)(-dy)) & 0xffff) << 16, true);
        if (dx != 0) Post(target, 0x20E, State() | (unchecked((uint)dx) & 0xffff) << 16, true);
    }
    public void Release() { foreach (var button in pressed.Keys.ToArray()) Button(button, false, x, y); }

    public static int KeyboardSelfTest() {
        WindowProc procedure = (window, message, wp, lp) => DefWindowProc(window, message, wp, lp);
        string name = "ShatootKeyboardTest" + Environment.ProcessId;
        var wc = new WNDCLASS { ClassName = name, Procedure = procedure, Instance = GetModuleHandle(null) };
        RegisterClass(ref wc);
        var window = CreateWindowEx(0, name, "Shatoot keyboard layout check", 0x80C80000, 80, 80, 320, 150, IntPtr.Zero, IntPtr.Zero, wc.Instance, IntPtr.Zero);
        var sync = new KeyboardSync();
        try {
            ShowWindow(window, 5); SetForegroundWindow(window);
            var settle = Environment.TickCount64 + 150;
            while (Environment.TickCount64 < settle) { while (PeekMessage(out var msg, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref msg); DispatchMessage(ref msg); } Thread.Sleep(1); }
            if (GetForegroundWindow() != window) throw new InvalidOperationException("The isolated keyboard test window is not focused; no layout was changed.");
            var original = KeyboardSync.LayoutFor(window);
            bool english = sync.Apply("00000409") && (unchecked((uint)KeyboardSync.LayoutFor(window).ToInt64()) & 0xffff) == 0x409;
            bool persian = sync.Apply("00000429") && (unchecked((uint)KeyboardSync.LayoutFor(window).ToInt64()) & 0xffff) == 0x429;
            bool back = sync.Apply("00000409");
            sync.Restore(); bool restored = KeyboardSync.LayoutFor(window) == original;
            Console.WriteLine(JsonSerializer.Serialize(new { ok = english && persian && back && restored, english, persian, restored }));
            return english && persian && back && restored ? 0 : 1;
        } finally { sync.Restore(); DestroyWindow(window); UnregisterClass(name, wc.Instance); GC.KeepAlive(procedure); }
    }

    public static int MenuSelfTest(){
        WindowProc procedure=(w,m,wp,lp)=>DefWindowProc(w,m,wp,lp);
        string name="ShatootMenuTest"+Environment.ProcessId;var wc=new WNDCLASS{ClassName=name,Procedure=procedure,Instance=GetModuleHandle(null)};RegisterClass(ref wc);
        var host=CreateWindowEx(0,name,"Shatoot menu check",0x80C80000,80,80,400,250,IntPtr.Zero,IntPtr.Zero,wc.Instance,IntPtr.Zero);var menu=CreatePopupMenu();AppendMenu(menu,0,(UIntPtr)101,"First");AppendMenu(menu,0,(UIntPtr)102,"Second");
        ShowWindow(host,5);SetForegroundWindow(host);GetCursorPos(out var before);int originalMoves=Native.CursorMoveCount;
        using var timer=new Timer(_=>{var popup=FindWindow("#32768",null);if(popup==IntPtr.Zero)return;if(GetMenuItemRect(host,menu,1,out var rect)){var p=new IndependentPointer();p.Button(0,true,(rect.Left+rect.Right)/2,(rect.Top+rect.Bottom)/2);p.Button(0,false,(rect.Left+rect.Right)/2,(rect.Top+rect.Bottom)/2);}},null,300,Timeout.Infinite);
        using var cancel=new Timer(_=>PostMessage(host,0x1f,IntPtr.Zero,IntPtr.Zero),null,3000,Timeout.Infinite);
        try{uint command=TrackPopupMenuEx(menu,0x100,150,150,host,IntPtr.Zero);bool ok=command==102&&Native.CursorMoveCount==originalMoves;Console.WriteLine(JsonSerializer.Serialize(new{ok,command,cursorMovedByHelper=Native.CursorMoveCount!=originalMoves}));return ok?0:1;}
        finally{DestroyMenu(menu);DestroyWindow(host);UnregisterClass(name,wc.Instance);GC.KeepAlive(procedure);}
    }

    // A real Win32 button proves message delivery and checks that moving/clicking,
    // scrolling and releasing the remote pointer do not change GetCursorPos.
    public static int SelfTest() {
        int clicks = 0;
        WindowProc procedure = (window, message, wp, lp) => {
            if (message == 0x111 && (wp.ToInt64() & 0xffff) == 100 && ((wp.ToInt64() >> 16) & 0xffff) == 0) clicks++;
            return DefWindowProc(window, message, wp, lp);
        };
        string name = "ShatootPointerTest" + Environment.ProcessId;
        var wc = new WNDCLASS { ClassName = name, Procedure = procedure, Instance = GetModuleHandle(null) };
        if (RegisterClass(ref wc) == 0) throw new InvalidOperationException("RegisterClass failed");
        var host = CreateWindowEx(0, name, "Shatoot Connect input check", 0x80C80000, 80, 80, 320, 150, IntPtr.Zero, IntPtr.Zero, wc.Instance, IntPtr.Zero);
        try {
            var button = CreateWindowEx(0, "BUTTON", "Test click", 0x50000000, 20, 20, 160, 40, host, (IntPtr)100, wc.Instance, IntPtr.Zero);
            ShowWindow(host, 5);
            SetWindowPos(host, (IntPtr)(-1), 0, 0, 0, 0, 0x0053);
            SetForegroundWindow(host);
            void Pump() { var end = Environment.TickCount64 + 100; do { while (PeekMessage(out var msg, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref msg); DispatchMessage(ref msg); } Thread.Sleep(1); } while (Environment.TickCount64 < end); }
            Pump(); GetCursorPos(out var before); int originalMoves = Native.CursorMoveCount;
            var point = new POINT { X = 30, Y = 20 }; ClientToScreen(button, ref point);
            if (WindowFromPoint(point) != button) { var actual = new StringBuilder(256); GetClassName(WindowFromPoint(point), actual, actual.Capacity); DwmGetWindowAttribute(host, 14, out int cloaked, sizeof(int)); throw new InvalidOperationException($"The isolated test button is obscured; no input was sent (hostVisible={IsWindowVisible(host)}, buttonVisible={IsWindowVisible(button)}, cloaked={cloaked}, hitClass={actual}, x={point.X}, y={point.Y})."); }
            var pointer = new IndependentPointer();
            pointer.Move(point.X, point.Y); pointer.Button(0, true, point.X, point.Y); pointer.Button(0, false, point.X, point.Y); pointer.Wheel(0, 120); pointer.Release(); Pump();
            int normalClicks = clicks; bool hitExpectedButton = false;
            var veil = CreateWindowEx(0x80000, name, "Protected overlay", 0x80000000, point.X - 10, point.Y - 10, 100, 70, IntPtr.Zero, IntPtr.Zero, wc.Instance, IntPtr.Zero);
            try {
                SetLayeredWindowAttributes(veil, 0, 160, 2); ShowWindow(veil, 4); SetWindowPos(veil, (IntPtr)(-1), 0, 0, 0, 0, 0x0053); Pump();
                if (GetAncestor(WindowFromPoint(point), 2) != veil) throw new InvalidOperationException("Test overlay is not covering the button.");
                var through = new IndependentPointer(); through.ExcludedWindows.Add(veil);
                hitExpectedButton = through.At(point.X, point.Y)?.Window == button;
                through.Move(point.X, point.Y); through.Button(0, true, point.X, point.Y); through.Button(0, false, point.X, point.Y); through.Release(); Pump();
            } finally { DestroyWindow(veil); }
            GetCursorPos(out var after);
            bool stable = before.X == after.X && before.Y == after.Y;
            bool movedByHelper = Native.CursorMoveCount != originalMoves;
            Console.WriteLine(JsonSerializer.Serialize(new { ok = clicks == 2 && !movedByHelper, clicks, normalClicks, hitExpectedButton, clickedThroughOverlay = clicks == 2, cursorMovedByHelper = movedByHelper, cursorUnchanged = stable }));
            return clicks == 2 && !movedByHelper ? 0 : 1;
        } finally { DestroyWindow(host); UnregisterClass(name, wc.Instance); GC.KeepAlive(procedure); }
    }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate IntPtr WindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct WNDCLASS { public uint Style; public WindowProc Procedure; public int ClassExtra, WindowExtra; public IntPtr Instance, Icon, Cursor, Background; public string? MenuName; public string ClassName; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr Window; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public POINT Point; public uint Private; }
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] static extern IntPtr ChildWindowFromPointEx(IntPtr window, POINT point, uint flags);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr window, uint color, byte alpha, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, uint attribute, out int value, int size);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window, ref POINT point);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref POINT point);
    [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessage(IntPtr window, uint message, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wp, IntPtr lp, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClass(ref WNDCLASS value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool UnregisterClass(string name, IntPtr instance);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string name, string text, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string? name);
    [DllImport("user32.dll")]static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern bool AppendMenu(IntPtr menu,uint flags,UIntPtr id,string text);
    [DllImport("user32.dll")]static extern uint TrackPopupMenuEx(IntPtr menu,uint flags,int x,int y,IntPtr owner,IntPtr parameters);
    [DllImport("user32.dll")]static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")]static extern bool GetMenuItemRect(IntPtr window,IntPtr menu,uint index,out RECT rect);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern IntPtr FindWindow(string name,string? title);
    [DllImport("oleacc.dll")]static extern int AccessibleObjectFromPoint(POINT point,[MarshalAs(UnmanagedType.Interface)]out object accessible,[MarshalAs(UnmanagedType.Struct)]out object child);
}
