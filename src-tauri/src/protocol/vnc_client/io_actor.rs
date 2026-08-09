use parking_lot::RwLock;
use std::ffi::{c_char, c_int, CStr, CString};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Once};
use std::time::Instant;
use tokio::sync::{mpsc, oneshot};

use super::super::vnc_ffi as ffi;
use super::callbacks::{
    password_for_session, register_session, unregister_session, CallbackEvent, SessionContext,
};
use super::client::{VncClientConfig, VncConnectionState};
use super::frame::FrameBuffer;
use super::{VncEncoding, VncError, VncResult};

const VNC_IO_COMMAND_CAPACITY: usize = 256;
const VNC_IO_COMMAND_BATCH: usize = 64;
const VNC_WAIT_FOR_MESSAGE_TIMEOUT_US: u32 = 5_000;
const VNC_ENABLE_DIAGNOSTIC_LOGS: bool = false;
const VNC_SLOW_MESSAGE_TOTAL_MS: u128 = 30;
const VNC_SLOW_MESSAGE_HANDLE_MS: u128 = 20;

static VNC_GLOBAL_INIT: Once = Once::new();

pub(crate) type IoReply<T> = oneshot::Sender<VncResult<T>>;

pub(crate) enum VncIoCommand {
    Pointer {
        x: u16,
        y: u16,
        button_mask: u8,
        reply: IoReply<()>,
    },
    Key {
        keysym: u32,
        down: bool,
        reply: IoReply<()>,
    },
    KeySequence {
        key_syms: Vec<u32>,
        reply: IoReply<()>,
    },
    PasteClipboard {
        text: String,
        key_sym: u32,
        modifier_key_syms: Vec<u32>,
        reply: IoReply<()>,
    },
    TypeText {
        key_syms: Vec<u32>,
        modifier_key_syms: Vec<u32>,
        reply: IoReply<()>,
    },
    RequestUpdate {
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        incremental: bool,
        reply: IoReply<()>,
    },
    ResizeDesktop {
        width: u16,
        height: u16,
        reply: IoReply<bool>,
    },
    Close,
}

pub(crate) struct VncActorShared {
    pub state: RwLock<VncConnectionState>,
    pub framebuffer: FrameBuffer,
    pub closed: AtomicBool,
}

impl VncActorShared {
    pub(crate) fn new() -> Self {
        Self {
            state: RwLock::new(VncConnectionState::Disconnected),
            framebuffer: FrameBuffer::new(1, 1),
            closed: AtomicBool::new(false),
        }
    }
}

pub(crate) async fn spawn_vnc_io_actor(
    config: VncClientConfig,
    shared: Arc<VncActorShared>,
) -> VncResult<(
    mpsc::Sender<VncIoCommand>,
    mpsc::UnboundedReceiver<CallbackEvent>,
)> {
    let (command_tx, command_rx) = mpsc::channel(VNC_IO_COMMAND_CAPACITY);
    let (event_tx, event_rx) = mpsc::unbounded_channel();
    let (ready_tx, ready_rx) = oneshot::channel();

    *shared.state.write() = VncConnectionState::Connecting;
    shared.closed.store(false, Ordering::SeqCst);

    std::thread::Builder::new()
        .name("vnc-io-actor".to_string())
        .spawn(move || run_actor(config, shared, command_rx, event_tx, ready_tx))
        .map_err(|error| VncError::FfiError(format!("Failed to start VNC I/O actor: {error}")))?;

    ready_rx
        .await
        .map_err(|_| VncError::FfiError("VNC I/O actor stopped during startup".to_string()))??;

    Ok((command_tx, event_rx))
}

fn run_actor(
    config: VncClientConfig,
    shared: Arc<VncActorShared>,
    mut command_rx: mpsc::Receiver<VncIoCommand>,
    event_tx: mpsc::UnboundedSender<CallbackEvent>,
    ready_tx: oneshot::Sender<VncResult<()>>,
) {
    let mut native = match NativeVncClient::connect(&config, &shared, event_tx.clone()) {
        Ok(native) => {
            *shared.state.write() = VncConnectionState::Connected;
            let _ = ready_tx.send(Ok(()));
            native
        }
        Err(error) => {
            *shared.state.write() = VncConnectionState::Error;
            let _ = ready_tx.send(Err(error));
            return;
        }
    };

    let mut normal_close = false;
    'actor: loop {
        for _ in 0..VNC_IO_COMMAND_BATCH {
            match command_rx.try_recv() {
                Ok(VncIoCommand::Close) => {
                    normal_close = true;
                    break 'actor;
                }
                Ok(command) => {
                    if let Some(reason) = native.handle_command(command) {
                        let _ = event_tx.send(CallbackEvent::ConnectionClosed { reason });
                        break 'actor;
                    }
                }
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    normal_close = true;
                    break 'actor;
                }
            }
        }

        if shared.closed.load(Ordering::SeqCst) {
            normal_close = true;
            break;
        }

        match native.handle_server_message(&config) {
            Ok(true) => {
                if event_tx.send(CallbackEvent::ServerMessageHandled).is_err() {
                    normal_close = true;
                    break;
                }
            }
            Ok(false) => {}
            Err(error) => {
                let _ = event_tx.send(CallbackEvent::ConnectionClosed {
                    reason: error.to_string(),
                });
                break;
            }
        }
    }

    drop(native);
    *shared.state.write() = if normal_close {
        VncConnectionState::Disconnected
    } else {
        VncConnectionState::Error
    };
}

