//! LibVNCClient 安全 Rust 包装器
//!
//! 本模块提供对 libvncclient 的安全、异步 Rust API。
//! 所有底层 FFI 调用都被包装为线程安全的抽象。
//!
//! # 设计原则
//!
//! 1. **线程安全**: 使用 `Send + Sync` 包装器确保跨线程安全
//! 2. **异步友好**: 所有阻塞操作都在 `spawn_blocking` 中执行
//! 3. **类型安全**: 使用强类型避免常见错误
//! 4. **资源管理**: 使用 RAII 模式自动清理资源
//!
//! # 功能开关
//!
//! 使用 Cargo 功能开关选择 VNC 实现：
//! - `vnc-libvncclient`: 使用 LibVNCClient C 库（默认，推荐）
//! - `vnc-rust`: 使用纯 Rust vnc-rs 实现（回退）

mod client;
mod callbacks;
mod frame;
mod event_loop;
mod feature_gate;

pub use client::{VncClient, VncClientConfig, VncConnectionState};
pub use callbacks::CallbackEvent;
pub use event_loop::{VncEventLoopHandle, ControlMessage};
pub use feature_gate::VncBackend;

use thiserror::Error;

/// VNC 客户端错误类型
#[derive(Error, Debug)]
pub enum VncError {
    #[error("连接失败: {0}")]
    ConnectionFailed(String),
    
    #[error("认证失败: {0}")]
    AuthenticationFailed(String),
    
    #[error("协议错误: {0}")]
    ProtocolError(String),
    
    #[error("网络错误: {0}")]
    NetworkError(String),
    
    #[error("内存分配失败")]
    MemoryAllocationFailed,
    
    #[error("无效的状态转换: 当前状态 {current}, 目标状态 {target}")]
    InvalidStateTransition {
        current: String,
        target: String,
    },
    
    #[error("会话已关闭")]
    SessionClosed,
    
    #[error("操作超时")]
    Timeout,
    
    #[error("FFI 错误: {0}")]
    FfiError(String),
}

/// VNC 结果类型
pub type VncResult<T> = Result<T, VncError>;

/// VNC 编码类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VncEncoding {
    Raw,
    CopyRect,
    Rre,
    Hextile,
    Zlib,
    Tight,
    ZlibHex,
    Zrle,
    OpenH264,
    CursorPseudo,      // -239
    DesktopSizePseudo, // -223
}

impl VncEncoding {
    /// 转换为 FFI 编码常量
    pub fn to_int(&self) -> i32 {
        use super::vnc_ffi as ffi;
        match self {
            VncEncoding::Raw => ffi::RFB_ENCODING_RAW,
            VncEncoding::CopyRect => ffi::RFB_ENCODING_COPY_RECT,
            VncEncoding::Rre => ffi::RFB_ENCODING_RRE,
            VncEncoding::Hextile => ffi::RFB_ENCODING_HEXTILE,
            VncEncoding::Zlib => ffi::RFB_ENCODING_ZLIB,
            VncEncoding::Tight => ffi::RFB_ENCODING_TIGHT,
            VncEncoding::ZlibHex => ffi::RFB_ENCODING_ZLIBHEX,
            VncEncoding::Zrle => ffi::RFB_ENCODING_ZRLE,
            VncEncoding::OpenH264 => ffi::RFB_ENCODING_OPEN_H264,
            VncEncoding::CursorPseudo => ffi::RFB_ENCODING_CURSOR,
            VncEncoding::DesktopSizePseudo => ffi::RFB_ENCODING_DESKTOP_SIZE,
        }
    }
}

/// 鼠标按钮
#[derive(Debug, Copy, Clone, PartialEq)]
pub enum MouseButton {
    Left,
    Middle,
    Right,
    ScrollUp,
    ScrollDown,
}

impl MouseButton {
    /// 转换为 VNC 按钮掩码
    pub fn to_mask(&self) -> i32 {
        match self {
            MouseButton::Left => 1,
            MouseButton::Middle => 2,
            MouseButton::Right => 4,
            MouseButton::ScrollUp => 8,
            MouseButton::ScrollDown => 16,
        }
    }
}

/// 剪贴板文本事件
#[derive(Debug, Clone)]
pub struct ClipboardEvent {
    pub text: String,
}
