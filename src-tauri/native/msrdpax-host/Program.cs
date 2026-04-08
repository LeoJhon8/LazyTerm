using System.Runtime.InteropServices;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows.Forms;

namespace LazyTerm.MsRdpAxHost;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        try
        {
            ApplicationConfiguration.Initialize();
            using var context = new HostApplicationContext();
            Application.Run(context);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[msrdpax-host][fatal] {ex}");
            throw;
        }
    }
}

internal sealed class HostApplicationContext : ApplicationContext
{
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HostForm _hostForm;
    private readonly CancellationTokenSource _cts = new();
    private readonly StreamWriter _stdout;

    public HostApplicationContext()
    {
        _stdout = new StreamWriter(Console.OpenStandardOutput())
        {
            AutoFlush = true,
        };

        _hostForm = new HostForm(Emit);
        _hostForm.FormClosed += (_, _) => ExitThread();
        _hostForm.HostClicked += () => Emit(new SidecarOutboundMessage
        {
            Type = "focused",
            Detail = "宿主窗口收到点击，焦点已回到 sidecar 子窗口。",
            Rect = _hostForm.CurrentRect,
        });

        // Ensure the window handle exists before background threads call BeginInvoke.
        _ = _hostForm.Handle;
        Emit(new SidecarOutboundMessage
        {
            Type = "state",
            Detail = "HostForm 句柄已创建，允许跨线程 BeginInvoke。",
            Rect = _hostForm.CurrentRect,
        });

        var readTask = Task.Run(ReadCommandsAsync, _cts.Token);
        readTask.ContinueWith(
            task =>
            {
                Emit(new SidecarOutboundMessage
                {
                    Type = "error",
                    Detail = $"stdin 读取任务异常退出: {task.Exception?.GetBaseException().Message}",
                    Rect = _hostForm.CurrentRect,
                });
            },
            CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted,
            TaskScheduler.Default
        );
        Emit(new SidecarOutboundMessage
        {
            Type = "ready",
            Detail = "msrdpax-host sidecar 已启动，等待 init。",
        });
    }

    protected override void ExitThreadCore()
    {
        _cts.Cancel();
        _stdout.Dispose();
        _hostForm.Dispose();
        base.ExitThreadCore();
    }

    private async Task ReadCommandsAsync()
    {
        try
        {
            using var stdin = new StreamReader(Console.OpenStandardInput());
            Emit(new SidecarOutboundMessage
            {
                Type = "state",
                Detail = "stdin 读取循环已启动，等待 Rust 控制消息。",
                Rect = _hostForm.CurrentRect,
            });

            while (!_cts.IsCancellationRequested)
            {
                var line = await stdin.ReadLineAsync();
                if (line is null)
                {
                    Emit(new SidecarOutboundMessage
                    {
                        Type = "state",
                        Detail = "stdin 读取到 EOF。",
                        Rect = _hostForm.CurrentRect,
                    });
                    break;
                }

                SidecarInboundMessage? message;
                try
                {
                    message = JsonSerializer.Deserialize<SidecarInboundMessage>(line, _jsonOptions);
                }
                catch (Exception ex)
                {
                    Emit(new SidecarOutboundMessage
                    {
                        Type = "error",
                        Detail = $"无法解析 sidecar 输入: {ex.Message}",
                        Rect = _hostForm.CurrentRect,
                    });
                    continue;
                }

                if (message is null)
                {
                    continue;
                }

                Emit(new SidecarOutboundMessage
                {
                    Type = "state",
                    Detail = $"收到指令: {message.Type}",
                    Rect = message.Rect ?? _hostForm.CurrentRect,
                });

                Dispatch(message);
            }
        }
        catch (Exception ex)
        {
            Emit(new SidecarOutboundMessage
            {
                Type = "error",
                Detail = $"stdin 读取循环异常: {ex.Message}",
                Rect = _hostForm.CurrentRect,
            });
        }

        Emit(new SidecarOutboundMessage
        {
            Type = "closed",
            Detail = "stdin 已结束，msrdpax-host sidecar 即将退出。",
            Rect = _hostForm.CurrentRect,
        });

        if (!_hostForm.IsDisposed)
        {
            if (_hostForm.IsHandleCreated)
            {
                _hostForm.BeginInvoke(new Action(() => _hostForm.Close()));
            }
            else
            {
                Emit(new SidecarOutboundMessage
                {
                    Type = "state",
                    Detail = "HostForm 句柄未创建，直接退出消息循环。",
                    Rect = _hostForm.CurrentRect,
                });
                ExitThread();
            }
        }
    }

