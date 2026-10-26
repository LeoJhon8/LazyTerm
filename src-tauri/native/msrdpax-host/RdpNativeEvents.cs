using System.Runtime.InteropServices;

namespace LazyTerm.MsRdpAxHost;

// IMsTscAxEvents is a dispinterface. Subscribe only to notifications: no callback
// here supplies authentication, trust, close or reconnection decisions.
internal sealed class RdpNativeEvents : IDisposable
{
    private static readonly Guid EventInterface = new("336D5562-EFA8-482E-8CB3-C5C0FC7A7DB6");
    private readonly object _client;
    private readonly List<(int Id, Delegate Handler)> _handlers = [];

    public RdpNativeEvents(object client, Action<int, int?> notify)
    {
        _client = client;
        try
        {
            Subscribe(3, new Action(() => notify(3, null))); // OnLoginComplete
            Subscribe(4, new Action<int>(code => notify(4, code))); // OnDisconnected
            Subscribe(10, new Action<int>(code => notify(10, code))); // OnFatalError
            Subscribe(11, new Action<int>(code => notify(11, code))); // OnWarning
            Subscribe(18, new Action(() => notify(18, null))); // OnAuthenticationWarningDisplayed
            Subscribe(19, new Action(() => notify(19, null))); // OnAuthenticationWarningDismissed
            Subscribe(22, new Action<int>(code => notify(22, code))); // OnLogonError
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    private void Subscribe(int id, Delegate handler)
    {
        ComEventsHelper.Combine(_client, EventInterface, id, handler);
        _handlers.Add((id, handler));
    }

    public void Dispose()
    {
        foreach (var (id, handler) in _handlers)
        {
            try
            {
                ComEventsHelper.Remove(_client, EventInterface, id, handler);
            }
            catch (COMException)
            {
                // The control may already have disconnected its event source.
            }
            catch (InvalidComObjectException)
            {
                // AxHost may have released the RCW during window teardown.
            }
        }
        _handlers.Clear();
    }
}

// UIParentWindowHandle is not an IDispatch property. Its IUnknown vtable follows
// 10 IMsTscNonScriptable slots and 2 IMsRdpClientNonScriptable slots.
[ComImport]
[Guid("17A5E535-4072-4FA4-AF32-C8D0D47345E9")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMsRdpClientNonScriptable2
{
    void _VtblGap1_12();
    void SetUIParentWindowHandle(IntPtr parent);
    IntPtr GetUIParentWindowHandle();
}
