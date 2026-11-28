using Snote.ScannerConnector.Core;

namespace Snote.ScannerConnector.Windows;

internal sealed class WindowsConnectionApproval(Form owner) : IScannerConnectionApproval
{
    // This field is read and written on the Windows UI thread only.
    private Form? _current;

    public async Task<ScannerConnectionDecision> ApproveAsync(ScannerConnectionRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var completion = new TaskCompletionSource<ScannerConnectionDecision>(TaskCreationOptions.RunContinuationsAsynchronously);
        Form? dialog = null;
        void Post(Action action)
        {
            try
            {
                if (owner.IsDisposed || !owner.IsHandleCreated) { completion.TrySetResult(new(false, false)); return; }
                owner.BeginInvoke(action);
            }
            catch { completion.TrySetResult(new(false, false)); }
        }
        using var registration = cancellationToken.Register(() => Post(() =>
        {
            if (dialog is not null && !dialog.IsDisposed) dialog.Close();
            completion.TrySetCanceled(cancellationToken);
        }));
        Post(() =>
        {
            if (cancellationToken.IsCancellationRequested) { completion.TrySetCanceled(cancellationToken); return; }
            if (_current is not null || owner.IsDisposed) { completion.TrySetResult(new(false, false)); return; }
            using var prompt = new ApprovalDialog(request.Origin, owner.Icon ?? SystemIcons.Application);
            dialog = prompt;
            _current = prompt;
            try
            {
                var result = prompt.ShowDialog(owner);
                if (cancellationToken.IsCancellationRequested) completion.TrySetCanceled(cancellationToken);
                else completion.TrySetResult(new(result == DialogResult.OK, result == DialogResult.OK && prompt.Remember));
            }
            catch { completion.TrySetResult(new(false, false)); }
            finally { _current = null; dialog = null; }
        });
        return await completion.Task.ConfigureAwait(false);
    }

    private sealed class ApprovalDialog : Form
    {
        private readonly CheckBox _remember = new() { Text = "이 Windows 계정에서 이 브라우저의 연결 기억", Checked = true, AutoSize = true };
        public bool Remember => _remember.Checked;

        public ApprovalDialog(string origin, Icon icon)
        {
            Text = "S-NOTE 스캐너 연결 허용";
            Icon = icon;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(460, 266);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            ShowInTaskbar = true;
            TopMost = true;
            BackColor = Color.White;
            ForeColor = Color.FromArgb(35, 54, 70);
            Font = new Font("맑은 고딕", 9.5f);
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), RowCount = 5, ColumnCount = 1 };
            foreach (var height in new float[] { 36, 32, 54, 38, 48 }) layout.RowStyles.Add(new(SizeType.Absolute, height));
            var title = new Label { Text = "이 브라우저에서 스캐너를 사용할까요?", Dock = DockStyle.Fill, Font = new Font(Font.FontFamily, 12, FontStyle.Bold) };
            var site = new Label { Text = origin, Dock = DockStyle.Fill, ForeColor = Color.FromArgb(0, 125, 182) };
            var help = new Label { Text = "지금 S-NOTE에서 스캔을 눌렀다면 연결을 허용해 주세요.\n번호를 입력할 필요 없이 이 PC의 스캐너와 연결됩니다.", Dock = DockStyle.Fill };
            var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
            var allow = new Button { Text = "연결 허용", AutoSize = true, DialogResult = DialogResult.OK };
            var deny = new Button { Text = "취소", AutoSize = true, DialogResult = DialogResult.Cancel };
            actions.Controls.AddRange([allow, deny]);
            layout.Controls.Add(title, 0, 0); layout.Controls.Add(site, 0, 1); layout.Controls.Add(help, 0, 2); layout.Controls.Add(_remember, 0, 3); layout.Controls.Add(actions, 0, 4);
            Controls.Add(layout);
            AcceptButton = allow;
            CancelButton = deny;
        }
    }
}
