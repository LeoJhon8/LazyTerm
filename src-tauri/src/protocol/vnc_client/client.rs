//! VNC 客户端主模块
//!
//! 提供安全的、异步的 VNC 客户端 API

use parking_lot::{Mutex, RwLock};
use std::ffi::{c_char, c_int, c_void, CString};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Instant;
use tokio::task;

use super::super::vnc_ffi as ffi;
use super::callbacks::{register_session, unregister_session, CallbackEvent, SessionContext};
use super::frame::{FrameBuffer, FrameUpdateRegion};
use super::{MouseButton, VncEncoding, VncError, VncResult};

/// VNC 连接状态
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VncConnectionState {
    Disconnected,
    Connecting,
    Authenticating,
    Connected,
    Error,
}

/// VNC 客户端配置
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct VncClientConfig {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub shared: bool,
    pub allow_jpeg: bool,
    pub use_remote_cursor: bool,
    pub handle_new_fb_size: bool,
    pub jpeg_quality: u8,      // 0-9
    pub compression_level: u8, // 0-9
    pub encodings: Vec<super::VncEncoding>,
}

impl Default for VncClientConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 5900,
            password: None,
            shared: true,
            allow_jpeg: true,
            use_remote_cursor: false,
            handle_new_fb_size: true,
            jpeg_quality: 8,
            compression_level: 6,
            encodings: vec![
                VncEncoding::CopyRect,
                VncEncoding::Hextile,
                VncEncoding::Rre,
                VncEncoding::Raw,
            ],
        }
    }
}

/// VNC 客户端
///
/// 线程安全的 VNC 客户端，所有操作都是异步的
pub struct VncClient {
    inner: Arc<VncClientInner>,
}

struct VncClientInner {
    config: RwLock<VncClientConfig>,
    state: RwLock<VncConnectionState>,
    raw_client: Mutex<Option<usize>>, // 存储 *mut RfbClient 作为 usize
    io_lock: Mutex<()>,
    context: Mutex<Option<Arc<SessionContext>>>,
    framebuffer: FrameBuffer,
    closed: AtomicBool,
}

static PASSWORD_DATA_TAG: u8 = 0;

fn password_data_tag() -> *mut c_void {
    (&PASSWORD_DATA_TAG as *const u8).cast_mut().cast()
}

unsafe extern "C" fn get_password_callback(client: *mut ffi::RfbClient) -> *mut c_char {
    let password_ptr = ffi::rfbClientGetClientData(client, password_data_tag());
    if password_ptr.is_null() {
        return ptr::null_mut();
    }

    let password = &*(password_ptr as *const String);
    CString::new(password.replace('\0', ""))
        .map(|value| ffi::RfbClientDupCString(value.as_ptr()))
        .unwrap_or_else(|_| ptr::null_mut())
}

unsafe fn clear_password_data(client: *mut ffi::RfbClient) {
    let password_ptr = ffi::rfbClientGetClientData(client, password_data_tag());
    if !password_ptr.is_null() {
        drop(Box::from_raw(password_ptr as *mut String));
        ffi::rfbClientSetClientData(client, password_data_tag(), ptr::null_mut());
    }
}

impl VncClient {
    /// 创建新的 VNC 客户端实例
    pub fn new(config: VncClientConfig) -> Self {
        let framebuffer = FrameBuffer::new(1, 1);

        Self {
            inner: Arc::new(VncClientInner {
                config: RwLock::new(config),
                state: RwLock::new(VncConnectionState::Disconnected),
                raw_client: Mutex::new(None),
                io_lock: Mutex::new(()),
                context: Mutex::new(None),
                framebuffer,
                closed: AtomicBool::new(false),
            }),
        }
    }

