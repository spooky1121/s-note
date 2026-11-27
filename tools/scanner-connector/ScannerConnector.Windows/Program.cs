using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Snote.ScannerConnector.Core;

namespace Snote.ScannerConnector.Windows;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--self-test", StringComparer.Ordinal)) return NativeSelfTest.Run();
        ApplicationConfiguration.Initialize();
        using var mutex = new Mutex(true, "Local\\SnoteScannerConnector", out var created);
        if (!created)
        {
            MessageBox.Show("S-NOTE 스캐너 연결이 이미 실행 중입니다. 작업 표시줄의 알림 영역에서 S-NOTE 아이콘을 열어 주세요.", "S-NOTE 스캐너 연결", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        Application.Run(new ConnectorForm(args.Contains("--background", StringComparer.Ordinal)));
        return 0;
    }
}

internal sealed class ConnectorForm : Form
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", RunName = "SnoteScannerConnector";
    private readonly PairingState _pairing = new();
    private readonly WiaScannerAdapter _adapter = new();
    private readonly Label _code = new(), _status = new();
    private readonly Button _refresh = new(), _install = new(), _removeStartup = new();
    private readonly NotifyIcon _tray;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    private readonly bool _background;
    private Microsoft.AspNetCore.Builder.WebApplication? _host;
    private bool _exit, _closing, _ready;

    public ConnectorForm(bool background)
    {
        _background = background;
        Text = "S-NOTE 스캐너 연결";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(440, 376);
        MinimumSize = MaximumSize = SizeFromClientSize(ClientSize);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        BackColor = Color.White;
        ForeColor = Color.FromArgb(35, 54, 70);
        Font = new Font("맑은 고딕", 9.5f);
        Icon = BrandIcon();

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(28, 24, 28, 22), ColumnCount = 1, RowCount = 7 };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        foreach (var height in new float[] { 40, 36, 66, 38, 48, 42, 40 }) panel.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        var title = new Label { Text = "S-NOTE 스캐너 연결", Font = new Font(Font.FontFamily, 16, FontStyle.Bold), AutoSize = false, Dock = DockStyle.Fill };
        _status.Text = "웹 연결을 준비하고 있습니다…";
        _status.Dock = DockStyle.Fill;
        _status.AutoSize = false;
        _code.Dock = DockStyle.Fill;
        _code.Font = new Font("Segoe UI", 32, FontStyle.Bold);
        _code.TextAlign = ContentAlignment.MiddleCenter;
        _code.ForeColor = Color.FromArgb(0, 145, 208);
        _code.Text = "------";
        var hint = new Label { Text = "S-NOTE → 경리 스캐너 → 연결에 위 코드를 입력하세요.", Dock = DockStyle.Fill, AutoSize = false, TextAlign = ContentAlignment.MiddleCenter };
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
        _refresh.Text = "코드 새로 발급";
        _refresh.AutoSize = true;
        _refresh.Enabled = false;
        _refresh.Click += (_, _) => { _pairing.Rotate(); RenderCode(); };
        var open = new Button { Text = "S-NOTE 열기", AutoSize = true };
        open.Click += (_, _) => OpenNote();
        actions.Controls.AddRange([_refresh, open]);
        var setup = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false };
        _install.Text = "이 PC에 설치 · 자동 실행";
        _install.AutoSize = true;
        _install.Click += (_, _) => InstallForCurrentUser();
        _removeStartup.Text = "자동 실행 해제";
        _removeStartup.AutoSize = true;
        _removeStartup.Click += (_, _) => RemoveStartup();
        setup.Controls.AddRange([_install, _removeStartup]);
        var foot = new Label { Text = "창을 닫아도 알림 영역에서 연결을 유지합니다.\n종료하려면 알림 영역 아이콘 → 종료를 선택하세요.", Dock = DockStyle.Fill, AutoSize = false, ForeColor = Color.FromArgb(102, 119, 132) };
        panel.Controls.Add(title, 0, 0); panel.Controls.Add(_status, 0, 1); panel.Controls.Add(_code, 0, 2); panel.Controls.Add(hint, 0, 3); panel.Controls.Add(actions, 0, 4); panel.Controls.Add(setup, 0, 5); panel.Controls.Add(foot, 0, 6);
        Controls.Add(panel);

        var menu = new ContextMenuStrip();
        menu.Items.Add("열기", null, (_, _) => ShowWindow());
        menu.Items.Add("S-NOTE 열기", null, (_, _) => OpenNote());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("종료", null, (_, _) => { _exit = true; Close(); });
        _tray = new NotifyIcon { Text = "S-NOTE 스캐너 연결", Icon = (Icon)Icon.Clone(), ContextMenuStrip = menu, Visible = true };
        _tray.DoubleClick += (_, _) => ShowWindow();
        _timer.Tick += (_, _) => RenderCode();
        _timer.Start();
        Shown += async (_, _) =>
        {
            if (_background) Hide();
            await StartHost();
        };
        FormClosing += CloseRequested;
        RefreshInstallationState();
    }

    private async Task StartHost()
    {
        try
        {
            _host = ConnectorHost.Create(_adapter, _pairing, new ConnectorOptions());
            await _host.StartAsync();
            if (IsDisposed || _closing) return;
            _ready = true;
            _status.Text = "S-NOTE의 연결을 기다리고 있습니다.";
            _status.ForeColor = Color.FromArgb(32, 129, 90);
            _refresh.Enabled = true;
            RenderCode();
        }
        catch
        {
            if (IsDisposed || _closing) return;
            _status.Text = "연결을 시작하지 못했습니다. 다른 연결 도우미를 종료한 뒤 다시 실행해 주세요.";
            _status.ForeColor = Color.FromArgb(190, 57, 57);
            _code.Text = "------";
            ShowWindow();
        }
    }

    private void RenderCode()
    {
        if (_ready && !_closing) _code.Text = _pairing.CurrentCode;
    }

    private void ShowWindow()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private static void OpenNote()
    {
        try { Process.Start(new ProcessStartInfo("https://s-note.kr/") { UseShellExecute = true }); }
        catch { MessageBox.Show("브라우저에서 https://s-note.kr/ 을 열어 주세요.", "S-NOTE 스캐너 연결", MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }

    private void InstallForCurrentUser()
    {
        if (MessageBox.Show("현재 Windows 계정에 연결 도우미를 설치하고, Windows에 로그인할 때 자동으로 실행할까요?\n\n관리자 권한은 사용하지 않습니다.", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try
        {
            // A regular development build has adjacent DLL dependencies. Only
            // the published, self-contained single executable is installable.
#pragma warning disable IL3000
            if (Assembly.GetExecutingAssembly().Location.Length != 0) throw new InvalidOperationException();
#pragma warning restore IL3000
            var source = Environment.ProcessPath ?? throw new InvalidOperationException();
            var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Snote", "ScannerConnector");
            var target = Path.Combine(folder, "SnoteScanner.exe");
            Directory.CreateDirectory(folder);
            if (!string.Equals(Path.GetFullPath(source), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase)) File.Copy(source, target, true);
            using var key = Registry.CurrentUser.CreateSubKey(RunKey, true);
            key.SetValue(RunName, "\"" + target + "\" --background", RegistryValueKind.String);
            RefreshInstallationState();
            MessageBox.Show("설치했습니다. 다음 Windows 로그인부터 자동으로 연결을 준비합니다. 현재 창은 닫아도 됩니다.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch { MessageBox.Show("설치를 마치지 못했습니다. 공식 배포 ZIP의 압축을 푼 뒤 SnoteScanner.exe를 실행해 주세요.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }

    private void RemoveStartup()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, true);
            key?.DeleteValue(RunName, false);
            RefreshInstallationState();
            MessageBox.Show("자동 실행을 해제했습니다. 현재 실행 중인 연결은 유지됩니다.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch { MessageBox.Show("자동 실행을 해제하지 못했습니다. Windows 시작 앱에서 S-NOTE 스캐너 연결을 확인해 주세요.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }

    private void RefreshInstallationState()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
            _removeStartup.Enabled = key?.GetValue(RunName) is string;
        }
        catch { _removeStartup.Enabled = false; }
    }

    private async void CloseRequested(object? sender, FormClosingEventArgs e)
    {
        if (!_exit && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }
        if (e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing)
        {
            _closing = true;
            _tray.Visible = false;
            _timer.Stop();
            _adapter.Dispose();
            _host?.Lifetime.StopApplication();
            return;
        }
        if (_closing) return;
        e.Cancel = true;
        _closing = true;
        _timer.Stop();
        _tray.Visible = false;
        Hide();
        try
        {
            if (_host is not null)
            {
                using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                await _host.StopAsync(stop.Token);
                await _host.DisposeAsync();
            }
        }
        catch { /* Local results remain in memory only and are lost on exit. */ }
        finally
        {
            _adapter.Dispose();
            _tray.Dispose();
            _timer.Dispose();
            FormClosing -= CloseRequested;
            Close();
        }
    }

    private static Icon BrandIcon()
    {
        try
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Snote.ScannerConnector.Windows.Brand.png") ?? throw new InvalidOperationException();
            using var bitmap = new Bitmap(stream);
            var handle = bitmap.GetHicon();
            try { return (Icon)Icon.FromHandle(handle).Clone(); }
            finally { DestroyIcon(handle); }
        }
        catch { return (Icon)SystemIcons.Application.Clone(); }
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr handle);
}