struct NativeVncClient {
    client: *mut ffi::RfbClient,
    _context: Arc<SessionContext>,
}

impl NativeVncClient {
    fn connect(
        config: &VncClientConfig,
        shared: &VncActorShared,
        event_sender: mpsc::UnboundedSender<CallbackEvent>,
    ) -> VncResult<Self> {
        let host_cstring = CString::new(config.host.clone())
            .map_err(|_| VncError::FfiError("Invalid hostname".to_string()))?;
        let encodings_string = build_encodings_string(&config.encodings)?;

        unsafe {
            VNC_GLOBAL_INIT.call_once(|| {
                ffi::RfbClientRegisterIgnoreQemuExtension();
                ffi::RfbClientInstallLogCapture();
            });

            let client = ffi::rfbGetClient(8, 3, 4);
            if client.is_null() {
                return Err(VncError::MemoryAllocationFailed);
            }

            let context = Arc::new(SessionContext {
                event_sender,
                framebuffer: shared.framebuffer.clone(),
                password: config.password.clone(),
                encodings_string,
            });
            register_session(client as usize, Arc::downgrade(&context));

            ffi::RfbClientSetMallocFrameBuffer(
                client,
                super::callbacks::malloc_framebuffer_callback,
            );
            ffi::RfbClientSetGotFrameBufferUpdate(
                client,
                super::callbacks::framebuffer_update_callback,
            );
            ffi::RfbClientSetHandleCursorShape(
                client,
                super::callbacks::handle_cursor_shape_callback,
            );
            ffi::RfbClientSetGotXCutText(client, super::callbacks::got_xcut_text_callback);
            ffi::RfbClientSetGotCursorPos(client, super::callbacks::got_cursor_pos_callback);
            ffi::RfbClientSetGetPassword(client, get_password_callback);
            ffi::RfbClientSetShared(client, u8::from(config.shared));
            ffi::RfbClientSetViewOnly(client, u8::from(config.view_only));
            ffi::RfbClientSetEnableJpeg(client, u8::from(config.allow_jpeg));
            ffi::RfbClientSetUseRemoteCursor(client, u8::from(config.use_remote_cursor));
            ffi::RfbClientSetHandleNewFBSize(client, u8::from(config.handle_new_fb_size));
            ffi::RfbClientSetConnectTimeout(client, config.connect_timeout_secs);
            ffi::RfbClientSetReadTimeout(client, config.read_timeout_secs);
            ffi::RfbClientSetCompressLevel(client, config.compression_level as c_int);
            ffi::RfbClientSetQualityLevel(client, config.jpeg_quality as c_int);
            ffi::RfbClientSetServerHost(client, host_cstring.as_ptr());
            ffi::RfbClientSetServerPort(client, config.port as c_int);

            if let Some(encodings) = context.encodings_string.as_ref() {
                ffi::RfbClientSetEncodingsString(client, encodings.as_ptr());
            }

            *shared.state.write() = VncConnectionState::Authenticating;
            ffi::RfbClientSetLastError(client, ptr::null());
            if ffi::rfbInitClient(client, ptr::null_mut(), ptr::null_mut()) == 0 {
                let last_error = read_last_error(client);
                unregister_session(client as usize);
                return Err(VncError::ConnectionFailed(
                    last_error.unwrap_or_else(|| "Failed to initialize VNC client".to_string()),
                ));
            }

            Ok(Self {
                client,
                _context: context,
            })
        }
    }