    /// 连接到 VNC 服务器
    ///
    /// 此操作是阻塞的，应该在 spawn_blocking 中调用
    pub async fn connect(&self) -> VncResult<Receiver<CallbackEvent>> {
        // 检查当前状态
        {
            let state = self.inner.state.read();
            if *state != VncConnectionState::Disconnected {
                return Err(VncError::InvalidStateTransition {
                    current: format!("{:?}", *state),
                    target: "Connecting".to_string(),
                });
            }
        }

        let inner = self.inner.clone();

        // 在阻塞线程中执行连接
        task::spawn_blocking(move || Self::do_connect(inner))
            .await
            .map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    /// 执行实际的连接（阻塞）
    fn do_connect(inner: Arc<VncClientInner>) -> VncResult<Receiver<CallbackEvent>> {
        let config = inner.config.read().clone();

        *inner.state.write() = VncConnectionState::Connecting;

        unsafe {
            ffi::RfbClientRegisterIgnoreQemuExtension();

            // 创建客户端
            let client = ffi::rfbGetClient(8, 3, 4); // bitsPerSample, samplesPerPixel, bytesPerPixel
            if client.is_null() {
                *inner.state.write() = VncConnectionState::Error;
                return Err(VncError::MemoryAllocationFailed);
            }

            let (event_sender, event_receiver) = std::sync::mpsc::channel::<CallbackEvent>();
            let context = Arc::new(SessionContext {
                event_sender,
                framebuffer: inner.framebuffer.clone(),
            });
            let client_ptr = client as usize;

            register_session(client_ptr, Arc::downgrade(&context));

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
            ffi::RfbClientSetShared(client, if config.shared { 1 } else { 0 });
            ffi::RfbClientSetEnableJpeg(client, if config.allow_jpeg { 1 } else { 0 });
            ffi::RfbClientSetUseRemoteCursor(client, if config.use_remote_cursor { 1 } else { 0 });
            ffi::RfbClientSetHandleNewFBSize(client, if config.handle_new_fb_size { 1 } else { 0 });
            ffi::RfbClientSetCompressLevel(client, config.compression_level as c_int);
            ffi::RfbClientSetQualityLevel(client, config.jpeg_quality as c_int);

            // 配置客户端
            // 注意：这些设置需要在 rfbInitClient 之前完成
            // 这里我们使用命令行参数方式初始化

            // 构建参数
            let mut argv_args: Vec<CString> = Vec::new();
            let mut owned_cstrings: Vec<CString> = Vec::new();

            // 程序名
            argv_args.push(CString::new("vnc_client").unwrap());

            // 共享标志
            if config.shared {
                argv_args.push(CString::new("-shared").unwrap());
            }

            // 编码
            if !config.encodings.is_empty() {
                let encodings_str = config
                    .encodings
                    .iter()
                    .map(|e| match e {
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
                let encodings_cstring = CString::new(encodings_str)
                    .map_err(|_| VncError::FfiError("Invalid encodings string".to_string()))?;
                ffi::RfbClientSetEncodingsString(client, encodings_cstring.as_ptr());
                owned_cstrings.push(encodings_cstring);
            }

            // 压缩级别
            argv_args.push(CString::new("-compress").unwrap());
            argv_args.push(CString::new(config.compression_level.to_string()).unwrap());

            // 设置密码（如果提供）
            if let Some(password) = config.password.clone() {
                ffi::rfbClientSetClientData(
                    client,
                    password_data_tag(),
                    Box::into_raw(Box::new(password)) as *mut c_void,
                );
            }

            // HOST 必须放在最后，否则 libvncclient 会把最后一个参数视为目标地址。
            let host_arg = if config.port == 5900 {
                config.host.clone()
            } else {
                format!("{}:{}", config.host, config.port)
            };
            argv_args.push(
                CString::new(host_arg)
                    .map_err(|_| VncError::FfiError("Invalid hostname".to_string()))?,
            );

            let mut argv_storage: Vec<*mut c_char> = argv_args
                .iter_mut()
                .map(|arg| arg.as_ptr() as *mut c_char)
                .collect();
            let mut argc = argv_storage.len() as c_int;
            let argv = argv_storage.as_mut_ptr();

            // 初始化客户端
            *inner.state.write() = VncConnectionState::Authenticating;

            let result = ffi::rfbInitClient(client, &mut argc, argv);

            if result == 0 {
                unregister_session(client_ptr);
                *inner.state.write() = VncConnectionState::Error;
                return Err(VncError::ConnectionFailed(
                    "Failed to initialize VNC client".to_string(),
                ));
            }

            // 存储状态
            *inner.raw_client.lock() = Some(client_ptr);
            *inner.context.lock() = Some(context);
            *inner.state.write() = VncConnectionState::Connected;

            Ok(event_receiver)
        }
    }

    /// 处理服务器消息
    ///
    /// 应该在事件循环中持续调用
    pub async fn handle_message(&self) -> VncResult<bool> {
        let inner = self.inner.clone();

        task::spawn_blocking(move || Self::do_handle_message(inner))
            .await
            .map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    #[allow(unreachable_code)]
    fn do_handle_message(inner: Arc<VncClientInner>) -> VncResult<bool> {
        const VNC_ENABLE_DIAGNOSTIC_LOGS: bool = false;
        const VNC_SLOW_MESSAGE_TOTAL_MS: u128 = 30;
        const VNC_SLOW_MESSAGE_HANDLE_MS: u128 = 20;

        /// WaitForMessage 超时（微秒）。值越小 io_lock 持有时间越短，输入响应越快。
        const VNC_WAIT_FOR_MESSAGE_TIMEOUT_US: u32 = 5_000;

        let _io_guard = inner.io_lock.lock();
        let client_ptr = *inner.raw_client.lock();

        return if let Some(ptr) = client_ptr {
            unsafe {
                let client = ptr as *mut ffi::RfbClient;
                let total_started_at = Instant::now();
                let wait_started_at = Instant::now();
                let result = ffi::WaitForMessage(client, VNC_WAIT_FOR_MESSAGE_TIMEOUT_US);
                let wait_elapsed = wait_started_at.elapsed();

                if result < 0 {
                    Err(VncError::NetworkError("Connection closed".to_string()))
                } else if result > 0 {
                    let handle_started_at = Instant::now();
                    let handled = ffi::HandleRFBServerMessage(client);
                    let handle_elapsed = handle_started_at.elapsed();
                    let total_elapsed = total_started_at.elapsed();
                    if VNC_ENABLE_DIAGNOSTIC_LOGS
                        && (total_elapsed.as_millis() >= VNC_SLOW_MESSAGE_TOTAL_MS
                            || handle_elapsed.as_millis() >= VNC_SLOW_MESSAGE_HANDLE_MS)
                    {
                        let config = inner.config.read();
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
                } else {
                    Ok(false)
                }
            }
        } else {
            Err(VncError::SessionClosed)
        };

        let _io_guard = inner.io_lock.lock();
        let client_ptr = *inner.raw_client.lock();

        if let Some(ptr) = client_ptr {
            unsafe {
                let client = ptr as *mut ffi::RfbClient;
                let total_started_at = Instant::now();
                let wait_started_at = Instant::now();

                // 等待消息（100ms 超时）
                let result = ffi::WaitForMessage(client, 100_000); // microseconds
                let result = ffi::WaitForMessage(client, 100_000); // microseconds
                let wait_elapsed = wait_started_at.elapsed();

                if result < 0 {
                    return Err(VncError::NetworkError("Connection closed".to_string()));
                }

                if result > 0 {
                    // 有消息可处理
                    let handle_started_at = Instant::now();
                    let handled = ffi::HandleRFBServerMessage(client);
                    let handle_elapsed = handle_started_at.elapsed();
                    let total_elapsed = total_started_at.elapsed();
                    if total_elapsed.as_millis() >= VNC_SLOW_MESSAGE_TOTAL_MS
                        || handle_elapsed.as_millis() >= VNC_SLOW_MESSAGE_HANDLE_MS
                    {
                        let config = inner.config.read();
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
                        return Err(VncError::ProtocolError(
                            "Failed to handle server message".to_string(),
                        ));
                    }
                    return Ok(true);
                }

                Ok(false) // 无消息
            }
        } else {
            Err(VncError::SessionClosed)
        }
    }

    /// 发送指针事件
    pub async fn send_pointer(&self, x: u16, y: u16, buttons: &[MouseButton]) -> VncResult<()> {
        let button_mask = buttons.iter().fold(0, |acc, b| acc | b.to_mask());
        self.send_pointer_raw(x, y, button_mask as u8).await
    }

    /// 发送指针事件（原始按钮掩码）
    pub async fn send_pointer_raw(&self, x: u16, y: u16, button_mask: u8) -> VncResult<()> {
        let inner = self.inner.clone();

        task::spawn_blocking(move || {
            let _io_guard = inner.io_lock.lock();
            let client_ptr = *inner.raw_client.lock();

            if let Some(ptr) = client_ptr {
                unsafe {
                    let client = ptr as *mut ffi::RfbClient;
                    let result =
                        ffi::SendPointerEvent(client, x as c_int, y as c_int, button_mask as c_int);

                    if result == 0 {
                        return Err(VncError::NetworkError(
                            "Failed to send pointer event".to_string(),
                        ));
                    }
                    Ok(())
                }
            } else {
                Err(VncError::SessionClosed)
            }
        })
        .await
        .map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    /// 发送键盘事件
    pub async fn send_key(&self, keysym: u32, down: bool) -> VncResult<()> {
        let inner = self.inner.clone();

        task::spawn_blocking(move || {
            let _io_guard = inner.io_lock.lock();
            let client_ptr = *inner.raw_client.lock();

            if let Some(ptr) = client_ptr {
                unsafe {
                    let client = ptr as *mut ffi::RfbClient;
                    let result = ffi::SendKeyEvent(client, keysym, if down { 1 } else { 0 } as u8);

                    if result == 0 {
                        return Err(VncError::NetworkError(
                            "Failed to send key event".to_string(),
                        ));
                    }
                    Ok(())
                }
            } else {
                Err(VncError::SessionClosed)
            }
        })
        .await
        .map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    /// 请求帧缓冲区更新
    pub async fn request_update(
        &self,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        incremental: bool,
    ) -> VncResult<()> {
        let inner = self.inner.clone();

        task::spawn_blocking(move || {
            let _io_guard = inner.io_lock.lock();
            let client_ptr = *inner.raw_client.lock();

            if let Some(ptr) = client_ptr {
                unsafe {
                    let client = ptr as *mut ffi::RfbClient;
                    let result = ffi::SendFramebufferUpdateRequest(
                        client,
                        x as c_int,
                        y as c_int,
                        width as c_int,
                        height as c_int,
                        if incremental { 1 } else { 0 } as u8,
                    );

                    if result == 0 {
                        return Err(VncError::NetworkError(
                            "Failed to send update request".to_string(),
                        ));
                    }
                    Ok(())
                }
            } else {
                Err(VncError::SessionClosed)
            }
        })
        .await
        .map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    /// 获取当前帧缓冲区
    pub fn framebuffer_size(&self) -> (u16, u16) {
        self.inner.framebuffer.size()
    }

    pub fn snapshot_rgba(&self) -> (u16, u16, Vec<u8>) {
        self.inner.framebuffer.snapshot_rgba()
    }

    pub fn snapshot_region_rgba(&self, region: FrameUpdateRegion) -> Option<Vec<u8>> {
        self.inner.framebuffer.snapshot_region_rgba(region)
    }

    /// 获取当前状态
    #[allow(dead_code)]
    pub fn state(&self) -> VncConnectionState {
        *self.inner.state.read()
    }

    /// 关闭连接
    pub async fn close(&self) {
        if self.inner.closed.swap(true, Ordering::SeqCst) {
            return; // 已经关闭
        }

        let inner = self.inner.clone();

        task::spawn_blocking(move || {
            let _io_guard = inner.io_lock.lock();
            let client_ptr = inner.raw_client.lock().take();
            *inner.context.lock() = None;

            if let Some(ptr) = client_ptr {
                unsafe {
                    unregister_session(ptr);
                    let client = ptr as *mut ffi::RfbClient;
                    clear_password_data(client);
                    ffi::rfbClientCleanup(client);
                }
            }

            *inner.state.write() = VncConnectionState::Disconnected;
        })
        .await
        .ok();
    }
}

impl Drop for VncClient {
    fn drop(&mut self) {
        if !self.inner.closed.load(Ordering::SeqCst) {
            // 尝试同步关闭
            let inner = self.inner.clone();
            let _io_guard = inner.io_lock.lock();
            let client_ptr = inner.raw_client.lock().take();
            *inner.context.lock() = None;

            if let Some(ptr) = client_ptr {
                unsafe {
                    unregister_session(ptr);
                    let client = ptr as *mut ffi::RfbClient;
                    clear_password_data(client);
                    ffi::rfbClientCleanup(client);
                }
            }
        }
    }
}

// 确保线程安全
unsafe impl Send for VncClient {}
unsafe impl Sync for VncClient {}
