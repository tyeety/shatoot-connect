using System.Diagnostics;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.AccessControl;

namespace ShatootConnect.Server;

static class Program {
    internal const string ServiceName = "ShatootConnectServer";
    internal static string InstallDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "ShatootConnect Server");
    internal static string DataDir => Environment.GetEnvironmentVariable("SHATOOTCONNECT_TEST_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ShatootConnect", "Server");
    internal static string ConfigFile => Path.Combine(DataDir, "server.config.json");
    internal static bool Admin => new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
    [STAThread] static void Main(string[] args) {
        if (args.Contains("--service")) { ServiceBase.Run(new BrokerService()); return; }
        ApplicationConfiguration.Initialize();
        if (args.Contains("--self-test")) {
            try { SelfTest.Run(); Environment.ExitCode = 0; } catch (Exception e) { File.WriteAllText(Path.Combine(AppContext.BaseDirectory, "manager-test-error.txt"), e.ToString()); Environment.ExitCode = 1; }
            return;
        }
        Application.Run(new ManagerForm());
    }
    internal static JsonObject LoadConfig() {
        if (File.Exists(ConfigFile)) return JsonNode.Parse(File.ReadAllText(ConfigFile))!.AsObject();
        var bundled = Path.Combine(AppContext.BaseDirectory, "server.config.json");
        return File.Exists(bundled) ? JsonNode.Parse(File.ReadAllText(bundled))!.AsObject() : new JsonObject {
            ["host"] = "127.0.0.1", ["port"] = 8787, ["publicUrl"] = "", ["language"] = "en", ["iceServers"] = new JsonArray(),
            ["tls"] = new JsonObject { ["enabled"] = false, ["certPath"] = "", ["keyPath"] = "" }, ["forceRelay"] = false
        };
    }
    internal static void ProtectData() {
        Directory.CreateDirectory(DataDir);
        var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] { WellKnownSidType.LocalSystemSid, WellKnownSidType.BuiltinAdministratorsSid, WellKnownSidType.LocalServiceSid }) {
            acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid, null), sid == WellKnownSidType.LocalServiceSid ? FileSystemRights.Modify : FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        }
        new DirectoryInfo(DataDir).SetAccessControl(acl);
    }
    internal static void SaveConfig(JsonObject config) {
        if (!Admin) throw new InvalidOperationException("Administrator access is required to save service configuration.");
        ProtectData();
        var text = config.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        if (File.Exists(ConfigFile)) File.Copy(ConfigFile, ConfigFile + ".backup", true);
        File.WriteAllText(ConfigFile + ".tmp", text); File.Move(ConfigFile + ".tmp", ConfigFile, true);
    }
    internal static string Run(string filename, params string[] arguments) {
        var info = new ProcessStartInfo(filename) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in arguments) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new Exception("Could not start management command.");
        var output = process.StandardOutput.ReadToEndAsync(); var error = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(30000)) { process.Kill(true); throw new System.TimeoutException("Management command timed out."); }
        var result = output.GetAwaiter().GetResult() + error.GetAwaiter().GetResult();
        if (process.ExitCode != 0) throw new InvalidOperationException(result.Trim()); return result;
    }
    internal static string Status() {
        using var svc = new ServiceController(ServiceName);
        try { return svc.Status.ToString(); } catch (InvalidOperationException) { return "Not installed"; }
    }
    internal static void Control(string action) {
        if (!Admin) throw new InvalidOperationException("Administrator access is required.");
        using var svc = new ServiceController(ServiceName);
        if (action is "stop" or "restart") {
            if (svc.Status != ServiceControllerStatus.Stopped) { svc.Stop(); svc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30)); }
        }
        if (action is "start" or "restart") {
            svc.Refresh(); if (svc.Status != ServiceControllerStatus.Running) { svc.Start(); svc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30)); }
        }
    }
    internal static void Install() {
        if (!Admin) throw new InvalidOperationException("Run Server Manager as administrator to install the service.");
        var source = Path.GetFullPath(AppContext.BaseDirectory).TrimEnd(Path.DirectorySeparatorChar);
        if (!File.Exists(Path.Combine(source, "node.exe"))) throw new Exception("Extract the complete server ZIP first. node.exe is missing.");
        if (Status() != "Not installed") throw new Exception("The service is already installed. Use Save & restart to apply configuration.");
        if (source.Equals(Path.GetFullPath(InstallDir), StringComparison.OrdinalIgnoreCase)) throw new Exception("Run installation from the extracted release folder.");
        Directory.CreateDirectory(InstallDir);
        foreach (var relative in new[] { "ShatootConnect.Server.exe", "node.exe", "Node-LICENSE.txt" }) File.Copy(Path.Combine(source, relative), Path.Combine(InstallDir, relative), true);
        foreach (var folder in new[] { "server", "shared", "node_modules" }) CopyFolder(Path.Combine(source, folder), Path.Combine(InstallDir, folder));
        ProtectData(); if (!File.Exists(ConfigFile)) SaveConfig(LoadConfig());
        Run("sc.exe", "create", ServiceName, "binPath=", $"\"{Path.Combine(InstallDir, "ShatootConnect.Server.exe")}\" --service", "start=", "delayed-auto", "obj=", "NT AUTHORITY\\LocalService", "DisplayName=", "ShatootConnect Connection Server");
        Run("sc.exe", "description", ServiceName, "ShatootConnect signaling server. Runs independently of interactive logon sessions.");
        Run("sc.exe", "failure", ServiceName, "reset=", "86400", "actions=", "restart/5000/restart/15000/restart/60000");
        Run("sc.exe", "failureflag", ServiceName, "1");
        Control("start");
    }
    static void CopyFolder(string source, string destination) {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        foreach (var folder in Directory.GetDirectories(source)) CopyFolder(folder, Path.Combine(destination, Path.GetFileName(folder)));
    }
}