    fn handle_command(&mut self, command: VncIoCommand) -> Option<String> {
        match command {
            VncIoCommand::Pointer {
                x,
                y,
                button_mask,
                reply,
            } => reply_result(reply, self.send_pointer(x, y, button_mask)),
            VncIoCommand::Key {
                keysym,
                down,
                reply,
            } => reply_result(reply, self.send_key(keysym, down)),
            VncIoCommand::KeySequence { key_syms, reply } => {
                reply_result(reply, self.send_key_sequence(&key_syms))
            }
            VncIoCommand::PasteClipboard {
                text,
                key_sym,
                modifier_key_syms,
                reply,
            } => reply_result(
                reply,
                self.paste_clipboard(&text, key_sym, &modifier_key_syms),
            ),
            VncIoCommand::TypeText {
                key_syms,
                modifier_key_syms,
                reply,
            } => reply_result(reply, self.type_text(&key_syms, &modifier_key_syms)),
            VncIoCommand::RequestUpdate {
                x,
                y,
                width,
                height,
                incremental,
                reply,
            } => reply_result(reply, self.request_update(x, y, width, height, incremental)),
            VncIoCommand::ResizeDesktop {
                width,
                height,
                reply,
            } => reply_result(reply, self.resize_desktop(width, height)),
            VncIoCommand::Close => None,
        }
    }

    fn handle_server_message(&mut self, config: &VncClientConfig) -> VncResult<bool> {
        unsafe {
            let total_started_at = Instant::now();
            let wait_started_at = Instant::now();
            let result = ffi::WaitForMessage(self.client, VNC_WAIT_FOR_MESSAGE_TIMEOUT_US);
            let wait_elapsed = wait_started_at.elapsed();

            if result < 0 {
                return Err(VncError::NetworkError("Connection closed".to_string()));
            }
            if result == 0 {
                return Ok(false);
            }

            let handle_started_at = Instant::now();
            let handled = ffi::HandleRFBServerMessage(self.client);
            let handle_elapsed = handle_started_at.elapsed();
            let total_elapsed = total_started_at.elapsed();
            if VNC_ENABLE_DIAGNOSTIC_LOGS
                && (total_elapsed.as_millis() >= VNC_SLOW_MESSAGE_TOTAL_MS
                    || handle_elapsed.as_millis() >= VNC_SLOW_MESSAGE_HANDLE_MS)
            {
                let scope = format!("VNC/client/{}:{}/message", config.host, config.port);
                crate::logging::info(
                    &scope,
                    format!(
                        "wait_ms={} handle_ms={} total_ms={} result={}",
                        wait_elapsed.as_millis(),
                        handle_elapsed.as_millis(),
                        total_elapsed.as_millis(),
                        result,
                    ),
                );
            }

            if handled == 0 {
                Err(VncError::ProtocolError(
                    "Failed to handle server message".to_string(),
                ))
            } else {
                Ok(true)
            }
        }
    }

    fn send_pointer(&mut self, x: u16, y: u16, button_mask: u8) -> VncResult<()> {
        unsafe {
            if ffi::SendPointerEvent(self.client, x as c_int, y as c_int, button_mask as c_int) == 0
            {
                Err(VncError::NetworkError(
                    "Failed to send pointer event".to_string(),
                ))
            } else {
                Ok(())
            }
        }
    }

    fn send_key(&mut self, keysym: u32, down: bool) -> VncResult<()> {
        unsafe {
            if ffi::SendKeyEvent(self.client, keysym, u8::from(down)) == 0 {
                Err(VncError::NetworkError(
                    "Failed to send key event".to_string(),
                ))
            } else {
                Ok(())
            }
        }
    }

    fn send_key_sequence(&mut self, key_syms: &[u32]) -> VncResult<()> {
        unsafe {
            for (index, key_sym) in key_syms.iter().enumerate() {
                if ffi::SendKeyEvent(self.client, *key_sym, 1) == 0 {
                    for pressed in key_syms[..index].iter().rev() {
                        let _ = ffi::SendKeyEvent(self.client, *pressed, 0);
                    }
                    return Err(VncError::NetworkError(
                        "Failed to press key in key sequence".to_string(),
                    ));
                }
            }
            for key_sym in key_syms.iter().rev() {
                if ffi::SendKeyEvent(self.client, *key_sym, 0) == 0 {
                    return Err(VncError::NetworkError(
                        "Failed to release key in key sequence".to_string(),
                    ));
                }
            }
        }
        Ok(())
    }

