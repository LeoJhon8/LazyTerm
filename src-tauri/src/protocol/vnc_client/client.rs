//! VNC 客户端主模块
//!
//! 提供安全的、异步的 VNC 客户端 API

use std::ffi::{c_char, c_int, CString};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use parking_lot::{Mutex, RwLock};
use tokio::task;

use super::super::vnc_ffi as ffi;
use super::callbacks::{register_session, unregister_session, CallbackEvent, SessionContext};
use super::frame::{FrameBuffer, PixelFormat};
use super::{VncEncoding, MouseButton, VncError, VncResult};

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
    pub view_only: bool,
    pub jpeg_quality: u8, // 0-9
    pub compression_level: u8, // 0-9
    pub encodings: Vec<super::VncEncoding>,
}

impl Default for VncClientConfig {
    fn default() -> Self {
        use super::VncEncoding;
        Self {
            host: String::new(),
            port: 5900,
            password: None,
            shared: true,
            view_only: false,
            jpeg_quality: 8,
            compression_level: 6,
            encodings: vec![
                VncEncoding::Tight,
                VncEncoding::Zrle,
                VncEncoding::Hextile,
                VncEncoding::Raw,
                VncEncoding::CursorPseudo,
                VncEncoding::DesktopSizePseudo,
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
    context: Mutex<Option<Arc<SessionContext>>>,
    framebuffer: FrameBuffer,
    closed: AtomicBool,
}

impl VncClient {
    /// 创建新的 VNC 客户端实例
    pub fn new(config: VncClientConfig) -> Self {
        let framebuffer = FrameBuffer::new(1, 1, PixelFormat::rgba8888());
        
        Self {
            inner: Arc::new(VncClientInner {
                config: RwLock::new(config),
                state: RwLock::new(VncConnectionState::Disconnected),
                raw_client: Mutex::new(None),
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
        task::spawn_blocking(move || {
            Self::do_connect(inner)
        }).await.map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    /// 执行实际的连接（阻塞）
    fn do_connect(inner: Arc<VncClientInner>) -> VncResult<Receiver<CallbackEvent>> {
        let config = inner.config.read().clone();
        
        *inner.state.write() = VncConnectionState::Connecting;

        unsafe {
            // 创建客户端
            let client = ffi::rfbGetClient(8, 3, 4); // bitsPerSample, samplesPerPixel, bytesPerPixel
            if client.is_null() {
                *inner.state.write() = VncConnectionState::Error;
                return Err(VncError::MemoryAllocationFailed);
            }
            
            // 配置客户端
            // 注意：这些设置需要在 rfbInitClient 之前完成
            // 这里我们使用命令行参数方式初始化

            // 构建参数
            let mut arg_storage: Vec<CString> = Vec::new();
            
            // 程序名
            arg_storage.push(CString::new("vnc_client").unwrap());

            // 共享标志
            if config.shared {
                arg_storage.push(CString::new("-shared").unwrap());
            }
            
            // 视口标志
            if config.view_only {
                arg_storage.push(CString::new("-viewonly").unwrap());
            }
            
            // 编码
            let encodings_str = config.encodings.iter()
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
                .join(",");
            arg_storage.push(CString::new("-encodings").unwrap());
            arg_storage.push(CString::new(encodings_str).unwrap());

            // 压缩级别
            arg_storage.push(CString::new("-compress").unwrap());
            arg_storage.push(CString::new(config.compression_level.to_string()).unwrap());

            // 设置密码（如果提供）
            if let Some(ref _password) = config.password {
                // LibVNCClient 使用 GetPassword 回调来获取密码
                // 这里简化处理，实际实现需要设置回调
            }

            // HOST 必须放在最后，否则 libvncclient 会把最后一个参数视为目标地址。
            let host_arg = if config.port == 5900 {
                config.host.clone()
            } else {
                format!("{}:{}", config.host, config.port)
            };
            arg_storage.push(
                CString::new(host_arg)
                    .map_err(|_| VncError::FfiError("Invalid hostname".to_string()))?
            );

            let mut argv_storage: Vec<*mut c_char> = arg_storage
                .iter_mut()
                .map(|arg| arg.as_ptr() as *mut c_char)
                .collect();
            let mut argc = argv_storage.len() as c_int;
            let argv = argv_storage.as_mut_ptr();

            // 初始化客户端
            *inner.state.write() = VncConnectionState::Authenticating;
            
            let result = ffi::rfbInitClient(client, &mut argc, argv);

            if result == 0 {
                *inner.state.write() = VncConnectionState::Error;
                return Err(VncError::ConnectionFailed(
                    "Failed to initialize VNC client".to_string()
                ));
            }

            // 创建事件通道
            let (event_sender, event_receiver) = std::sync::mpsc::channel::<CallbackEvent>();

            // 创建会话上下文
            let context = Arc::new(SessionContext {
                event_sender,
                framebuffer: inner.framebuffer.clone(),
            });

            // 注册会话
            let client_ptr = client as usize;
            register_session(client_ptr, Arc::downgrade(&context));

            // 设置回调
            ffi::RfbClientSetGotFrameBufferUpdate(
                client,
                super::callbacks::framebuffer_update_callback,
            );
            ffi::RfbClientSetHandleCursorShape(
                client,
                super::callbacks::handle_cursor_shape_callback,
            );
            ffi::RfbClientSetGotXCutText(
                client,
                super::callbacks::got_xcut_text_callback,
            );
            ffi::RfbClientSetGotCursorPos(
                client,
                super::callbacks::got_cursor_pos_callback,
            );
            ffi::RfbClientSetMallocFrameBuffer(
                client,
                super::callbacks::malloc_framebuffer_callback,
            );

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
        
        task::spawn_blocking(move || {
            Self::do_handle_message(inner)
        }).await.map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    fn do_handle_message(inner: Arc<VncClientInner>) -> VncResult<bool> {
        let client_ptr = *inner.raw_client.lock();
        
        if let Some(ptr) = client_ptr {
            unsafe {
                let client = ptr as *mut ffi::RfbClient;
                
                // 等待消息（100ms 超时）
                let result = ffi::WaitForMessage(client, 100_000); // microseconds
                
                if result < 0 {
                    return Err(VncError::NetworkError("Connection closed".to_string()));
                }
                
                if result > 0 {
                    // 有消息可处理
                    let handled = ffi::HandleRFBServerMessage(client);
                    if handled == 0 {
                        return Err(VncError::ProtocolError("Failed to handle server message".to_string()));
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
            let client_ptr = *inner.raw_client.lock();
            
            if let Some(ptr) = client_ptr {
                unsafe {
                    let client = ptr as *mut ffi::RfbClient;
                    let result = ffi::SendPointerEvent(
                        client,
                        x as c_int,
                        y as c_int,
                        button_mask as c_int,
                    );
                    
                    if result == 0 {
                        return Err(VncError::NetworkError("Failed to send pointer event".to_string()));
                    }
                    Ok(())
                }
            } else {
                Err(VncError::SessionClosed)
            }
        }).await.map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    /// 发送键盘事件
    pub async fn send_key(&self, keysym: u32, down: bool) -> VncResult<()> {
        let inner = self.inner.clone();
        
        task::spawn_blocking(move || {
            let client_ptr = *inner.raw_client.lock();
            
            if let Some(ptr) = client_ptr {
                unsafe {
                    let client = ptr as *mut ffi::RfbClient;
                    let result = ffi::SendKeyEvent(
                        client,
                        keysym,
                        if down { 1 } else { 0 } as u8,
                    );
                    
                    if result == 0 {
                        return Err(VncError::NetworkError("Failed to send key event".to_string()));
                    }
                    Ok(())
                }
            } else {
                Err(VncError::SessionClosed)
            }
        }).await.map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    /// 请求帧缓冲区更新
    pub async fn request_update(&self, x: u16, y: u16, width: u16, height: u16, incremental: bool) -> VncResult<()> {
        let inner = self.inner.clone();
        
        task::spawn_blocking(move || {
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
                        return Err(VncError::NetworkError("Failed to send update request".to_string()));
                    }
                    Ok(())
                }
            } else {
                Err(VncError::SessionClosed)
            }
        }).await.map_err(|e| VncError::FfiError(format!("Join error: {e}")))?
    }

    /// 获取当前帧缓冲区
    pub fn framebuffer(&self) -> FrameBuffer {
        self.inner.framebuffer.clone()
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
            let client_ptr = inner.raw_client.lock().take();
            *inner.context.lock() = None;
            
            if let Some(ptr) = client_ptr {
                unsafe {
                    unregister_session(ptr);
                    let client = ptr as *mut ffi::RfbClient;
                    ffi::rfbClientCleanup(client);
                }
            }
            
            *inner.state.write() = VncConnectionState::Disconnected;
        }).await.ok();
    }
}

impl Drop for VncClient {
    fn drop(&mut self) {
        if !self.inner.closed.load(Ordering::SeqCst) {
            // 尝试同步关闭
            let inner = self.inner.clone();
            let client_ptr = inner.raw_client.lock().take();
            *inner.context.lock() = None;
            
            if let Some(ptr) = client_ptr {
                unsafe {
                    unregister_session(ptr);
                    let client = ptr as *mut ffi::RfbClient;
                    ffi::rfbClientCleanup(client);
                }
            }
        }
    }
}

// 确保线程安全
unsafe impl Send for VncClient {}
unsafe impl Sync for VncClient {}
