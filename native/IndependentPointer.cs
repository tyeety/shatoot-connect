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
    long lastDown,lastMenuHover;
    IntPtr lastWindow;
    record Target(IntPtr Window, IntPtr Root, int Hit, RECT Bounds, int StartX, int StartY, bool NativeButton,bool Menu=false);
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
        } else if (target.Hit == 1) {
            Post(target, 0x200, State());
            var cls=new StringBuilder(256);GetClassName(target.Root,cls,cls.Capacity);
            if(Environment.TickCount64-lastMenuHover>100&&(cls.ToString()=="#32768"||cls.ToString().Contains("Popup",StringComparison.OrdinalIgnoreCase))){lastMenuHover=Environment.TickCount64;MenuAutomation.At(x,y,expandOnly:true);}
        }
    }
    public void Button(int button, bool down, int px, int py) {
        if (button is not (0 or 1 or 2)) return;
        x = px; y = py;
        Target? target;
        if (down) {
            if (pressed.ContainsKey(button)) return;
            target = At(x, y); if (target is null) return;
            var targetClass=new StringBuilder(256);GetClassName(target.Root,targetClass,targetClass.Capacity);
            if(button==0)target=target with{Menu=targetClass.ToString()=="#32768"||MenuAutomation.At(x,y)};
            pressed[button] = target;
            // Popup menus belong to the existing foreground owner. Activating
            // the popup itself dismisses Windows' menu loop before the click.
            if(!target.Menu&&targetClass.ToString()!="#32768")SetForegroundWindow(target.Root);
        } else {
            if (!pressed.Remove(button, out target)) return;
        }
        if(button==0&&target.Menu){
            if(!down)try{
                if(MenuAutomation.At(x,y,invoke:true))return;
                // System menu loops consult the physical cursor, so posted
                // clicks cannot reliably invoke their items. MSAA invokes the
                // item at the remote point without moving that cursor.
                if(AccessibleObjectFromPoint(new POINT{X=x,Y=y},out var accessible,out var child)==0){try{if(Convert.ToInt32(((dynamic)accessible).get_accRole(child))==12){((dynamic)accessible).accDoDefaultAction(child);return;}}finally{if(Marshal.IsComObject(accessible))Marshal.ReleaseComObject(accessible);}}
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
            var style = GetWindowLong(target.Window, -16) & 0xf;
            // Group frames are also class Button; they are never actionable.
            if (style == 7 || !IsWindowEnabled(target.Window) || !IsWindowEnabled(target.Root)) return;
            PostMessage(target.Window, 0xF3, down ? (IntPtr)1 : IntPtr.Zero, IntPtr.Zero);
            if (!down && At(x, y)?.Window == target.Window) {
                // Push buttons notify their immediate parent with BN_CLICKED.
                // BM_CLICK synthesizes mouse messages and can fail in inactive
                // property-sheet pages (including shield/Advanced Sharing
                // buttons). Deliver the same command, once, without consulting
                // or moving the host cursor. Stateful check/radio buttons still
                // use their native procedure so their state changes normally.
                if (style is 0 or 1 or 11 or 12 or 13 or 14 or 15) {
                    var parent = GetParent(target.Window);
                    if (parent != IntPtr.Zero && IsWindowEnabled(parent)) PostMessage(parent, 0x111, (IntPtr)(GetDlgCtrlID(target.Window) & 0xffff), target.Window);
                } else PostMessage(target.Window, 0xF5, IntPtr.Zero, IntPtr.Zero);
            }
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
    public void Release() {
        // A disconnect/capture loss cancels an unfinished synthetic click; it
        // must not invoke the button or menu merely to clear its pressed state.
        var pending=pressed.ToArray();pressed.Clear();
        foreach(var pair in pending){var target=pair.Value;if(target.NativeButton)PostMessage(target.Window,0xF3,IntPtr.Zero,IntPtr.Zero);else if(!target.Menu&&target.Hit==1){PostMessage(target.Window,0x1F,IntPtr.Zero,IntPtr.Zero);PostMessage(target.Window,pair.Key==0?0x202u:pair.Key==2?0x205u:0x208u,IntPtr.Zero,Coordinates(-32768,-32768));}}
    }

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
        try{uint command=TrackPopupMenuEx(menu,0x100,150,150,host,IntPtr.Zero);bool ok=command==102&&Native.CursorMoveCount==originalMoves&&MenuAutomation.Actions>0;Console.WriteLine(JsonSerializer.Serialize(new{ok,command,automationActions=MenuAutomation.Actions,cursorMovedByHelper=Native.CursorMoveCount!=originalMoves}));return ok?0:1;}
        finally{DestroyMenu(menu);DestroyWindow(host);UnregisterClass(name,wc.Instance);GC.KeepAlive(procedure);}
    }

    public static int SharedSelfTest(){
        int down=0,up=0,moves=0;bool dragging=false;POINT final=default;
        WindowProc procedure=(w,m,wp,lp)=>{
            if(m==0x201){down++;dragging=true;SetCapture(w);}
            if(m==0x200&&dragging){moves++;GetCursorPos(out final);}
            if(m==0x202&&dragging){up++;dragging=false;ReleaseCapture();}
            return DefWindowProc(w,m,wp,lp);
        };
        string name="ShatootSharedTest"+Environment.ProcessId;var wc=new WNDCLASS{ClassName=name,Procedure=procedure,Instance=GetModuleHandle(null)};RegisterClass(ref wc);
        var host=CreateWindowEx(0,name,"Shared input regression",0x80CF0000,80,80,440,300,IntPtr.Zero,IntPtr.Zero,wc.Instance,IntPtr.Zero);
        var edit=CreateWindowEx(0,"EDIT","Select this text using a real drag",0x50810080,20,150,330,40,host,(IntPtr)20,wc.Instance,IntPtr.Zero);
        GetCursorPos(out var original);
        using var monitor=new HostActivity();
        using var worker=new System.Diagnostics.Process{StartInfo=new System.Diagnostics.ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=false,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,CreateNoWindow=true}};
        var output=new System.Collections.Concurrent.ConcurrentQueue<string>();var errors=new System.Collections.Concurrent.ConcurrentQueue<string>();worker.OutputDataReceived+=(_,e)=>{if(e.Data!=null)output.Enqueue(e.Data);};worker.ErrorDataReceived+=(_,e)=>{if(e.Data!=null)errors.Enqueue(e.Data);};
        void Pump(int ms=150){long end=Environment.TickCount64+ms;while(Environment.TickCount64<end){while(PeekMessage(out var msg,IntPtr.Zero,0,0,1)){TranslateMessage(ref msg);DispatchMessage(ref msg);}Thread.Sleep(2);}}
        void Send(object packet){worker.StandardInput.WriteLine(JsonSerializer.Serialize(packet));worker.StandardInput.Flush();}
        void Click(POINT point,bool pressed)=>Send(new{type="button",button=0,down=pressed,x=0.0,y=0.0});
        void Bounds(POINT point)=>Send(new{type="bounds",x=point.X,y=point.Y,width=1,height=1,sharedCursor=true});
        try{
            ShowWindow(host,5);SetWindowPos(host,(IntPtr)(-1),0,0,0,0,0x0053);SetForegroundWindow(host);Pump();
            worker.Start();worker.BeginOutputReadLine();worker.BeginErrorReadLine();
            long deadline=Environment.TickCount64+5000;while(!output.Any(s=>s.Contains("input-ready"))&&Environment.TickCount64<deadline)Pump(20);
            if(!output.Any(s=>s.Contains("input-ready")))throw new InvalidOperationException("Native input worker did not become ready.");
            var start=new POINT{X=30,Y=40};ClientToScreen(host,ref start);var end=new POINT{X=300,Y=110};ClientToScreen(host,ref end);
            SetForegroundWindow(host);Pump();
            if(GetAncestor(WindowFromPoint(start),2)!=host)throw new InvalidOperationException("Shared input fixture is obscured; no input was sent.");
            // Bounds span the drag, with the final point outside the start area.
            Send(new{type="bounds",x=start.X,y=start.Y,width=end.X-start.X+1,height=end.Y-start.Y+1,sharedCursor=true});
            Send(new{type="button",button=0,down=true,x=0.0,y=0.0});Pump();Send(new{type="move",x=1.0,y=1.0});Pump();Send(new{type="button",button=0,down=false,x=1.0,y=1.0});Pump();
            bool drag=down==1&&up==1&&moves>0&&Math.Abs(final.X-end.X)<=2&&Math.Abs(final.Y-end.Y)<=2;
            var textStart=new POINT{X=5,Y=12};ClientToScreen(edit,ref textStart);
            Send(new{type="bounds",x=textStart.X,y=textStart.Y,width=180,height=1,sharedCursor=true});Send(new{type="button",button=0,down=true,x=0.0,y=0.0});Pump();Send(new{type="move",x=1.0,y=0.0});Pump();Send(new{type="button",button=0,down=false,x=1.0,y=0.0});Pump();
            SendMessageTimeout(edit,0xB0,IntPtr.Zero,IntPtr.Zero,2,100,out var selection);bool textSelected=((selection.ToInt64()>>16)&0xffff)>(selection.ToInt64()&0xffff);
            GetWindowRect(host,out var before);var edge=new POINT{X=before.Right-2,Y=before.Top+100};
            Send(new{type="bounds",x=edge.X,y=edge.Y,width=42,height=1,sharedCursor=true});Send(new{type="button",button=0,down=true,x=0.0,y=0.0});Send(new{type="move",x=1.0,y=0.0});Send(new{type="button",button=0,down=false,x=1.0,y=0.0});Pump(350);
            GetWindowRect(host,out var after);bool resized=after.Right>before.Right+20;
            // EOF during a press must synthesize its release before exit.
            Bounds(start);Click(start,true);Pump();worker.StandardInput.Close();deadline=Environment.TickCount64+4000;while(!worker.HasExited&&Environment.TickCount64<deadline)Pump(20);Pump();
            bool released=down==2&&up==2&&!dragging;
            bool classification=HostActivity.PhysicalMouse(0)&&!HostActivity.PhysicalMouse(1)&&HostActivity.PhysicalKey(0)&&!HostActivity.PhysicalKey(0x10);
            bool quiet=!monitor.Paused&&!output.Any(s=>s.Contains("host-activity"));
            bool ok=drag&&textSelected&&resized&&released&&quiet&&classification&&worker.HasExited&&worker.ExitCode==0;
            Console.WriteLine(JsonSerializer.Serialize(new{ok,drag,textSelected,resized,released,physicalHooks=monitor.Ready,injectedInputIgnored=quiet,classification,down,up,moves,errors=errors.ToArray(),events=output.ToArray()}));return ok?0:1;
        }finally{if(!worker.HasExited){worker.StandardInput.Close();if(!worker.WaitForExit(1000))worker.Kill();}DestroyWindow(host);UnregisterClass(name,wc.Instance);if(!monitor.Paused)Native.Pointer(original.X,original.Y);GC.KeepAlive(procedure);}
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
            // Property pages put push buttons inside overlapping group boxes.
            // A hit on the group box must reach its sibling button, not BM_CLICK
            // the non-interactive frame (the Sharing page uses this layout).
            var page = CreateWindowEx(0x10000, "#32770", "Property page", 0x50000400, 5, 65, 280, 55, host, IntPtr.Zero, wc.Instance, IntPtr.Zero);
            var advanced = CreateWindowEx(0, "BUTTON", "Advanced Sharing...", 0x50010000, 20, 22, 160, 24, page, (IntPtr)100, wc.Instance, IntPtr.Zero);
            SendMessageTimeout(advanced, 0x160C, IntPtr.Zero, (IntPtr)1, 2, 100, out _);
            var group = CreateWindowEx(0, "BUTTON", "Advanced Sharing", 0x50000007, 5, 2, 260, 50, page, IntPtr.Zero, wc.Instance, IntPtr.Zero);
            // Forward the child page's command to the fixture owner.
            SetWindowLongPtr(page, -4, Marshal.GetFunctionPointerForDelegate(procedure));
            SetWindowPos(group, IntPtr.Zero, 0, 0, 0, 0, 0x0013);
            Pump(); var advancedPoint = new POINT { X = 30, Y = 12 }; ClientToScreen(advanced, ref advancedPoint);
            var nested = new IndependentPointer(); bool nestedTarget = nested.At(advancedPoint.X, advancedPoint.Y)?.Window == advanced;
            nested.Button(0, true, advancedPoint.X, advancedPoint.Y); nested.Button(0, false, advancedPoint.X, advancedPoint.Y); Pump();
            int nestedClicks = clicks - normalClicks;
            nested.Button(0, true, advancedPoint.X, advancedPoint.Y); nested.Button(0, false, advancedPoint.X + 190, advancedPoint.Y); Pump();
            bool cancelledClick = clicks == normalClicks + nestedClicks;
            DestroyWindow(page);
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
            bool ok = normalClicks == 1 && nestedTarget && nestedClicks == 1 && cancelledClick && clicks == 3 && !movedByHelper;
            Console.WriteLine(JsonSerializer.Serialize(new { ok, clicks, normalClicks, nestedTarget, nestedClicks, cancelledClick, hitExpectedButton, clickedThroughOverlay = clicks - normalClicks - nestedClicks == 1, cursorMovedByHelper = movedByHelper, cursorUnchanged = stable }));
            return ok ? 0 : 1;
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
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr window);
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
    [DllImport("user32.dll")] static extern IntPtr SetCapture(IntPtr window);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
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