    private void Dispatch(SidecarInboundMessage message)
    {
        switch (message.Type)
        {
            case "init":
                if (message.Init is null)
                {
                    Emit(new SidecarOutboundMessage { Type = "error", Detail = "init 缺少 payload。" });
                    return;
                }
                Emit(new SidecarOutboundMessage
                {
                    Type = "state",
                    Detail = $"收到 init: parentHwnd={message.Init.ParentHwnd}, target={message.Init.Host}:{message.Init.Port}, user={message.Init.Username}",
                    Rect = _hostForm.CurrentRect,
                });
                _hostForm.BeginInvoke(new Action(() => _hostForm.AttachToParent(message.Init.ParentHwnd, message.Init)));
                Emit(new SidecarOutboundMessage
                {
                    Type = "host-ready",
                    Detail = $"已投递 AttachToParent 到 UI 线程，目标={message.Init.Host}:{message.Init.Port}。",
                    Rect = _hostForm.CurrentRect,
                });
                return;
            case "mount":
                if (message.Rect is null)
                {
                    Emit(new SidecarOutboundMessage { Type = "error", Detail = "mount 缺少 rect。" });
                    return;
                }
                _hostForm.BeginInvoke(new Action(() => _hostForm.UpdateRect(message.Rect)));
                Emit(new SidecarOutboundMessage
                {
                    Type = "mounted",
                    Detail = $"宿主窗口位置已更新: x={message.Rect.X} y={message.Rect.Y} w={message.Rect.Width} h={message.Rect.Height} scale={message.Rect.ScaleFactor}",
                    Rect = message.Rect,
                });
                return;
            case "show":
                _hostForm.BeginInvoke(new Action(() => _hostForm.ShowHost()));
                Emit(new SidecarOutboundMessage
                {
                    Type = "state",
                    Detail = "show 指令已投递到 UI 线程。",
                    Rect = _hostForm.CurrentRect,
                });
                return;
            case "hide":
                _hostForm.BeginInvoke(new Action(() => _hostForm.HideHost()));
                Emit(new SidecarOutboundMessage
                {
                    Type = "state",
                    Detail = "hide 指令已投递到 UI 线程。",
                    Rect = _hostForm.CurrentRect,
                });
                return;
            case "focus":
                _hostForm.BeginInvoke(new Action(() => _hostForm.FocusHost()));
                Emit(new SidecarOutboundMessage
                {
                    Type = "focused",
                    Detail = "宿主窗口已请求焦点。",
                    Rect = _hostForm.CurrentRect,
                });
                return;
            case "close":
                _hostForm.BeginInvoke(new Action(() => _hostForm.Close()));
                return;
            default:
                Emit(new SidecarOutboundMessage { Type = "error", Detail = $"未知指令类型: {message.Type}" });
                return;
        }
    }

    private void Emit(SidecarOutboundMessage message)
    {
        var line = JsonSerializer.Serialize(message, _jsonOptions);
        _stdout.WriteLine(line);
    }
}

internal sealed class HostForm : Form
{
    private readonly Panel _panel;
    private readonly Panel _statusPanel;
    private readonly Label _titleLabel;
    private readonly Label _detailLabel;
    private readonly Action<SidecarOutboundMessage> _emit;
    private readonly System.Windows.Forms.Timer _stateTimer;
    private readonly System.Windows.Forms.Timer _revealTimer;
    private RdpActiveXHost? _rdpHost;
    private SidecarInitPayload? _init;
    private IntPtr _parentHwnd;
    private int? _lastConnectedState;
    private bool _connectIssued;
    private bool _waitingForOcxReady;
    private bool _showRequested;
    private bool _hostVisible;
    private bool _hostWindowCreated;

    public event Action? HostClicked;
    public NativeHostRectPayload? CurrentRect { get; private set; }

