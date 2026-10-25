using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Text.Json;

// OLE advertises names and sizes immediately. FileContents is rendered only when
// a consumer pastes. Explorer writes the resulting streams to its chosen folder.
static class VirtualClipboard {
    static readonly object gate=new();
    static readonly Dictionary<string,TaskCompletionSource<JsonElement>> pending=new();
    static DataObject? current;
    static short descriptors,contents,effect;
    static Func<string,int,string>? testRender;
    public static void Initialize(){Marshal.ThrowExceptionForHR(OleInitialize(IntPtr.Zero));descriptors=(short)RegisterClipboardFormat("FileGroupDescriptorW");contents=(short)RegisterClipboardFormat("FileContents");effect=(short)RegisterClipboardFormat("Preferred DropEffect");}
    public static void Cancel(){lock(gate)foreach(var item in pending.Values)item.TrySetException(new IOException("Session ended."));}
    public static void Shutdown(){if(current!=null&&OleIsCurrentClipboard(current)==0)OleSetClipboard(null);OleUninitialize();}
    public static void Pump(){while(PeekMessage(out var msg,IntPtr.Zero,0,0,1)){TranslateMessage(ref msg);DispatchMessage(ref msg);}}
    public static bool Complete(string line){try{using var doc=JsonDocument.Parse(line);var root=doc.RootElement;if(root.GetProperty("op").GetString()!="materialized")return false;lock(gate)if(pending.TryGetValue(root.GetProperty("token").GetString()!,out var result))result.TrySetResult(root.Clone());return true;}catch{return false;}}
    public static bool IsCurrent=>current!=null&&OleIsCurrentClipboard(current)==0;
    public static void Offer(JsonElement root){lock(gate){foreach(var key in pending.Where(p=>p.Value.Task.IsCompleted).Select(p=>p.Key).ToArray())pending.Remove(key);}var token=root.GetProperty("token").GetString()!;var entries=root.GetProperty("entries").EnumerateArray().Select(e=>(name:e.GetProperty("name").GetString()!,size:e.GetProperty("size").GetInt64(),directory:e.TryGetProperty("directory",out var d)&&d.ValueKind==JsonValueKind.True)).ToArray();if(entries.Length is <1 or >1000||entries.Any(e=>e.name.Length>259||e.size<0||e.name.Split('/').Any(p=>p is "" or "." or ".."||p.IndexOfAny(['\\',':','\0'])>=0)))throw new IOException("Invalid clipboard offer.");var next=new DataObject(token,entries);Marshal.ThrowExceptionForHR(OleSetClipboard(next));current=next;}
    static string Materialize(string token,int index){
        if(testRender!=null)return testRender(token,index);
        TaskCompletionSource<JsonElement> result;bool request=false;
        lock(gate){if(!pending.TryGetValue(token,out result!)){result=new(TaskCreationOptions.RunContinuationsAsynchronously);pending[token]=result;request=true;}}
        if(request)Console.WriteLine(JsonSerializer.Serialize(new{type="clipboard-fetch",token}));
        var end=Environment.TickCount64+600000;
        while(!result.Task.IsCompleted){if(Environment.TickCount64>end)throw new IOException("Clipboard transfer timed out.");Pump();Thread.Sleep(5);}
        var value=result.Task.GetAwaiter().GetResult();if(value.TryGetProperty("error",out var error))throw new IOException(error.GetString());var files=value.GetProperty("files");if(index>=files.GetArrayLength())throw new IOException("Missing clipboard file.");var file=files[index].GetString()!;if(!Path.IsPathFullyQualified(file)||!File.Exists(file))throw new IOException("Clipboard file is unavailable.");return file;
    }
    public static int SelfTest(string file){
        int result=1;var thread=new Thread(()=>{Initialize();try{
            int requests=0;var bytes=File.ReadAllBytes(file);testRender=(_,_)=>{requests++;return file;};
            var value=new DataObject("isolated",[(Path.GetFileName(file),bytes.LongLength,false)]);
            // The CCW path is what an external Explorer consumer actually uses.
            var unknown=Marshal.GetIUnknownForObject(value);var data=(System.Runtime.InteropServices.ComTypes.IDataObject)Marshal.GetObjectForIUnknown(unknown);Marshal.Release(unknown);
            var f=new FORMATETC{cfFormat=descriptors,dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=-1,tymed=TYMED.TYMED_HGLOBAL};data.GetData(ref f,out var names);
            var ptr=GlobalLock(names.unionmember);bool descriptor=Marshal.ReadInt32(ptr)==1&&Marshal.PtrToStringUni(ptr+76)==Path.GetFileName(file);GlobalUnlock(names.unionmember);ReleaseStgMedium(ref names);bool deferred=requests==0;
            f=new(){cfFormat=contents,dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=0,tymed=TYMED.TYMED_ISTREAM};data.GetData(ref f,out var medium);var stream=(IStream)Marshal.GetObjectForIUnknown(medium.unionmember);var actual=new byte[bytes.Length];stream.Read(actual,actual.Length,IntPtr.Zero);Marshal.ReleaseComObject(stream);ReleaseStgMedium(ref medium);
            bool ok=descriptor&&deferred&&requests==1&&actual.SequenceEqual(bytes);Console.WriteLine(JsonSerializer.Serialize(new{ok,descriptor,deferred,requests,clipboardUntouched=true}));result=ok?0:1;
        }finally{testRender=null;Shutdown();}});thread.SetApartmentState(ApartmentState.STA);thread.Start();thread.Join();return result;
    }
    static STGMEDIUM Memory(byte[] bytes){var handle=GlobalAlloc(0x42,(UIntPtr)bytes.Length);if(handle==IntPtr.Zero)throw new OutOfMemoryException();var ptr=GlobalLock(handle);if(ptr==IntPtr.Zero){GlobalFree(handle);throw new IOException("Clipboard allocation failed.");}Marshal.Copy(bytes,0,ptr,bytes.Length);GlobalUnlock(handle);return new(){tymed=TYMED.TYMED_HGLOBAL,unionmember=handle};}
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
    sealed class DataObject(string token,(string name,long size,bool directory)[] entries):System.Runtime.InteropServices.ComTypes.IDataObject {
        public void GetData(ref FORMATETC format,out STGMEDIUM medium){
            Marshal.ThrowExceptionForHR(QueryGetData(ref format));
            if(format.cfFormat==descriptors){var bytes=new byte[4+592*entries.Length];BitConverter.GetBytes(entries.Length).CopyTo(bytes,0);for(int i=0;i<entries.Length;i++){var e=entries[i];int at=4+i*592;BitConverter.GetBytes(0x80000044u).CopyTo(bytes,at);BitConverter.GetBytes(e.directory?0x10u:0x80u).CopyTo(bytes,at+36);BitConverter.GetBytes((uint)(e.size>>32)).CopyTo(bytes,at+64);BitConverter.GetBytes((uint)e.size).CopyTo(bytes,at+68);Encoding.Unicode.GetBytes(e.name.Replace('/','\\')+'\0').CopyTo(bytes,at+72);}medium=Memory(bytes);}
            else if(format.cfFormat==effect)medium=Memory(BitConverter.GetBytes(1));
            else {if(format.lindex<0||format.lindex>=entries.Length)throw new COMException("Invalid clipboard index",unchecked((int)0x80040068));if(entries[format.lindex].directory){Marshal.ThrowExceptionForHR(CreateStreamOnHGlobal(IntPtr.Zero,true,out var empty));medium=new(){tymed=TYMED.TYMED_ISTREAM,unionmember=empty};return;}var file=Materialize(token,format.lindex);Marshal.ThrowExceptionForHR(SHCreateStreamOnFileEx(file,0x40,0,false,IntPtr.Zero,out var stream));medium=new(){tymed=TYMED.TYMED_ISTREAM,unionmember=stream};}
        }
        public int QueryGetData(ref FORMATETC f){if(f.dwAspect!=DVASPECT.DVASPECT_CONTENT)return unchecked((int)0x8004006b);if((f.cfFormat==descriptors||f.cfFormat==effect)&&(f.tymed&TYMED.TYMED_HGLOBAL)!=0)return 0;if(f.cfFormat==contents&&(f.tymed&TYMED.TYMED_ISTREAM)!=0&&f.lindex>=-1&&f.lindex<entries.Length)return 0;return unchecked((int)0x80040064);}
        public IEnumFORMATETC EnumFormatEtc(DATADIR direction){if(direction!=DATADIR.DATADIR_GET)throw new COMException("Read only",unchecked((int)0x80004001));return new Formats([new(){cfFormat=descriptors,dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=-1,tymed=TYMED.TYMED_HGLOBAL},new(){cfFormat=contents,dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=-1,tymed=TYMED.TYMED_ISTREAM},new(){cfFormat=effect,dwAspect=DVASPECT.DVASPECT_CONTENT,lindex=-1,tymed=TYMED.TYMED_HGLOBAL}]);}
        public void GetDataHere(ref FORMATETC f,ref STGMEDIUM m)=>throw new COMException("Unsupported",unchecked((int)0x80004001));
        public int GetCanonicalFormatEtc(ref FORMATETC input,out FORMATETC output){output=input;output.ptd=IntPtr.Zero;return 0x40130;}
        public void SetData(ref FORMATETC f,ref STGMEDIUM m,bool release)=>throw new COMException("Read only",unchecked((int)0x80004001));
        public int DAdvise(ref FORMATETC f,ADVF flags,IAdviseSink sink,out int connection){connection=0;return unchecked((int)0x80040003);}
        public void DUnadvise(int connection){}public int EnumDAdvise(out IEnumSTATDATA enumerator){enumerator=null!;return unchecked((int)0x80040003);}
    }
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
    sealed class Formats(FORMATETC[] values):IEnumFORMATETC {
        int index;
        public int Next(int count,FORMATETC[] items,int[]? fetched){int n=0;while(n<count&&index<values.Length)items[n++]=values[index++];if(fetched?.Length>0)fetched[0]=n;return n==count?0:1;}
        public int Skip(int count){int before=index;index=Math.Min(values.Length,index+count);return index-before==count?0:1;}
        public int Reset(){index=0;return 0;}public void Clone(out IEnumFORMATETC copy){copy=new Formats(values){index=index};}
    }
    [StructLayout(LayoutKind.Sequential)]struct MSG{public IntPtr hwnd;public uint message;public UIntPtr wp;public IntPtr lp;public uint time;public int x,y;public uint extra;}
    [DllImport("ole32.dll")]static extern int OleInitialize(IntPtr reserved);
    [DllImport("ole32.dll")]static extern void OleUninitialize();
    [DllImport("ole32.dll")]static extern int OleSetClipboard([MarshalAs(UnmanagedType.Interface)]System.Runtime.InteropServices.ComTypes.IDataObject? data);
    [DllImport("ole32.dll")]static extern int OleIsCurrentClipboard([MarshalAs(UnmanagedType.Interface)]System.Runtime.InteropServices.ComTypes.IDataObject data);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern uint RegisterClipboardFormat(string format);
    [DllImport("user32.dll")]static extern bool PeekMessage(out MSG msg,IntPtr window,uint min,uint max,uint remove);
    [DllImport("user32.dll")]static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")]static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("kernel32.dll")]static extern IntPtr GlobalAlloc(uint flags,UIntPtr size);
    [DllImport("kernel32.dll")]static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll")]static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll")]static extern IntPtr GlobalFree(IntPtr handle);
    [DllImport("shlwapi.dll",CharSet=CharSet.Unicode)]static extern int SHCreateStreamOnFileEx(string file,uint mode,uint attributes,bool create,IntPtr template,out IntPtr stream);
    [DllImport("ole32.dll")]static extern int CreateStreamOnHGlobal(IntPtr memory,bool deleteOnRelease,out IntPtr stream);
    [DllImport("ole32.dll")]static extern void ReleaseStgMedium(ref STGMEDIUM medium);
}
