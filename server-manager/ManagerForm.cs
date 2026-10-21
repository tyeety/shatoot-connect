using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.Json;
using System.Security.Cryptography.X509Certificates;

namespace ShatootConnect.Server;

sealed class ManagerForm : Form {
    static readonly System.Drawing.Text.PrivateFontCollection persianFonts = LoadPersianFont();
    static System.Runtime.InteropServices.GCHandle fontMemory;
    [System.Runtime.InteropServices.DllImport("gdi32.dll")] static extern IntPtr AddFontMemResourceEx(IntPtr font, uint size, IntPtr reserved, ref uint count);
    static System.Drawing.Text.PrivateFontCollection LoadPersianFont() {
        using var resource = typeof(ManagerForm).Assembly.GetManifestResourceStream("ShatootConnect.Vazirmatn.ttf")!;
        using var buffer = new MemoryStream(); resource.CopyTo(buffer);
        var data = buffer.ToArray(); fontMemory = System.Runtime.InteropServices.GCHandle.Alloc(data, System.Runtime.InteropServices.GCHandleType.Pinned);
        uint count = 0;
        if (AddFontMemResourceEx(fontMemory.AddrOfPinnedObject(), (uint)data.Length, IntPtr.Zero, ref count) == IntPtr.Zero) throw new InvalidOperationException("Unable to load bundled Vazirmatn font.");
        var fonts = new System.Drawing.Text.PrivateFontCollection(); fonts.AddMemoryFont(fontMemory.AddrOfPinnedObject(), data.Length); return fonts;
    }
    bool fa; JsonObject configuration;
    readonly ComboBox language = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 120 };
    readonly Label serviceStatus = new() { AutoSize = true, Font = new Font("Segoe UI", 15, FontStyle.Bold) };
    readonly TextBox host = new(), publicUrl = new(), cert = new(), key = new(), turnUrls = new() { Multiline = true, Height = 60 }, turnUser = new(), turnPassword = new() { UseSystemPasswordChar = true }, turnSecret = new() { UseSystemPasswordChar = true };
    readonly NumericUpDown port = new() { Minimum = 1, Maximum = 65535, Value = 8787, Width = 130 };
    readonly CheckBox tls = new() { AutoSize = true }, forceRelay = new() { AutoSize = true };
    readonly CheckBox managedTurn = new() { AutoSize = true };
    readonly TextBox turnKeyId = new(), turnApiToken = new() { UseSystemPasswordChar = true };
    readonly TextBox enrollmentKey = new() { UseSystemPasswordChar = true };
    readonly TextBox output = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Font = new Font("Consolas", 10), BackColor = Color.FromArgb(16, 24, 36), ForeColor = Color.FromArgb(196, 226, 221) };
    readonly FlowLayoutPanel toolbar = new() { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(10) };
    readonly TabControl tabs = new() { Dock = DockStyle.Fill };
    readonly List<(Control control, string en, string fa)> translations = [];
    readonly System.Windows.Forms.Timer timer = new() { Interval = 3000 };
    string L(string en, string persian) => fa ? persian : en;
    public ManagerForm() {
        Text = "Shatoot Connect Server Manager"; Size = new Size(1020, 850); MinimumSize = new Size(860, 720); Font = new Font("Segoe UI", 10); StartPosition = FormStartPosition.CenterScreen;
        try { configuration = Program.LoadConfig(); } catch { configuration = new JsonObject(); }
        fa = configuration["language"]?.GetValue<string>() == "fa";
        try { fa = File.ReadAllText(UiPreference()) == "fa"; } catch { }
        if (Environment.GetCommandLineArgs().Contains("--self-test")) fa = false;
        language.Items.AddRange(["English", "فارسی"]); language.SelectedIndex = fa ? 1 : 0;
        toolbar.Controls.Add(serviceStatus); toolbar.Controls.Add(language);
        AddButton(toolbar, "Run as administrator", "اجرا با دسترسی مدیر", () => {
            Process.Start(new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = true, Verb = "runas", WorkingDirectory = AppContext.BaseDirectory }); Close();
        });
        AddButton(toolbar, "Install service", "نصب سرویس", async () => { await Save(false); await Task.Run(Program.Install); RefreshStatus(); });
        AddButton(toolbar, "Start", "شروع", async () => { await Task.Run(() => Program.Control("start")); RefreshStatus(); });
        AddButton(toolbar, "Stop", "توقف", async () => { await Task.Run(() => Program.Control("stop")); RefreshStatus(); });
        AddButton(toolbar, "Restart", "راه‌اندازی مجدد", async () => { await Task.Run(() => Program.Control("restart")); RefreshStatus(); });
        var configurationTab = Page("Configuration", "تنظیمات");
        var grid = new TableLayoutPanel { ColumnCount = 2, Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(12) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 225)); grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Row(grid, "Bind address", "آدرس شنود", host); Row(grid, "Signaling port", "پورت اتصال", port);
        Row(grid, "Public WSS address", "نشانی عمومی WSS", publicUrl);
        Row(grid, "Server connection key (auto-generated)", "کلید اتصال سرور (ساخت خودکار)", enrollmentKey);
        Row(grid, "Direct TLS (PEM files)", "TLS مستقیم (فایل PEM)", tls);
        Row(grid, "Certificate / full chain", "گواهی و زنجیره", Browse(cert)); Row(grid, "Private key", "کلید خصوصی", Browse(key));
        Row(grid, "Cloudflare Realtime TURN", "TURN مدیریت‌شده کلادفلر", managedTurn);
        Row(grid, "Cloudflare TURN key ID", "شناسهٔ کلید TURN کلادفلر", turnKeyId);
        Row(grid, "Cloudflare TURN API token", "توکن API کلید TURN کلادفلر", turnApiToken);
        Row(grid, "TURN / STUN URLs (one per line)", "نشانی‌های TURN/STUN (هر خط یکی)", turnUrls);
        Row(grid, "TURN username", "نام کاربری TURN", turnUser); Row(grid, "TURN password", "رمز TURN", turnPassword);
        Row(grid, "TURN REST shared secret (optional)", "کلید مشترک TURN REST (اختیاری)", turnSecret);
        Row(grid, "Force relay (network verification)", "اجبار مسیر TURN (تست شبکه)", forceRelay);
        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Bottom, Padding = new Padding(20, 5, 20, 10) };
        AddButton(actions, "Save configuration", "ذخیره تنظیمات", () => Save(false));
        AddButton(actions, "Save & restart", "ذخیره و راه‌اندازی مجدد", () => Save(true));
        AddButton(actions, "Export client connection file", "خروجی تنظیم اتصال کلاینت", ExportClient);
        var info = TextLabel("Install once as administrator. The service keeps running after log out. Direct connections use STUN; TURN is optional. Behind a CDN, use loopback binding and HTTPS/WSS at your proxy.",
            "یک بار با دسترسی مدیر نصب کنید؛ سرویس با خروج کاربر متوقف نمی‌شود. اتصال مستقیم از STUN استفاده می‌کند و TURN اختیاری است. پشت CDN از آدرس loopback و HTTPS/WSS در پراکسی استفاده کنید.");
        info.Dock = DockStyle.Top; info.Padding = new Padding(8); info.MaximumSize = new Size(920, 0); info.AutoSize = true;
        var body = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
        body.Controls.Add(grid); body.Controls.Add(info);
        configurationTab.Controls.Add(body); configurationTab.Controls.Add(actions);
        var diagnostics = Page("Diagnostics & logs", "بررسی اتصال و گزارش‌ها");
        var checks = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(10) };
        AddButton(checks, "Check local broker", "بررسی سرور داخلی", () => Check(false));
        AddButton(checks, "Check public WSS", "بررسی WSS عمومی", () => Check(true));
        AddButton(checks, "Read service log", "نمایش گزارش سرویس", () => {
            output.Text = File.Exists(Path.Combine(Program.DataDir, "service.log")) ? File.ReadAllText(Path.Combine(Program.DataDir, "service.log")) : L("No log file yet.", "هنوز گزارشی ثبت نشده است.");
            output.SelectionStart = output.TextLength; output.ScrollToCaret();
        });
        diagnostics.Controls.Add(output); diagnostics.Controls.Add(checks);
        Controls.Add(tabs); Controls.Add(toolbar);
        host.Text = configuration["host"]?.GetValue<string>() ?? "127.0.0.1";
        port.Value = Math.Clamp(configuration["port"]?.GetValue<int>() ?? 8787, 1, 65535);
        publicUrl.Text = configuration["publicUrl"]?.GetValue<string>() ?? "";
        enrollmentKey.Text = configuration["enrollmentKey"]?.GetValue<string>() ?? "";
        tls.Checked = configuration["tls"]?["enabled"]?.GetValue<bool>() == true;
        cert.Text = configuration["tls"]?["certPath"]?.GetValue<string>() ?? ""; key.Text = configuration["tls"]?["keyPath"]?.GetValue<string>() ?? "";
        var ice = configuration["iceServers"]?.AsArray().OfType<JsonObject>().FirstOrDefault();
        var urls = configuration["turnRest"]?["urls"] ?? ice?["urls"];
        turnUrls.Text = urls is JsonArray array ? string.Join(Environment.NewLine, array.Select(v => v!.GetValue<string>())) : urls?.GetValue<string>() ?? "stun:stun.cloudflare.com:3478";
        turnUser.Text = ice?["username"]?.GetValue<string>() ?? ""; turnPassword.Text = ice?["credential"]?.GetValue<string>() ?? "";
        turnSecret.Text = configuration["turnRest"]?["sharedSecret"]?.GetValue<string>() ?? "";
        forceRelay.Checked = configuration["forceRelay"]?.GetValue<bool>() == true;
        managedTurn.Checked = configuration["managedTurn"]?["enabled"]?.GetValue<bool>() == true;
        turnKeyId.Text = configuration["managedTurn"]?["keyId"]?.GetValue<string>() ?? "";
        turnApiToken.Text = configuration["managedTurn"]?["apiToken"]?.GetValue<string>() ?? "";
        language.SelectedIndexChanged += (_, _) => {
            fa = language.SelectedIndex == 1; Translate(); RefreshStatus();
            if (!Environment.GetCommandLineArgs().Contains("--self-test")) {
                try { Directory.CreateDirectory(Path.GetDirectoryName(UiPreference())!); File.WriteAllText(UiPreference(), fa ? "fa" : "en"); } catch { }
            }
        };
        timer.Tick += (_, _) => RefreshStatus(); timer.Start(); FormClosed += (_, _) => timer.Dispose();
        Translate(); RefreshStatus();
    }
    TabPage Page(string en, string persian) { var page = new TabPage(en) { AutoScroll = true }; translations.Add((page, en, persian)); tabs.TabPages.Add(page); return page; }
    Label TextLabel(string en, string persian) { var label = new Label { Text = en, AutoSize = true, Margin = new Padding(0, 9, 10, 10) }; translations.Add((label, en, persian)); return label; }
    void Row(TableLayoutPanel panel, string en, string persian, Control value) {
        int row = panel.RowCount++; panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var label = TextLabel(en, persian); label.Margin = new Padding(0, 4, 8, 4); panel.Controls.Add(label, 0, row); value.Dock = DockStyle.Top; value.Margin = new Padding(0, 2, 0, 4); panel.Controls.Add(value, 1, row);
    }
    Control Browse(TextBox text) {
        var panel = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, Dock = DockStyle.Top };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 52));
        text.Dock = DockStyle.Fill; var button = new Button { Text = "File", Dock = DockStyle.Fill }; translations.Add((button, "File", "فایل"));
        button.Click += (_, _) => { using var dialog = new OpenFileDialog { Filter = "PEM files|*.pem;*.crt;*.key|All files|*.*" }; if (dialog.ShowDialog(this) == DialogResult.OK) text.Text = dialog.FileName; };
        panel.Controls.Add(text, 0, 0); panel.Controls.Add(button, 1, 0); return panel;
    }
    void AddButton(Control parent, string en, string persian, Action action) => AddButton(parent, en, persian, () => { action(); return Task.CompletedTask; });
    void AddButton(Control parent, string en, string persian, Func<Task> action) {
        var button = new Button { Text = en, AutoSize = true, Height = 33, Padding = new Padding(6) }; translations.Add((button, en, persian));
        button.Click += async (_, _) => { button.Enabled = false; try { await action(); } catch (Exception e) { MessageBox.Show(this, e.Message, "ShatootConnect", MessageBoxButtons.OK, MessageBoxIcon.Error); } finally { button.Enabled = true; } };
        parent.Controls.Add(button);
    }
    void Translate() {
        foreach (var (control, en, persian) in translations) control.Text = L(en, persian);
        Font = fa ? new Font(persianFonts.Families[0], 10) : new Font("Segoe UI", 10);
        serviceStatus.Font = fa ? new Font(persianFonts.Families[0], 14, FontStyle.Bold) : new Font("Segoe UI", 15, FontStyle.Bold);
        output.Font = fa ? new Font(persianFonts.Families[0], 10) : new Font("Consolas", 10);
        RightToLeft = fa ? RightToLeft.Yes : RightToLeft.No; RightToLeftLayout = fa;
    }
    static string UiPreference() => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ShatootConnect", "ServerManager", "language.txt");
    internal void TestLanguage(bool persian) { language.SelectedIndex = persian ? 1 : 0; fa = persian; Translate(); RefreshStatus(); }
    void RefreshStatus() {
        var value = Program.Status(); serviceStatus.Text = L($"Service: {value}", $"سرویس: {value switch { "Running" => "فعال", "Stopped" => "متوقف", "Not installed" => "نصب نشده", _ => value }}");
        serviceStatus.ForeColor = value == "Running" ? Color.SeaGreen : Color.DarkOrange;
    }
    JsonObject Collect() {
        var result = (JsonObject)configuration.DeepClone();
        result["language"] = fa ? "fa" : "en"; result["host"] = host.Text.Trim(); result["port"] = (int)port.Value;
        if (!string.IsNullOrWhiteSpace(publicUrl.Text) && (!Uri.TryCreate(publicUrl.Text.Trim(), UriKind.Absolute, out var endpoint) || endpoint.Scheme != "wss" || !string.IsNullOrEmpty(endpoint.UserInfo))) throw new Exception(L("The public address must be a valid wss:// URL.", "نشانی عمومی باید یک آدرس معتبر wss:// باشد."));
        result["publicUrl"] = publicUrl.Text.Trim(); result["forceRelay"] = forceRelay.Checked;
        if (string.IsNullOrEmpty(enrollmentKey.Text)) enrollmentKey.Text = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        result["enrollmentKey"] = enrollmentKey.Text;
        result.Remove("managedTurn");
        if (managedTurn.Checked) {
            if (string.IsNullOrWhiteSpace(turnKeyId.Text) || turnApiToken.Text.Length < 20) throw new Exception(L("Enter the Cloudflare TURN key ID and its API token. Do not use your CDN DNS token.", "شناسه و توکن کلید TURN کلادفلر را وارد کنید؛ توکن DNS مربوط به CDN نیست."));
            result["managedTurn"] = new JsonObject { ["enabled"] = true, ["provider"] = "cloudflare", ["keyId"] = turnKeyId.Text.Trim(), ["apiToken"] = turnApiToken.Text.Trim() };
        }
        var urls = turnUrls.Lines.Select(v => v.Trim()).Where(v => v.Length > 0).ToArray();
        if (urls.Any(v => !(v.StartsWith("stun:") || v.StartsWith("turn:") || v.StartsWith("turns:")))) throw new Exception("Use stun:, turn: or turns: URLs.");
        if (urls.Any(v => v.StartsWith("turn")) && string.IsNullOrEmpty(turnSecret.Text) && (string.IsNullOrWhiteSpace(turnUser.Text) || string.IsNullOrEmpty(turnPassword.Text))) throw new Exception(L("TURN requires a username/password or a REST shared secret.", "TURN به نام کاربری و رمز یا کلید مشترک REST نیاز دارد."));
        result["iceServers"] = new JsonArray(); result.Remove("turnRest");
        if (urls.Length > 0) {
            var values = new JsonArray(urls.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());
            if (!string.IsNullOrEmpty(turnSecret.Text)) result["turnRest"] = new JsonObject { ["urls"] = new JsonArray(urls.Where(v => v.StartsWith("turn")).Select(v => (JsonNode?)JsonValue.Create(v)).ToArray()), ["sharedSecret"] = turnSecret.Text };
            else result["iceServers"] = new JsonArray(new JsonObject { ["urls"] = values, ["username"] = turnUser.Text, ["credential"] = turnPassword.Text });
        }
        var tlsConfig = new JsonObject { ["enabled"] = tls.Checked, ["certPath"] = cert.Text.Trim(), ["keyPath"] = key.Text.Trim() };
        if (tls.Checked) {
            if (!File.Exists(cert.Text.Trim()) || !File.Exists(key.Text.Trim())) throw new Exception(L("Select an existing certificate and private key.", "فایل گواهی و کلید خصوصی موجود را انتخاب کنید."));
            using var certificate = X509Certificate2.CreateFromPemFile(cert.Text.Trim(), key.Text.Trim());
            if (certificate.NotAfter.ToUniversalTime() <= DateTime.UtcNow) throw new Exception(L("The selected certificate has expired.", "گواهی انتخاب‌شده منقضی شده است."));
        }
        result["tls"] = tlsConfig; return result;
    }
    async Task Save(bool restart) {
        var candidate = Collect();
        if (!Program.Admin) throw new Exception(L("Run this manager as administrator to save configuration.", "برای ذخیره تنظیمات با دسترسی مدیر اجرا کنید."));
        Program.ProtectData();
        // Copy private TLS material into the service-only configuration directory.
        if (tls.Checked) {
            var tlsDirectory = Path.Combine(Program.DataDir, "tls"); Directory.CreateDirectory(tlsDirectory);
            var certTarget = Path.Combine(tlsDirectory, "fullchain.pem"); var keyTarget = Path.Combine(tlsDirectory, "privatekey.pem");
            if (!Path.GetFullPath(cert.Text.Trim()).Equals(certTarget, StringComparison.OrdinalIgnoreCase)) File.Copy(cert.Text.Trim(), certTarget, true);
            if (!Path.GetFullPath(key.Text.Trim()).Equals(keyTarget, StringComparison.OrdinalIgnoreCase)) File.Copy(key.Text.Trim(), keyTarget, true);
            candidate["tls"]!["certPath"] = certTarget; candidate["tls"]!["keyPath"] = keyTarget;
        }
        var testFile = Path.Combine(Program.DataDir, "validate.config.json");
        File.WriteAllText(testFile, candidate.ToJsonString());
        var runtimeDir = File.Exists(Path.Combine(Program.InstallDir, "node.exe")) ? Program.InstallDir : AppContext.BaseDirectory;
        try { await Task.Run(() => Program.Run(Path.Combine(runtimeDir, "node.exe"), Path.Combine(runtimeDir, "server", "standalone.cjs"), "--check-config", testFile)); }
        finally { File.Delete(testFile); }
        Program.SaveConfig(candidate); configuration = candidate;
        if (restart && Program.Status() != "Not installed") await Task.Run(() => Program.Control("restart"));
        output.Text = L("Configuration saved. No existing IIS sites or firewall rules were changed.", "تنظیمات ذخیره شد. سایت‌های IIS یا قوانین فایروال موجود تغییر نکردند."); RefreshStatus();
    }
    async Task ExportClient() {
        await Save(false);
        var url = publicUrl.Text.Trim(); if (string.IsNullOrEmpty(url)) url = $"ws://127.0.0.1:{port.Value}";
        using var save = new SaveFileDialog { FileName = "shatootconnect.connection.json", Filter = "JSON|*.json" };
        if (save.ShowDialog(this) == DialogResult.OK) File.WriteAllText(save.FileName, new JsonObject { ["endpoint"] = url, ["serverKey"] = enrollmentKey.Text }.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }
    async Task Check(bool internet) {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        string endpoint;
        if (internet) {
            if (!Uri.TryCreate(publicUrl.Text.Trim(), UriKind.Absolute, out var url) || url.Scheme != "wss") throw new Exception(L("Configure a public WSS address first.", "ابتدا نشانی عمومی WSS را تنظیم کنید."));
            var builder = new UriBuilder(url) { Scheme = "https", Path = "/health", Query = "" }; endpoint = builder.Uri.AbsoluteUri;
        } else endpoint = $"{(tls.Checked ? "https" : "http")}://{(host.Text == "0.0.0.0" ? "127.0.0.1" : host.Text)}:{port.Value}/health";
        var response = await client.GetStringAsync(endpoint); var json = JsonNode.Parse(response);
        if (json?["ok"]?.GetValue<bool>() != true || json?["service"]?.GetValue<string>() != "ShatootConnect signaling") throw new Exception("The endpoint is not a healthy ShatootConnect broker.");
        output.Text = L($"PASS: {endpoint}\r\nBroker health verified. TLS validation was not bypassed.\r\nTURN allocation is verified automatically by each client after connection, not by this health endpoint.",
            $"موفق: {endpoint}\r\nسلامت سرور بررسی شد؛ اعتبارسنجی TLS غیرفعال نشده است.\r\nتخصیص TURN پس از اتصال توسط هر کلاینت خودکار بررسی می‌شود و این health check آن را اثبات نمی‌کند.");
    }
}