    public HostForm(Action<SidecarOutboundMessage> emit)
    {
        _emit = emit;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        // Hide from Alt+Tab switcher so it doesn't appear as a separate window.
        // WS_EX_TOOLWINDOW will be applied via CreateParams.
        StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(18, 18, 18);
        ForeColor = Color.White;
        MinimumSize = new Size(200, 200);
        Opacity = 0;

        _panel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Black,
        };

        _statusPanel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(20, 26, 42),
            Padding = new Padding(24),
        };

        _titleLabel = new Label
        {
            Dock = DockStyle.Top,
            Height = 28,
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 12, FontStyle.Bold),
            Text = "MsTscAx Native Host",
        };

        _detailLabel = new Label
        {
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(200, 220, 255),
            Font = new Font("Segoe UI", 9),
            Text = "正在等待初始化。",
        };

        _statusPanel.Controls.Add(_detailLabel);
        _statusPanel.Controls.Add(_titleLabel);
        _panel.Controls.Add(_statusPanel);
        Controls.Add(_panel);

        _panel.Click += (_, _) => HostClicked?.Invoke();
        _titleLabel.Click += (_, _) => HostClicked?.Invoke();
        _detailLabel.Click += (_, _) => HostClicked?.Invoke();

        _stateTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _stateTimer.Tick += (_, _) => PollConnectionState();
        _stateTimer.Start();

        _revealTimer = new System.Windows.Forms.Timer { Interval = 80 };
        _revealTimer.Tick += (_, _) =>
        {
            _revealTimer.Stop();
            var shouldReveal = _showRequested && _lastConnectedState == 1 && !IsDisposed;
            if (!shouldReveal)
            {
                return;
            }

            Opacity = 1;
            BringHostToFront();
            if (_rdpHost is not null && !_rdpHost.IsDisposed)
            {
                _rdpHost.BringToFront();
            }

            EmitState("visible", "宿主窗口已在延迟显现后真正可见。", CurrentRect);
        };
    }

    public void AttachToParent(long parentHwnd, SidecarInitPayload init)
    {
        _init = init;
        _parentHwnd = new IntPtr(parentHwnd);
        // Do NOT SetParent — WebView2 uses DirectComposition which always renders
        // over Win32 child windows of the same parent regardless of z-order.
            // Instead keep as a floating top-level owned window so it stays above the
            // main app window without remaining above unrelated applications.
            NativeMethods.SetWindowLongPtr(Handle, NativeMethods.GWLP_HWNDPARENT, _parentHwnd);
        _titleLabel.Text = $"MsTscAx Native Host · {init.Host}:{init.Port}";

        EnsureRdpHost();
        ConnectRdp();
        if (!_hostWindowCreated)
        {
            Show();
            _hostWindowCreated = true;
        }
        ParkHostWindow();
        _hostVisible = false;
    }

    public void UpdateRect(NativeHostRectPayload rect)
    {
        CurrentRect = rect;
        if (_hostVisible)
        {
            ApplyHostWindowRect(rect);
        }

        ApplyDisplayLayout(rect);
    }

    public void ShowHost()
    {
        _showRequested = true;
        EmitState("state", "收到 show 请求，等待连接完成与 reveal timer。", CurrentRect);
        UpdateHostVisibility();
    }

    public void HideHost()
    {
        _showRequested = false;
        EmitState("state", "收到 hide 请求，准备隐藏并停放宿主窗口。", CurrentRect);
        UpdateHostVisibility();
    }

    public void FocusHost()
    {
        if (_rdpHost is not null && !_rdpHost.IsDisposed)
        {
            _rdpHost.Focus();
        }

        BringHostToFront();
        NativeMethods.SetFocus(Handle);
    }

    private void BringHostToFront()
    {
        NativeMethods.SetWindowPos(
            Handle,
            NativeMethods.HWND_TOP,
            0,
            0,
            0,
            0,
            NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOACTIVATE);
    }

    private void ApplyHostWindowRect(NativeHostRectPayload rect)
    {
        NativeMethods.SetWindowPos(
            Handle,
            NativeMethods.HWND_TOP,
            rect.X,
            rect.Y,
            Math.Max(0, rect.Width),
            Math.Max(0, rect.Height),
            NativeMethods.SWP_NOACTIVATE);
    }

    private void ParkHostWindow()
    {
        NativeMethods.SetWindowPos(
            Handle,
            NativeMethods.HWND_TOP,
            -32000,
            -32000,
            1,
            1,
            NativeMethods.SWP_NOACTIVATE);
    }

    private void UpdateHostVisibility()
    {
        var connected = _lastConnectedState == 1;
        var shouldShow = _showRequested && connected;

        if (shouldShow == _hostVisible)
        {
            EmitState("state", $"忽略可见性更新: shouldShow={shouldShow}, hostVisible={_hostVisible}", CurrentRect);
            return;
        }

        if (shouldShow)
        {
            if (CurrentRect is { } rect)
            {
                ApplyHostWindowRect(rect);
            }
            BringHostToFront();
            if (_rdpHost is not null && !_rdpHost.IsDisposed)
            {
                _rdpHost.BringToFront();
            }

            _revealTimer.Stop();
            _revealTimer.Start();
            EmitState("state", $"宿主窗口已定位到目标区域，等待 {_revealTimer.Interval}ms 后显现。", CurrentRect);
        }
        else
        {
            _revealTimer.Stop();
            Opacity = 0;
            ParkHostWindow();
            EmitState("hidden", "宿主窗口已隐藏并停放到屏幕外。", CurrentRect);
        }

        _hostVisible = shouldShow;
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            // WS_EX_TOOLWINDOW: hide from taskbar and Alt+Tab list.
            cp.ExStyle |= 0x00000080;
            return cp;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _revealTimer.Stop();
            _revealTimer.Dispose();
            _stateTimer.Stop();
            _stateTimer.Dispose();
            DisconnectRdp();
        }

        base.Dispose(disposing);
    }

    private void EnsureRdpHost()
    {
        if (_rdpHost is not null)
        {
            return;
        }

        try
        {
            _rdpHost = new RdpActiveXHost
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Black,
            };

            _panel.Controls.Add(_rdpHost);
            _rdpHost.BringToFront();
            HideStatus();
            EmitState("control-created", "MsTscAx ActiveX 控件已创建。", CurrentRect);
        }
        catch (Exception ex)
        {
            ShowStatus("MsTscAx 创建失败", ex.Message, true);
            EmitState("error", $"创建 MsTscAx ActiveX 控件失败: {ex.Message}", CurrentRect);
        }
    }

    private void ConnectRdp()
    {
        if (_rdpHost is null || _init is null)
        {
            return;
        }

        try
        {
            if (!_rdpHost.TryGetOcxObject(out var client) || client is null)
            {
                if (!_waitingForOcxReady)
                {
                    _waitingForOcxReady = true;
                    HideStatus();
                    EmitState("state", "MsTscAx Ocx 尚未就绪，延迟发起 Connect。", CurrentRect);
                }
                return;
            }

            _waitingForOcxReady = false;
            var loginUser = string.IsNullOrWhiteSpace(_init.Domain)
                ? _init.Username
                : $"{_init.Domain}\\{_init.Username}";

            SetComProperty(client, "Server", _init.Host);
            SetComProperty(client, "UserName", loginUser);

            if (_init.Width is int width && width > 0)
            {
                SetComProperty(client, "DesktopWidth", width);
            }

            if (_init.Height is int height && height > 0)
            {
                SetComProperty(client, "DesktopHeight", height);
            }

            SetComProperty(client, "ColorDepth", 32);

            if (TryGetComProperty(client, "AdvancedSettings9") is { } advanced9)
            {
                TrySetComProperty(advanced9, "SmartSizing", true);
                TrySetComProperty(advanced9, "EnableAutoReconnect", true);
                TrySetComProperty(advanced9, "RedirectDrives", false);
                TrySetComProperty(advanced9, "RedirectClipboard", true);
                // NLA-required hosts need CredSSP + security-layer negotiation enabled.
                TrySetComProperty(advanced9, "EnableCredSspSupport", true);
                TrySetComProperty(advanced9, "NegotiateSecurityLayer", true);
                TrySetComProperty(advanced9, "AuthenticationLevel", 2);
                TrySetComProperty(advanced9, "RDPPort", _init.Port);
                TrySetComProperty(advanced9, "ClearTextPassword", _init.Password);
            }
            else if (TryGetComProperty(client, "AdvancedSettings2") is { } advanced2)
            {
                TrySetComProperty(advanced2, "SmartSizing", true);
                TrySetComProperty(advanced2, "EnableCredSspSupport", true);
                TrySetComProperty(advanced2, "NegotiateSecurityLayer", true);
                TrySetComProperty(advanced2, "AuthenticationLevel", 2);
                TrySetComProperty(advanced2, "RDPPort", _init.Port);
                TrySetComProperty(advanced2, "ClearTextPassword", _init.Password);
            }

            if (TryGetComProperty(client, "SecuredSettings2") is { } secured)
            {
                TrySetComProperty(secured, "KeyboardHookMode", 1);
            }

            InvokeComMethod(client, "Connect");
            _connectIssued = true;
            HideStatus();
            EmitState("connecting", $"MsTscAx 正在连接 {_init.Host}:{_init.Port}", CurrentRect);
        }
        catch (Exception ex)
        {
            ShowStatus("RDP 连接失败", ex.Message, true);
            EmitState("error", $"MsTscAx Connect 调用失败: {ex.Message}", CurrentRect);
        }
    }

    private void DisconnectRdp()
    {
        if (_rdpHost is null || _rdpHost.IsDisposed)
        {
            return;
        }

        try
        {
            if (!_rdpHost.TryGetOcxObject(out var client) || client is null)
            {
                return;
            }
            var connected = ReadConnectedState(client);
            if (connected != 0)
            {
                InvokeComMethod(client, "Disconnect");
            }
        }
        catch
        {
        }
    }

    private void ApplyDisplayLayout(NativeHostRectPayload rect)
    {
        if (_rdpHost is null || _rdpHost.IsDisposed)
        {
            return;
        }

        try
        {
            if (!_rdpHost.TryGetOcxObject(out var client) || client is null)
            {
                return;
            }

            var targetWidth = Math.Max(1, rect.Width);
            var targetHeight = Math.Max(1, rect.Height);

            TrySetComProperty(client, "DesktopWidth", targetWidth);
            TrySetComProperty(client, "DesktopHeight", targetHeight);

            if (TryGetComProperty(client, "AdvancedSettings9") is { } advanced9)
            {
                TrySetComProperty(advanced9, "SmartSizing", true);
            }
            else if (TryGetComProperty(client, "AdvancedSettings2") is { } advanced2)
            {
                TrySetComProperty(advanced2, "SmartSizing", true);
            }

            var connected = ReadConnectedState(client);
            if (connected == 1)
            {
                // Prefer dynamic display update when available so the remote desktop
                // resizes to the current tab content area instead of staying at the
                // initial connection resolution.
                var updated = TryInvokeComMethod(
                    client,
                    "UpdateSessionDisplaySettings",
                    targetWidth,
                    targetHeight,
                    targetWidth,
                    targetHeight,
                    0,
                    100,
                    100);

                if (!updated)
                {
                    TryInvokeComMethod(client, "Reconnect", targetWidth, targetHeight);
                }
            }
        }
        catch (Exception ex)
        {
            EmitState("state", $"应用显示尺寸失败: {ex.Message}", rect);
        }
    }

    private void PollConnectionState()
    {
        if (_rdpHost is null || _rdpHost.IsDisposed)
        {
            return;
        }

        try
        {
            if (!_connectIssued)
            {
                ConnectRdp();
                if (!_connectIssued)
                {
                    return;
                }
            }

            if (!_rdpHost.TryGetOcxObject(out var client) || client is null)
            {
                return;
            }

            var state = ReadConnectedState(client);
            if (_lastConnectedState == state)
            {
                return;
            }

            _lastConnectedState = state;
            switch (state)
            {
                case 0:
                    if (_connectIssued)
                    {
                        HideStatus();
                        UpdateHostVisibility();
                        EmitState("disconnected", "MsTscAx 会话已断开。", CurrentRect);
                    }
                    break;
                case 1:
                    _statusPanel.Visible = false;
                    UpdateHostVisibility();
                    EmitState("connected", "MsTscAx 会话已连接。", CurrentRect);
                    break;
                case 2:
                    HideStatus();
                    UpdateHostVisibility();
                    EmitState("connecting", "MsTscAx 正在建立连接。", CurrentRect);
                    break;
                default:
                    UpdateHostVisibility();
                    EmitState("state", $"MsTscAx 当前连接状态值: {state}", CurrentRect);
                    break;
            }
        }
        catch (Exception ex)
        {
            ShowStatus("状态轮询失败", ex.Message, true);
            EmitState("error", $"读取 MsTscAx 连接状态失败: {ex.Message}", CurrentRect);
        }
    }

    private void ShowStatus(string title, string detail, bool isError)
    {
        _titleLabel.Text = title;
        _detailLabel.Text = detail;
        _statusPanel.BackColor = isError ? Color.FromArgb(66, 20, 20) : Color.FromArgb(20, 26, 42);
        _statusPanel.Visible = true;
        _statusPanel.BringToFront();
    }

    private void HideStatus()
    {
        _statusPanel.Visible = false;
    }

    private void EmitState(string type, string detail, NativeHostRectPayload? rect)
    {
        _emit(new SidecarOutboundMessage
        {
            Type = type,
            Detail = detail,
            Rect = rect,
        });
    }

    private static int ReadConnectedState(object client)
    {
        var value = TryGetComProperty(client, "Connected");
        return value switch
        {
            short shortValue => shortValue,
            int intValue => intValue,
            _ => 0,
        };
    }

    private static object? TryGetComProperty(object target, string propertyName)
    {
        try
        {
            return target.GetType().InvokeMember(propertyName, BindingFlags.GetProperty, null, target, null);
        }
        catch
        {
            return null;
        }
    }

    private static void SetComProperty(object target, string propertyName, object? value)
    {
        if (!TrySetComProperty(target, propertyName, value))
        {
            throw new InvalidOperationException($"ActiveX 属性设置失败: {propertyName}");
        }
    }

    private static bool TrySetComProperty(object target, string propertyName, object? value)
    {
        try
        {
            target.GetType().InvokeMember(propertyName, BindingFlags.SetProperty, null, target, new[] { value });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void InvokeComMethod(object target, string methodName)
    {
        target.GetType().InvokeMember(methodName, BindingFlags.InvokeMethod, null, target, null);
    }

    private static bool TryInvokeComMethod(object target, string methodName, params object?[] args)
    {
        try
        {
            target.GetType().InvokeMember(methodName, BindingFlags.InvokeMethod, null, target, args);
            return true;
        }
        catch
        {
            return false;
        }
    }
}

internal sealed class RdpActiveXHost : AxHost
{
    private static readonly string[] ProgIds =
    [
        "MsTscAx.MsTscAx",
        "MsRdpClient11NotSafeForScripting",
        "MsRdpClient10NotSafeForScripting",
        "MsRdpClient9NotSafeForScripting",
    ];

    public RdpActiveXHost()
        : base(ResolveClsid())
    {
    }

    public bool TryGetOcxObject(out object? ocx)
    {
        ocx = null;
        try
        {
            ocx = GetOcx();
            return ocx is not null;
        }
        catch
        {
            return false;
        }
    }

    private static string ResolveClsid()
    {
        foreach (var progId in ProgIds)
        {
            var type = Type.GetTypeFromProgID(progId, throwOnError: false);
            if (type is not null)
            {
                return type.GUID.ToString("B");
            }
        }

        throw new InvalidOperationException("当前系统未注册 Microsoft RDP ActiveX (MsTscAx)。");
    }
}

internal static class NativeMethods
{
    public const int GWLP_HWNDPARENT = -8;
    public const int GWL_STYLE = -16;
    public const long WS_CHILD = 0x40000000L;
    public const long WS_POPUP = unchecked((int)0x80000000L);
    public static readonly IntPtr HWND_TOP = new IntPtr(0);
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const int SW_SHOW = 5;
    public const int SW_HIDE = 0;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);
}

internal sealed class SidecarInboundMessage
{
    public string Type { get; set; } = string.Empty;
    public SidecarInitPayload? Init { get; set; }
    public NativeHostRectPayload? Rect { get; set; }
}

internal sealed class SidecarOutboundMessage
{
    public string Type { get; set; } = string.Empty;
    public string? Detail { get; set; }
    public NativeHostRectPayload? Rect { get; set; }
}

internal sealed class SidecarInitPayload
{
    public string SessionId { get; set; } = string.Empty;
    public long ParentHwnd { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; }
    public string Username { get; set; } = string.Empty;
    public string? Password { get; set; }
    public string? Domain { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
}

internal sealed class NativeHostRectPayload
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public double ScaleFactor { get; set; }
}