sealed class BrokerService : ServiceBase {
    CancellationTokenSource? cancellation; Task? worker; Process? child; ChildJob? job;
    public BrokerService() { ServiceName = Program.ServiceName; CanStop = true; CanShutdown = true; AutoLog = false; }
    protected override void OnStart(string[] args) {
        job = new ChildJob(); cancellation = new CancellationTokenSource(); worker = Task.Run(() => Watch(cancellation.Token));
    }
    async Task Watch(CancellationToken token) {
        while (!token.IsCancellationRequested) {
            try {
                var info = new ProcessStartInfo(Path.Combine(AppContext.BaseDirectory, "node.exe")) {
                    WorkingDirectory = Program.DataDir, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
                };
                info.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "server", "standalone.cjs")); info.ArgumentList.Add(Program.ConfigFile);
                foreach (var name in new[] { "PORT", "HOST", "SHATOOTCONNECT_ICE_SERVERS" }) info.Environment.Remove(name);
                child = new Process { StartInfo = info };
                child.OutputDataReceived += (_, e) => Log(e.Data); child.ErrorDataReceived += (_, e) => Log(e.Data);
                child.Start(); job!.Add(child); child.BeginOutputReadLine(); child.BeginErrorReadLine();
                await child.WaitForExitAsync(token); Log($"Broker exited ({child.ExitCode}); restarting in 5 seconds.");
            } catch (OperationCanceledException) { break; } catch (Exception e) { Log(e.Message); }
            finally { StopChild(); }
            try { await Task.Delay(5000, token); } catch (OperationCanceledException) { break; }
        }
    }
    static readonly object logLock = new();
    static void Log(string? text) {
        if (text is null) return;
        lock (logLock) {
            try {
                Directory.CreateDirectory(Program.DataDir); var file = Path.Combine(Program.DataDir, "service.log");
                if (File.Exists(file) && new FileInfo(file).Length > 5_000_000) File.Move(file, file + ".1", true);
                File.AppendAllText(file, $"{DateTimeOffset.UtcNow:O} {text}{Environment.NewLine}");
            } catch { }
        }
    }
    void StopChild() { try { if (child is { HasExited: false }) child.Kill(true); child?.Dispose(); } catch { } child = null; }
    protected override void OnStop() { cancellation?.Cancel(); StopChild(); try { worker?.Wait(TimeSpan.FromSeconds(15)); } catch { } job?.Dispose(); cancellation?.Dispose(); }
    protected override void OnShutdown() => OnStop();
}
