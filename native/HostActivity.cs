using System.Runtime.InteropServices;

// Observe physical input without blocking it. Hook callbacks only update state;
// the input worker performs release/IPC away from the hook's dedicated thread.
sealed class HostActivity : IDisposable {
    delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint Key,Scan,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr Window; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public int X,Y; public uint Private; }
    readonly Thread thread; readonly ManualResetEventSlim ready=new(false); readonly object gate=new();
    readonly HashSet<uint> keys=new(); readonly HashSet<int> buttons=new();
    long last; int ended;
    int pointerX,pointerY; long pointerRevision;
    public (int X,int Y,long Revision) Pointer { get {lock(gate)return (pointerX,pointerY,pointerRevision);} }
    public bool Ready { get; private set; }
    public bool Paused=>Environment.TickCount64-Interlocked.Read(ref last)<2000||Held;
    bool Held { get {lock(gate){if(Environment.TickCount64-Interlocked.Read(ref last)>100){keys.RemoveWhere(key=>GetAsyncKeyState((int)key)>=0);buttons.RemoveWhere(button=>GetAsyncKeyState(button==0?1:button==2?2:4)>=0);}return keys.Count+buttons.Count>0;}} }
    public bool KeyHeld(uint key){lock(gate)return keys.Contains(key);}
    public bool ButtonHeld(int button){lock(gate)return buttons.Contains(button);}
    public static bool PhysicalMouse(uint flags)=>(flags&1)==0;
    public static bool PhysicalKey(uint flags)=>(flags&0x10)==0;
    public HostActivity(){last=Environment.TickCount64-3000;thread=new Thread(Run){IsBackground=true,Name="Physical host input"};thread.Start();ready.Wait(3000);}
    void Run(){
        Hook mouse=(code,message,data)=>{
            if(code>=0){var value=Marshal.PtrToStructure<MouseData>(data);if(PhysicalMouse(value.Flags)){
                int id=message.ToInt32();lock(gate){pointerX=value.X;pointerY=value.Y;pointerRevision++;int button=id is 0x201 or 0x202?0:id is 0x204 or 0x205?2:id is 0x207 or 0x208?1:-1;if(button>=0){if(id is 0x201 or 0x204 or 0x207)buttons.Add(button);else buttons.Remove(button);}}
                Interlocked.Exchange(ref last,Environment.TickCount64);
            }}return CallNextHookEx(IntPtr.Zero,code,message,data);
        };
        Hook keyboard=(code,message,data)=>{
            if(code>=0){var value=Marshal.PtrToStructure<KeyData>(data);if(PhysicalKey(value.Flags)){lock(gate){if((value.Flags&0x80)==0)keys.Add(value.Key);else keys.Remove(value.Key);}Interlocked.Exchange(ref last,Environment.TickCount64);}}
            return CallNextHookEx(IntPtr.Zero,code,message,data);
        };
        var mouseHook=SetWindowsHookEx(14,mouse,GetModuleHandle(null),0);var keyHook=SetWindowsHookEx(13,keyboard,GetModuleHandle(null),0);
        lock(gate){for(uint key=8;key<255;key++)if(key is not (0x10 or 0x11 or 0x12)&&GetAsyncKeyState((int)key)<0)keys.Add(key);if(GetAsyncKeyState(1)<0)buttons.Add(0);if(GetAsyncKeyState(2)<0)buttons.Add(2);if(GetAsyncKeyState(4)<0)buttons.Add(1);}
        Ready=mouseHook!=IntPtr.Zero&&keyHook!=IntPtr.Zero;ready.Set();
        try{while(Volatile.Read(ref ended)==0){while(PeekMessage(out var msg,IntPtr.Zero,0,0,1)){TranslateMessage(ref msg);DispatchMessage(ref msg);}Thread.Sleep(2);}}
        finally{if(mouseHook!=IntPtr.Zero)UnhookWindowsHookEx(mouseHook);if(keyHook!=IntPtr.Zero)UnhookWindowsHookEx(keyHook);GC.KeepAlive(mouse);GC.KeepAlive(keyboard);}
    }
    public void Dispose(){Volatile.Write(ref ended,1);thread.Join(3000);}
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id,Hook callback,IntPtr instance,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG message,IntPtr window,uint min,uint max,uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string? name);
}
