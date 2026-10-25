using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

// The process only serves the local main process over inherited pipes.
static class ClipboardBridge {
    [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern bool EmptyClipboard();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr size);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr data);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr data);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr data);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr data);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern uint DragQueryFile(IntPtr drop, uint index, StringBuilder? name, uint count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    static void Put(uint format, byte[] bytes) {
        var memory = GlobalAlloc(0x42, (UIntPtr)bytes.Length);
        if (memory == IntPtr.Zero) throw new IOException("Clipboard allocation failed.");
        var data = GlobalLock(memory);
        if (data == IntPtr.Zero) { GlobalFree(memory); throw new IOException("Clipboard lock failed."); }
        Marshal.Copy(bytes, 0, data, bytes.Length); GlobalUnlock(memory);
        if (SetClipboardData(format, memory) == IntPtr.Zero) { GlobalFree(memory); throw new IOException("Clipboard write failed."); }
    }
    public static void Run() {
        var thread=new Thread(RunSta);thread.SetApartmentState(ApartmentState.STA);thread.Start();thread.Join();
    }
    static void RunSta() {
        VirtualClipboard.Initialize();
        var commands=new System.Collections.Concurrent.ConcurrentQueue<string>();bool ended=false;
        var reader=new Thread(()=>{string? line;while((line=Console.ReadLine())!=null){if(VirtualClipboard.Complete(line))continue;commands.Enqueue(line);}ended=true;VirtualClipboard.Cancel();});reader.IsBackground=true;reader.Start();
        var owner = CreateWindowEx(0, "STATIC", "Shatoot clipboard", 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        try {
            while (!ended) {
                VirtualClipboard.Pump();
                if(!commands.TryDequeue(out var line)){Thread.Sleep(5);continue;}
                if (line.Length > 2200000) continue;
                string id = ""; bool opened = false;
                try {
                    using var doc = JsonDocument.Parse(line); var m = doc.RootElement; id = m.GetProperty("id").GetString() ?? "";
                    if(m.GetProperty("op").GetString()=="offer"){
                        if(m.TryGetProperty("expectedSeq",out var offerSeq)&&offerSeq.ValueKind==JsonValueKind.Number&&offerSeq.GetUInt32()!=GetClipboardSequenceNumber()){Console.WriteLine(JsonSerializer.Serialize(new{id,seq=GetClipboardSequenceNumber(),skipped=true}));continue;}
                        VirtualClipboard.Offer(m);Console.WriteLine(JsonSerializer.Serialize(new{id,seq=GetClipboardSequenceNumber()}));continue;
                    }
                    for (int i = 0; i < 20 && !(opened = OpenClipboard(owner)); i++) Thread.Sleep(10);
                    if (!opened) throw new IOException("Clipboard is busy.");
                    string op = m.GetProperty("op").GetString() ?? "";
                    if (op == "write") {
                        if(m.TryGetProperty("expectedSeq",out var expected)&&expected.ValueKind==JsonValueKind.Number&&expected.GetUInt32()!=GetClipboardSequenceNumber()){Console.WriteLine(JsonSerializer.Serialize(new{id,seq=GetClipboardSequenceNumber(),skipped=true}));continue;}
                        byte[] bytes; uint format;
                        if (m.TryGetProperty("files", out var paths)) {
                            var files = paths.EnumerateArray().Select(p => p.GetString() ?? "").ToArray();
                            if (files.Length == 0 || files.Length > 1000 || files.Any(p => !Path.IsPathFullyQualified(p) || p.Contains('\0'))) throw new IOException("Invalid clipboard files.");
                            var names = Encoding.Unicode.GetBytes(string.Join('\0', files) + "\0\0");
                            bytes = new byte[20 + names.Length]; BitConverter.GetBytes(20).CopyTo(bytes, 0); BitConverter.GetBytes(1).CopyTo(bytes, 16); names.CopyTo(bytes, 20); format = 15;
                        } else { var text = m.GetProperty("text").GetString() ?? ""; if (text.Length > 1000000) throw new IOException("Clipboard text is too large."); bytes = Encoding.Unicode.GetBytes(text + '\0'); format = 13; }
                        if (!EmptyClipboard()) throw new IOException("Clipboard clear failed."); Put(format, bytes);
                        CloseClipboard(); opened = false;
                        Console.WriteLine(JsonSerializer.Serialize(new { id, seq = GetClipboardSequenceNumber() }));
                    } else if (op == "read") {
                        var files = new List<string>(); var drop = GetClipboardData(15);
                        if (drop != IntPtr.Zero) {
                            uint count = DragQueryFile(drop, uint.MaxValue, null, 0); if (count > 1000) throw new IOException("Too many clipboard files.");
                            for (uint i = 0; i < count; i++) { var name = new StringBuilder(32768); DragQueryFile(drop, i, name, 32768); files.Add(name.ToString()); }
                        }
                        string text = ""; var handle = GetClipboardData(13);
                        if (files.Count == 0 && handle != IntPtr.Zero && GlobalSize(handle).ToUInt64() <= 2000002) { var data = GlobalLock(handle); if (data != IntPtr.Zero) { try { text = Marshal.PtrToStringUni(data) ?? ""; } finally { GlobalUnlock(handle); } } }
                        Console.WriteLine(JsonSerializer.Serialize(new { id, seq = GetClipboardSequenceNumber(), text, files, remote=VirtualClipboard.IsCurrent,supported = VirtualClipboard.IsCurrent || files.Count > 0 || (handle != IntPtr.Zero && GlobalSize(handle).ToUInt64() <= 2000002) }));
                    } else throw new IOException("Invalid clipboard operation.");
                } catch (Exception e) { Console.WriteLine(JsonSerializer.Serialize(new { id, error = e.Message })); }
                finally { if (opened) CloseClipboard(); }
            }
        } finally { VirtualClipboard.Shutdown();if (owner != IntPtr.Zero) DestroyWindow(owner); }
    }
}
