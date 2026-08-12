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
                _hostForm.QueueRectUpdate(message.Rect);
                return;
            case "overlay":
                _hostForm.BeginInvoke(new Action(() => _hostForm.SetOverlayRect(message.Rect)));
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
    private readonly Panel _desktopSurface;
    private readonly HScrollBar _horizontalScrollBar;
    private readonly VScrollBar _verticalScrollBar;
    private readonly Panel _scrollCorner;
    private readonly Panel _statusPanel;
    private readonly Label _titleLabel;
    private readonly Label _detailLabel;
    private readonly Action<SidecarOutboundMessage> _emit;
    private readonly System.Windows.Forms.Timer _stateTimer;
    private readonly System.Windows.Forms.Timer _revealTimer;
    private readonly System.Windows.Forms.Timer _scrollBarVisibilityTimer;
    private RdpActiveXHost? _rdpHost;
    private SidecarInitPayload? _init;
    private IntPtr _parentHwnd;
    private int? _lastConnectedState;
    private bool _connectIssued;
    private bool _waitingForOcxReady;
    private bool _showRequested;
    private bool _hostVisible;
    private bool _hostWindowCreated;
    private long _lastAppliedGeneration = -1;
    private Size _remoteDesktopSize = Size.Empty;
    private bool _horizontalOverflow;
    private bool _verticalOverflow;
    private readonly object _rectUpdateLock = new();
    private NativeHostRectPayload? _pendingRect;
    private bool _rectUpdatePosted;
    private NativeHostRectPayload? _overlayRect;

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
        MinimumSize = Size.Empty;
        Opacity = 0;

        _panel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.Black,
        };

        _desktopSurface = new Panel
        {
            BackColor = Color.Black,
            Visible = false,
        };

        _horizontalScrollBar = new HScrollBar
        {
            Visible = false,
        };

        _verticalScrollBar = new VScrollBar
        {
            Visible = false,
        };

        _scrollCorner = new Panel
        {
            BackColor = SystemColors.Control,
            Visible = false,
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
        _panel.Controls.Add(_desktopSurface);
        _panel.Controls.Add(_horizontalScrollBar);
        _panel.Controls.Add(_verticalScrollBar);
        _panel.Controls.Add(_scrollCorner);
        _panel.Controls.Add(_statusPanel);
        Controls.Add(_panel);

        _panel.Resize += (_, _) => LayoutRemoteDesktop();
        _horizontalScrollBar.Scroll += (_, _) => LayoutRemoteDesktop();
        _verticalScrollBar.Scroll += (_, _) => LayoutRemoteDesktop();

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

        _scrollBarVisibilityTimer = new System.Windows.Forms.Timer { Interval = 75 };
        _scrollBarVisibilityTimer.Tick += (_, _) => UpdateScrollBarVisibility();
        _scrollBarVisibilityTimer.Start();
    }

    private bool InitializeRemoteDesktop(NativeHostRectPayload rect)
    {
        if (!_remoteDesktopSize.IsEmpty)
        {
            return true;
        }

        if (rect.Width <= 0 || rect.Height <= 0)
        {
            return false;
        }

        _remoteDesktopSize = new Size(
            Math.Clamp(rect.Width, 200, 8192),
            Math.Clamp(rect.Height, 200, 8192));
        _desktopSurface.Size = _remoteDesktopSize;
        _desktopSurface.Visible = true;
        LayoutRemoteDesktop();
        EmitState(
            "state",
            $"本次连接的远程桌面尺寸已锁定为 {_remoteDesktopSize.Width}x{_remoteDesktopSize.Height}。",
            rect);
        return true;
    }

    private void LayoutRemoteDesktop()
    {
        if (_remoteDesktopSize.IsEmpty || _panel.ClientSize.Width <= 0 || _panel.ClientSize.Height <= 0)
        {
            _horizontalOverflow = false;
            _verticalOverflow = false;
            _horizontalScrollBar.Visible = false;
            _verticalScrollBar.Visible = false;
            _scrollCorner.Visible = false;
            return;
        }

        var fullWidth = _panel.ClientSize.Width;
        var fullHeight = _panel.ClientSize.Height;
        var horizontalHeight = SystemInformation.HorizontalScrollBarHeight;
        var verticalWidth = SystemInformation.VerticalScrollBarWidth;
        _horizontalOverflow = _remoteDesktopSize.Width > fullWidth;
        _verticalOverflow = _remoteDesktopSize.Height > fullHeight;

        // Scroll bars are overlays and do not reduce the remote desktop viewport.
        // Otherwise one bar can consume enough space to incorrectly trigger the
        // other axis even though the remote desktop fits in that direction.
        var horizontalBarWidth = Math.Max(0, fullWidth - (_verticalOverflow ? verticalWidth : 0));
        var verticalBarHeight = Math.Max(0, fullHeight - (_horizontalOverflow ? horizontalHeight : 0));
        var horizontalBarY = Math.Max(0, fullHeight - horizontalHeight);
        var verticalBarX = Math.Max(0, fullWidth - verticalWidth);

        ConfigureScrollBar(_horizontalScrollBar, _horizontalOverflow, fullWidth, _remoteDesktopSize.Width);
        ConfigureScrollBar(_verticalScrollBar, _verticalOverflow, fullHeight, _remoteDesktopSize.Height);

        _horizontalScrollBar.Bounds = new Rectangle(0, horizontalBarY, horizontalBarWidth, horizontalHeight);
        _verticalScrollBar.Bounds = new Rectangle(verticalBarX, 0, verticalWidth, verticalBarHeight);
        _scrollCorner.Bounds = new Rectangle(verticalBarX, horizontalBarY, verticalWidth, horizontalHeight);

        var desktopX = _horizontalOverflow
            ? -_horizontalScrollBar.Value
            : Math.Max(0, (fullWidth - _remoteDesktopSize.Width) / 2);
        var desktopY = _verticalOverflow
            ? -_verticalScrollBar.Value
            : Math.Max(0, (fullHeight - _remoteDesktopSize.Height) / 2);
        _desktopSurface.Bounds = new Rectangle(
            desktopX,
            desktopY,
            _remoteDesktopSize.Width,
            _remoteDesktopSize.Height);

        _desktopSurface.Visible = true;
        _horizontalScrollBar.BringToFront();
        _verticalScrollBar.BringToFront();
        _scrollCorner.BringToFront();
        UpdateScrollBarVisibility();
        if (_statusPanel.Visible)
        {
            _statusPanel.BringToFront();
        }
    }

    private void UpdateScrollBarVisibility()
    {
        if (!IsHandleCreated || !_hostVisible || !_panel.IsHandleCreated)
        {
            _horizontalScrollBar.Visible = false;
            _verticalScrollBar.Visible = false;
            _scrollCorner.Visible = false;
            return;
        }

        var cursor = _panel.PointToClient(Cursor.Position);
        var clientBounds = _panel.ClientRectangle;
        var cursorInside = clientBounds.Contains(cursor);
        const int revealDistance = 32;
        const int keepVisibleDistance = 56;
        var horizontalDistance = _horizontalScrollBar.Visible ? keepVisibleDistance : revealDistance;
        var verticalDistance = _verticalScrollBar.Visible ? keepVisibleDistance : revealDistance;
        var showHorizontal = _horizontalOverflow
            && (_horizontalScrollBar.Capture
                || (cursorInside && cursor.Y >= clientBounds.Bottom - horizontalDistance));
        var showVertical = _verticalOverflow
            && (_verticalScrollBar.Capture
                || (cursorInside && cursor.X >= clientBounds.Right - verticalDistance));

        _horizontalScrollBar.Visible = showHorizontal;
        _verticalScrollBar.Visible = showVertical;
        _scrollCorner.Visible = showHorizontal && showVertical;
    }

    private static void ConfigureScrollBar(
        ScrollBar scrollBar,
        bool visible,
        int viewportSize,
        int contentSize)
    {
        if (!visible)
        {
            scrollBar.Visible = false;
            scrollBar.Value = 0;
            return;
        }

        var largeChange = Math.Max(1, viewportSize);
        var maximumOffset = Math.Max(0, contentSize - viewportSize);
        var nextValue = Math.Min(scrollBar.Value, maximumOffset);
        scrollBar.Value = 0;
        scrollBar.Minimum = 0;
        scrollBar.SmallChange = Math.Max(1, viewportSize / 10);
        scrollBar.LargeChange = largeChange;
        scrollBar.Maximum = maximumOffset + largeChange - 1;
        scrollBar.Value = nextValue;
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
        if (!_hostWindowCreated)
        {
            Show();
            _hostWindowCreated = true;
        }
        ParkHostWindow();
        _hostVisible = false;
    }

    public void QueueRectUpdate(NativeHostRectPayload rect)
    {
        lock (_rectUpdateLock)
        {
            if (_pendingRect is { } pending)
            {
                var pendingGeneration = pending.Generation ?? -1;
                var nextGeneration = rect.Generation ?? -1;
                if (nextGeneration < pendingGeneration)
                {
                    return;
                }
            }

            _pendingRect = rect;
            if (_rectUpdatePosted)
            {
                return;
            }
            _rectUpdatePosted = true;
        }

        BeginInvoke(new Action(ApplyPendingRect));
    }

    private void ApplyPendingRect()
    {
        NativeHostRectPayload? rect;
        lock (_rectUpdateLock)
        {
            rect = _pendingRect;
            _pendingRect = null;
            _rectUpdatePosted = false;
        }

        if (rect is not null)
        {
            UpdateRect(rect);
        }

        lock (_rectUpdateLock)
        {
            if (_pendingRect is null || _rectUpdatePosted)
            {
                return;
            }
            _rectUpdatePosted = true;
        }
        BeginInvoke(new Action(ApplyPendingRect));
    }

    private void UpdateRect(NativeHostRectPayload rect)
    {
        if (rect.Generation is long generation && generation < _lastAppliedGeneration)
        {
            return;
        }
        if (rect.Generation is long nextGeneration)
        {
            _lastAppliedGeneration = nextGeneration;
        }

        CurrentRect = rect;
        var desktopInitialized = InitializeRemoteDesktop(rect);
        if (_hostVisible)
        {
            ApplyHostWindowRect(rect);
        }

        LayoutRemoteDesktop();
        if (desktopInitialized && !_connectIssued)
        {
            ConnectRdp();
        }
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
        var hostWidth = Math.Max(0, rect.Width);
        var hostHeight = Math.Max(0, rect.Height);
        if (!_remoteDesktopSize.IsEmpty)
        {
            hostWidth = Math.Min(hostWidth, _remoteDesktopSize.Width);
            hostHeight = Math.Min(hostHeight, _remoteDesktopSize.Height);
        }

        var hostX = rect.X + Math.Max(0, (rect.Width - hostWidth) / 2);
        var hostY = rect.Y + Math.Max(0, (rect.Height - hostHeight) / 2);
        NativeMethods.SetWindowPos(
            Handle,
            NativeMethods.HWND_TOP,
            hostX,
            hostY,
            hostWidth,
            hostHeight,
            NativeMethods.SWP_NOACTIVATE
                | NativeMethods.SWP_NOZORDER
                | NativeMethods.SWP_NOOWNERZORDER);
        ApplyOverlayRegion(hostX, hostY, hostWidth, hostHeight);
    }

    public void SetOverlayRect(NativeHostRectPayload? rect)
    {
        _overlayRect = rect;
        ApplyOverlayRegion(Left, Top, Width, Height);
    }

    private void ApplyOverlayRegion(int hostX, int hostY, int hostWidth, int hostHeight)
    {
        if (_overlayRect is null || hostWidth <= 0 || hostHeight <= 0)
        {
            NativeMethods.SetWindowRgn(Handle, IntPtr.Zero, true);
            return;
        }

        var hostBounds = new Rectangle(hostX, hostY, hostWidth, hostHeight);
        var overlayBounds = new Rectangle(
            _overlayRect.X,
            _overlayRect.Y,
            Math.Max(0, _overlayRect.Width),
            Math.Max(0, _overlayRect.Height));
        var overlap = Rectangle.Intersect(hostBounds, overlayBounds);
        if (overlap.IsEmpty)
        {
            NativeMethods.SetWindowRgn(Handle, IntPtr.Zero, true);
            return;
        }

        var windowRegion = NativeMethods.CreateRectRgn(0, 0, hostWidth, hostHeight);
        var overlayRegion = NativeMethods.CreateRectRgn(
            overlap.Left - hostX,
            overlap.Top - hostY,
            overlap.Right - hostX,
            overlap.Bottom - hostY);
        if (windowRegion == IntPtr.Zero || overlayRegion == IntPtr.Zero)
        {
            if (windowRegion != IntPtr.Zero)
            {
                NativeMethods.DeleteObject(windowRegion);
            }
            if (overlayRegion != IntPtr.Zero)
            {
                NativeMethods.DeleteObject(overlayRegion);
            }
            return;
        }

        NativeMethods.CombineRgn(
            windowRegion,
            windowRegion,
            overlayRegion,
            NativeMethods.RGN_DIFF);
        NativeMethods.DeleteObject(overlayRegion);
        if (NativeMethods.SetWindowRgn(Handle, windowRegion, true) == 0)
        {
            NativeMethods.DeleteObject(windowRegion);
        }
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
            cp.Style |= NativeMethods.WS_CLIPCHILDREN | NativeMethods.WS_CLIPSIBLINGS;
            return cp;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _scrollBarVisibilityTimer.Stop();
            _scrollBarVisibilityTimer.Dispose();
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

            _desktopSurface.Controls.Add(_rdpHost);
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
        if (_rdpHost is null || _init is null || _remoteDesktopSize.IsEmpty)
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

            SetComProperty(client, "DesktopWidth", _remoteDesktopSize.Width);
            SetComProperty(client, "DesktopHeight", _remoteDesktopSize.Height);

            SetComProperty(client, "ColorDepth", 32);

            if (TryGetComProperty(client, "AdvancedSettings9") is { } advanced9)
            {
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
                if (_remoteDesktopSize.IsEmpty)
                {
                    return;
                }
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
    public const int WS_CLIPCHILDREN = 0x02000000;
    public const int WS_CLIPSIBLINGS = 0x04000000;
    public static readonly IntPtr HWND_TOP = new IntPtr(0);
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_NOOWNERZORDER = 0x0200;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public const int RGN_DIFF = 4;
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

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool bRedraw);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern int CombineRgn(IntPtr destination, IntPtr source1, IntPtr source2, int combineMode);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern bool DeleteObject(IntPtr objectHandle);

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
}

internal sealed class NativeHostRectPayload
{
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public double ScaleFactor { get; set; }
    public long? Generation { get; set; }
}