    fn paste_clipboard(
        &mut self,
        text: &str,
        key_sym: u32,
        modifier_key_syms: &[u32],
    ) -> VncResult<()> {
        let text_bytes = text.as_bytes();
        let text_len = c_int::try_from(text_bytes.len())
            .map_err(|_| VncError::ProtocolError("Clipboard text is too large".to_string()))?;

        unsafe {
            if ffi::SendClientCutText(self.client, text_bytes.as_ptr().cast::<c_char>(), text_len)
                == 0
            {
                return Err(VncError::NetworkError(
                    "Failed to send clipboard text".to_string(),
                ));
            }
            for modifier in modifier_key_syms {
                if ffi::SendKeyEvent(self.client, *modifier, 1) == 0 {
                    return Err(VncError::NetworkError(
                        "Failed to send clipboard modifier key".to_string(),
                    ));
                }
            }
            if ffi::SendKeyEvent(self.client, key_sym, 1) == 0
                || ffi::SendKeyEvent(self.client, key_sym, 0) == 0
            {
                return Err(VncError::NetworkError(
                    "Failed to send clipboard paste key".to_string(),
                ));
            }
            for modifier in modifier_key_syms.iter().rev() {
                if ffi::SendKeyEvent(self.client, *modifier, 0) == 0 {
                    return Err(VncError::NetworkError(
                        "Failed to release clipboard modifier key".to_string(),
                    ));
                }
            }
        }
        Ok(())
    }

    fn type_text(&mut self, key_syms: &[u32], modifier_key_syms: &[u32]) -> VncResult<()> {
        unsafe {
            for modifier in modifier_key_syms.iter().rev() {
                if ffi::SendKeyEvent(self.client, *modifier, 0) == 0 {
                    return Err(VncError::NetworkError(
                        "Failed to release text input modifier key".to_string(),
                    ));
                }
            }
            for key_sym in key_syms {
                if ffi::SendKeyEvent(self.client, *key_sym, 1) == 0
                    || ffi::SendKeyEvent(self.client, *key_sym, 0) == 0
                {
                    return Err(VncError::NetworkError(
                        "Failed to send typed text key event".to_string(),
                    ));
                }
            }
        }
        Ok(())
    }

    fn request_update(
        &mut self,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        incremental: bool,
    ) -> VncResult<()> {
        unsafe {
            if ffi::SendFramebufferUpdateRequest(
                self.client,
                x as c_int,
                y as c_int,
                width as c_int,
                height as c_int,
                u8::from(incremental),
            ) == 0
            {
                Err(VncError::NetworkError(
                    "Failed to send update request".to_string(),
                ))
            } else {
                Ok(())
            }
        }
    }

    fn resize_desktop(&mut self, width: u16, height: u16) -> VncResult<bool> {
        unsafe {
            if ffi::RfbClientSupportsDesktopResize(self.client) == 0 {
                return Ok(false);
            }
            if ffi::SendExtDesktopSize(self.client, width, height) == 0 {
                Err(VncError::NetworkError(
                    "Failed to request desktop resize".to_string(),
                ))
            } else {
                Ok(true)
            }
        }
    }
}

impl Drop for NativeVncClient {
    fn drop(&mut self) {
        unsafe {
            unregister_session(self.client as usize);
            ffi::rfbClientCleanup(self.client);
        }
    }
}

fn reply_result<T>(reply: IoReply<T>, result: VncResult<T>) -> Option<String> {
    let disconnect_reason = match result.as_ref() {
        Err(VncError::NetworkError(reason)) => Some(reason.clone()),
        Err(VncError::ProtocolError(reason)) => Some(reason.clone()),
        _ => None,
    };
    let _ = reply.send(result);
    disconnect_reason
}

fn build_encodings_string(encodings: &[VncEncoding]) -> VncResult<Option<CString>> {
    if encodings.is_empty() {
        return Ok(None);
    }

    let value = encodings
        .iter()
        .map(|encoding| match encoding {
            VncEncoding::Raw => "raw",
            VncEncoding::CopyRect => "copyrect",
            VncEncoding::Rre => "rre",
            VncEncoding::Hextile => "hextile",
            VncEncoding::Zlib => "zlib",
            VncEncoding::Tight => "tight",
            VncEncoding::ZlibHex => "zlibhex",
            VncEncoding::Zrle => "zrle",
            VncEncoding::OpenH264 => "openh264",
            VncEncoding::CursorPseudo => "cursor",
            VncEncoding::DesktopSizePseudo => "desktopsize",
        })
        .collect::<Vec<_>>()
        .join(" ");

    CString::new(value)
        .map(Some)
        .map_err(|_| VncError::FfiError("Invalid encodings string".to_string()))
}

unsafe extern "C" fn get_password_callback(client: *mut ffi::RfbClient) -> *mut c_char {
    let Some(password) = password_for_session(client as usize) else {
        return ptr::null_mut();
    };

    CString::new(password.replace('\0', ""))
        .map(|value| ffi::RfbClientDupCString(value.as_ptr()))
        .unwrap_or_else(|_| ptr::null_mut())
}

unsafe fn read_last_error(client: *mut ffi::RfbClient) -> Option<String> {
    let error_ptr = ffi::RfbClientGetLastError(client);
    if error_ptr.is_null() {
        return None;
    }

    CStr::from_ptr(error_ptr)
        .to_str()
        .ok()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}