static class SelfTest {
    internal static void Run() {
        using var form = new ManagerForm(); form.Show(); Application.DoEvents();
        var folder = Path.Combine(AppContext.BaseDirectory, "validation"); Directory.CreateDirectory(folder);
        using var bitmap = new Bitmap(form.Width, form.Height); form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size)); bitmap.Save(Path.Combine(folder, "server-manager-en.png"));
        form.TestLanguage(true); Application.DoEvents();
        using var persian = new Bitmap(form.Width, form.Height); form.DrawToBitmap(persian, new Rectangle(Point.Empty, persian.Size)); persian.Save(Path.Combine(folder, "server-manager-fa.png"));
        bool childCleanup = false;
        if (File.Exists(Path.Combine(AppContext.BaseDirectory, "node.exe"))) {
            using var job = new ChildJob();
            using var child = Process.Start(new ProcessStartInfo(Path.Combine(AppContext.BaseDirectory, "node.exe")) { ArgumentList = { "-e", "setInterval(()=>{},1000)" }, UseShellExecute = false, CreateNoWindow = true })!;
            job.Add(child); job.Dispose(); childCleanup = child.WaitForExit(5000); if (!childCleanup) { child.Kill(true); throw new Exception("Job cleanup failed."); }
        }
        File.WriteAllText(Path.Combine(folder, "manager-self-test.json"), new JsonObject { ["ok"] = true, ["serviceStatus"] = Program.Status(), ["didInstallService"] = false, ["childJobCleanupVerified"] = childCleanup }.ToJsonString());
    }
}
