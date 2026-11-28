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
        var background = args.Contains("--background", StringComparer.Ordinal);
        using var mutex = new Mutex(true, "Local\\SnoteScannerConnector", out var created);
        if (!created)
        {
            if (!background) MessageBox.Show("S-NOTE 스캐너 연결이 이미 실행 중입니다. 알림 영역의 S-NOTE 아이콘을 열어 주세요.\n\n새 버전을 설치하려면 기존 도우미를 알림 영역에서 종료한 뒤 설치 파일을 다시 실행해 주세요.", "S-NOTE 스캐너 연결", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        Application.Run(new ConnectorForm(background));
        return 0;
    }
}

internal sealed class ConnectorForm : Form
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", RunName = "SnoteScannerConnector";
    private readonly PairingState _pairing = new();
    private readonly WiaScannerAdapter _adapter = new();
    private readonly Label _status = new(), _connectionState = new();
    private readonly Button _install = new(), _removeStartup = new(), _resetTrust = new();
    private readonly WindowsScannerTrustStore _trust = new();
    private readonly NotifyIcon _tray;
    private readonly bool _background;
    private Microsoft.AspNetCore.Builder.WebApplication? _host;
    private bool _exit, _closing, _ready, _openAfterReady;

    public ConnectorForm(bool background)
    {
        _background = background;
        Text = "S-NOTE 스캐너 연결";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(470, 390);
        MinimumSize = MaximumSize = SizeFromClientSize(ClientSize);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        BackColor = Color.White;
        ForeColor = Color.FromArgb(35, 54, 70);
        Font = new Font("맑은 고딕", 9.5f);
        Icon = BrandIcon();

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(28, 24, 28, 22), ColumnCount = 1, RowCount = 7 };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        foreach (var height in new float[] { 40, 36, 60, 38, 46, 52, 58 }) panel.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        var title = new Label { Text = "S-NOTE 스캐너 연결", Font = new Font(Font.FontFamily, 16, FontStyle.Bold), AutoSize = false, Dock = DockStyle.Fill };
        _status.Text = "웹 연결을 준비하고 있습니다…";
        _status.Dock = DockStyle.Fill;
        _status.AutoSize = false;
        var hint = new Label { Text = "한 번 설치하면 Windows 시작 시 자동으로 준비됩니다.\n이후 S-NOTE → 스캐너에서 스캔만 눌러 주세요.", Dock = DockStyle.Fill, AutoSize = false };
        _connectionState.Dock = DockStyle.Fill;
        _connectionState.AutoSize = false;
        _connectionState.ForeColor = Color.FromArgb(102, 119, 132);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
        var open = new Button { Text = "S-NOTE 열기", AutoSize = true };
        open.Click += (_, _) => OpenNote();
        _resetTrust.Text = "연결 승인 초기화";
        _resetTrust.AutoSize = true;
        _resetTrust.Click += (_, _) => ResetTrust();
        actions.Controls.AddRange([open, _resetTrust]);
        var setup = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false };
        _install.Text = "설치하고 Windows 자동 실행";
        _install.AutoSize = true;
        _install.Click += (_, _) => InstallForCurrentUser();
        _removeStartup.Text = "자동 실행 해제";
        _removeStartup.AutoSize = true;
        _removeStartup.Click += (_, _) => RemoveStartup();
        setup.Controls.AddRange([_install, _removeStartup]);
        var foot = new Label { Text = "최초 브라우저 연결은 ‘연결 허용’만 눌러 주세요.\n창을 닫아도 알림 영역에서 연결을 유지합니다.\nWindows에서 인식되는 여러 제조사의 스캐너를 사용합니다.", Dock = DockStyle.Fill, AutoSize = false, ForeColor = Color.FromArgb(102, 119, 132) };
        panel.Controls.Add(title, 0, 0); panel.Controls.Add(_status, 0, 1); panel.Controls.Add(hint, 0, 2); panel.Controls.Add(_connectionState, 0, 3); panel.Controls.Add(setup, 0, 4); panel.Controls.Add(actions, 0, 5); panel.Controls.Add(foot, 0, 6);
        Controls.Add(panel);

        var menu = new ContextMenuStrip();
        menu.Items.Add("열기", null, (_, _) => ShowWindow());
        menu.Items.Add("S-NOTE 열기", null, (_, _) => OpenNote());
        menu.Items.Add("연결 승인 초기화", null, (_, _) => ResetTrust());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("종료", null, (_, _) => { _exit = true; Close(); });
        _tray = new NotifyIcon { Text = "S-NOTE 스캐너 연결", Icon = (Icon)Icon.Clone(), ContextMenuStrip = menu, Visible = true };
        _tray.DoubleClick += (_, _) => ShowWindow();
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
            _host = ConnectorHost.Create(_adapter, _pairing, new ConnectorOptions
            {
                TrustStore = _trust,
                ConnectionApproval = new WindowsConnectionApproval(this)
            });
            await _host.StartAsync();
            if (IsDisposed || _closing) return;
            _ready = true;
            _status.Text = "연결 준비 완료 · S-NOTE에서 스캔을 눌러 주세요.";
            _status.ForeColor = Color.FromArgb(32, 129, 90);
            RefreshInstallationState();
            if (_openAfterReady) { _openAfterReady = false; Hide(); OpenNote(); }
        }
        catch
        {
            if (IsDisposed || _closing) return;
            _status.Text = "연결을 시작하지 못했습니다. 다른 연결 도우미를 종료한 뒤 다시 실행해 주세요.";
            _status.ForeColor = Color.FromArgb(190, 57, 57);
            _openAfterReady = false;
            ShowWindow();
        }
    }

    private void ShowWindow()
    {
        RefreshInstallationState();
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
            WriteNotices(folder);
            using var key = Registry.CurrentUser.CreateSubKey(RunKey, true);
            key.SetValue(RunName, "\"" + target + "\" --background", RegistryValueKind.String);
            RefreshInstallationState();
            _status.Text = "설치 완료 · 다음 Windows 로그인부터 자동 실행됩니다.";
            _openAfterReady = true;
            if (_ready) { _openAfterReady = false; Hide(); OpenNote(); }
        }
        catch { MessageBox.Show("설치를 마치지 못했습니다. 이전 연결 도우미가 실행 중이면 알림 영역에서 종료한 뒤 공식 설치 파일을 다시 실행해 주세요.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); }
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
            _install.Text = _removeStartup.Enabled ? "설치 · 자동 실행 설정" : "설치하고 Windows 자동 실행";
            _connectionState.Text = "기억한 브라우저 연결: " + _trust.Count + "개 · 번호 입력 없음";
        }
        catch { _removeStartup.Enabled = false; }
    }

    private void ResetTrust()
    {
        if (MessageBox.Show("이 PC에서 기억한 S-NOTE 브라우저 연결을 모두 해제할까요?\n다음 스캔 때 연결을 다시 허용하면 됩니다.", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try
        {
            _pairing.RevokeAll(_trust.Clear);
            RefreshInstallationState();
            MessageBox.Show("기억한 연결을 해제했습니다.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch { MessageBox.Show("연결 승인을 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }

    private static void WriteNotices(string folder)
    {
        foreach (var file in new[] { "LICENSE.txt", "ThirdPartyNotices.txt" })
        {
            using var input = Assembly.GetExecutingAssembly().GetManifestResourceStream("Snote.ScannerConnector.Windows.Licenses." + file) ?? throw new InvalidOperationException();
            using var output = new FileStream(Path.Combine(folder, file), FileMode.Create, FileAccess.Write, FileShare.Read);
            input.CopyTo(output);
        }
    }

    private async void CloseRequested(object? sender, FormClosingEventArgs e)
    {
        if (!_exit && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); return; }
        if (e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing)
        {
            _closing = true;
            _tray.Visible = false;
            _adapter.Dispose();
            _host?.Lifetime.StopApplication();
            return;
        }
        if (_closing) return;
        e.Cancel = true;
        _closing = true;
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
