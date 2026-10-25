using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

static class Wallpaper {
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool SystemParametersInfo(uint action,uint length,StringBuilder value,uint flags);
    [DllImport("user32.dll")] static extern uint GetSysColor(int index);
    public static void Write() {
        var file=new StringBuilder(32768);
        if(!SystemParametersInfo(0x0073,(uint)file.Capacity,file,0))throw new IOException("Windows wallpaper could not be read.");
        Console.WriteLine(JsonSerializer.Serialize(new {path=file.ToString(),color=GetSysColor(1)}));
    }
}
