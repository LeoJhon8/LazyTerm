#![allow(dead_code)]

//! LibVNCClient FFI 绑定模块
//!
//! 本模块提供对 libvncclient C 库的低级 FFI 绑定。
//! 所有函数均为 `unsafe`，需要在上层包装器中安全使用。
//!
//! # 线程安全注意事项
//!
//! - `rfbClient` 结构体不是线程安全的，必须在单线程中访问
//! - 回调函数在 LibVNCClient 内部线程中调用，需要注意 Send/Sync 约束
//! - 使用 `std::sync::mpsc` 进行跨线程通信

use std::ffi::{c_char, c_int, c_uint, c_ushort, c_void, CStr};
use std::os::raw::c_uchar;

// ============================================================================
// 常量定义
// ============================================================================

/// 标准 VNC 端口
pub const RFB_PORT: c_int = 5900;

/// 编码类型
pub const RFB_ENCODING_RAW: c_int = 0;
pub const RFB_ENCODING_COPY_RECT: c_int = 1;
pub const RFB_ENCODING_RRE: c_int = 2;
pub const RFB_ENCODING_HEXTILE: c_int = 5;
pub const RFB_ENCODING_ZLIB: c_int = 6;
pub const RFB_ENCODING_TIGHT: c_int = 7;
pub const RFB_ENCODING_ZLIBHEX: c_int = 8;
pub const RFB_ENCODING_ZRLE: c_int = 16;
pub const RFB_ENCODING_OPEN_H264: c_int = 50;
pub const RFB_ENCODING_CURSOR: c_int = -239;
pub const RFB_ENCODING_DESKTOP_SIZE: c_int = -223;

/// 鼠标按钮掩码
pub const RFB_BUTTON_LEFT: c_int = 1;
pub const RFB_BUTTON_MIDDLE: c_int = 2;
pub const RFB_BUTTON_RIGHT: c_int = 4;
pub const RFB_BUTTON_SCROLL_UP: c_int = 8;
pub const RFB_BUTTON_SCROLL_DOWN: c_int = 16;

/// 日志级别
pub const RFB_LOG_ERROR: c_int = 0;
pub const RFB_LOG_WARN: c_int = 1;
pub const RFB_LOG_INFO: c_int = 2;
pub const RFB_LOG_DEBUG: c_int = 3;

// ============================================================================
// 结构体定义
// ============================================================================

/// RFB 客户端结构体 (opaque pointer)
#[repr(C)]
pub struct RfbClient {
    _private: [u8; 0],
}

/// RFB 像素格式
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct RfbPixelFormat {
    pub bits_per_pixel: c_uchar,
    pub depth: c_uchar,
    pub big_endian: c_uchar,
    pub true_colour: c_uchar,
    pub red_max: c_ushort,
    pub green_max: c_ushort,
    pub blue_max: c_ushort,
    pub red_shift: c_uchar,
    pub green_shift: c_uchar,
    pub blue_shift: c_uchar,
    pub pad: [c_uchar; 3],
}

/// 矩形更新信息
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct RfbRectangle {
    pub x: c_uint,
    pub y: c_uint,
    pub w: c_uint,
    pub h: c_uint,
    pub encoding: c_int,
}

/// 帧缓冲区更新消息
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct RfbFramebufferUpdateMsg {
    pub msg_type: c_uchar,
    pub pad: c_uchar,
    pub n_rects: c_uint,
}

// ============================================================================
// 回调函数类型
// ============================================================================

/// MallocFrameBuffer 回调类型
pub type MallocFrameBufferCallback = unsafe extern "C" fn(client: *mut RfbClient) -> i8;

/// VNC 密码回调类型
pub type GetPasswordCallback = unsafe extern "C" fn(client: *mut RfbClient) -> *mut c_char;

/// 帧缓冲区更新回调类型
pub type FramebufferUpdateCallback =
    unsafe extern "C" fn(client: *mut RfbClient, x: c_int, y: c_int, w: c_int, h: c_int);

/// 光标形状处理回调类型
pub type HandleCursorShapeCallback = unsafe extern "C" fn(
    client: *mut RfbClient,
    xhot: c_int,
    yhot: c_int,
    width: c_int,
    height: c_int,
    bytes_per_pixel: c_int,
);

/// 剪贴板文本回调类型
pub type GotXCutTextCallback =
    unsafe extern "C" fn(client: *mut RfbClient, text: *mut c_char, len: c_int);

/// 鼠标回调类型
pub type GotCursorPosCallback =
    unsafe extern "C" fn(client: *mut RfbClient, x: c_int, y: c_int) -> i8;

/// 日志回调类型
pub type LogCallback = unsafe extern "C" fn(
    level: c_int,
    file: *const c_char,
    line: c_int,
    format: *const c_char,
    ...
);

// ============================================================================
// FFI 函数声明
// ============================================================================

extern "C" {
    /// 创建新的 RFB 客户端实例
    ///
    /// # Safety
    /// 返回的指针必须在使用后通过 `rfbClientCleanup` 释放
    pub fn rfbGetClient(
        bits_per_sample: c_int,
        samples_per_pixel: c_int,
        bytes_per_pixel: c_int,
    ) -> *mut RfbClient;

    /// 初始化客户端连接
    ///
    /// # Safety
    /// client 必须是有效的 `rfbGetClient` 返回值
    /// argc/argv 遵循 C 标准 main 函数参数约定
    pub fn rfbInitClient(
        client: *mut RfbClient,
        argc: *mut c_int,
        argv: *mut *mut c_char,
    ) -> c_uchar;

    /// 清理并释放客户端资源
    ///
    /// # Safety
    /// client 必须是有效的 `rfbGetClient` 返回值，且只能调用一次
    pub fn rfbClientCleanup(client: *mut RfbClient);

    /// 处理服务器消息（阻塞）
    ///
    /// # Safety
    /// client 必须是有效且已连接的客户端
    pub fn WaitForMessage(client: *mut RfbClient, usecs: c_uint) -> c_int;

    /// 处理单个消息
    ///
    /// # Safety
    /// client 必须是有效且已连接的客户端
    pub fn HandleRFBServerMessage(client: *mut RfbClient) -> c_uchar;

    /// 发送指针事件
    ///
    /// # Safety
    /// client 必须是有效且已连接的客户端
    pub fn SendPointerEvent(
        client: *mut RfbClient,
        x: c_int,
        y: c_int,
        button_mask: c_int,
    ) -> c_uchar;

    pub fn SendExtDesktopSize(client: *mut RfbClient, width: c_ushort, height: c_ushort)
        -> c_uchar;

    /// 发送键盘事件
    ///
    /// # Safety
    /// client 必须是有效且已连接的客户端
    pub fn SendKeyEvent(client: *mut RfbClient, key: c_uint, down: c_uchar) -> c_uchar;

    /// 发送剪贴板文本
    ///
    /// # Safety
    /// client 必须是有效且已连接的客户端，text 必须是有效的 C 字符串
    pub fn SendClientCutText(client: *mut RfbClient, text: *const c_char, len: c_int) -> c_uchar;

    /// 请求帧缓冲区更新
    ///
    /// # Safety
    /// client 必须是有效且已连接的客户端
    pub fn SendFramebufferUpdateRequest(
        client: *mut RfbClient,
        x: c_int,
        y: c_int,
        w: c_int,
        h: c_int,
        incremental: c_uchar,
    ) -> c_uchar;

    /// 设置像素格式
    ///
    /// # Safety
    /// client 必须是有效且已连接的客户端
    pub fn SetFormatAndEncodings(client: *mut RfbClient) -> c_uchar;

    /// 启用/禁用 JPEG 压缩（Tight 编码）
    ///
    /// # Safety
    /// client 必须是有效且已连接的客户端
    pub fn SetClientColorDepth(client: *mut RfbClient, depth: c_int);

    /// 设置 JPEG 质量（0-9）
    pub fn TightSetJPEGQuality(client: *mut RfbClient, quality: c_int);

    /// 设置压缩级别（0-9）
    pub fn TightSetCompressionLevel(client: *mut RfbClient, level: c_int);

    // 字段访问器（因为 Rust 不能直接访问 C 结构体字段）
    pub fn RfbClientGetScreenWidth(client: *mut RfbClient) -> c_int;
    pub fn RfbClientGetScreenHeight(client: *mut RfbClient) -> c_int;
    pub fn RfbClientGetFrameBuffer(client: *mut RfbClient) -> *mut c_uchar;
    pub fn RfbClientGetCursorSource(client: *mut RfbClient) -> *const c_uchar;
    pub fn RfbClientGetCursorMask(client: *mut RfbClient) -> *const c_uchar;
    pub fn RfbClientSupportsDesktopResize(client: *mut RfbClient) -> c_uchar;
    pub fn RfbClientGetPixelFormat(client: *mut RfbClient) -> RfbPixelFormat;
    pub fn RfbClientRegisterIgnoreQemuExtension();
    pub fn RfbClientSetEncodingsString(client: *mut RfbClient, encodings: *const c_char);
    pub fn RfbClientDupCString(value: *const c_char) -> *mut c_char;
    pub fn RfbClientSetEnableJpeg(client: *mut RfbClient, enable: c_uchar);
    pub fn RfbClientSetUseRemoteCursor(client: *mut RfbClient, enable: c_uchar);
    pub fn RfbClientSetHandleNewFBSize(client: *mut RfbClient, enable: c_uchar);
    pub fn RfbClientSetConnectTimeout(client: *mut RfbClient, timeout_seconds: c_uint);
    pub fn RfbClientSetReadTimeout(client: *mut RfbClient, timeout_seconds: c_uint);
    pub fn RfbClientSetCompressLevel(client: *mut RfbClient, level: c_int);
    pub fn RfbClientSetQualityLevel(client: *mut RfbClient, level: c_int);
    pub fn RfbClientSetShared(client: *mut RfbClient, shared: c_uchar);
    pub fn RfbClientSetViewOnly(client: *mut RfbClient, view_only: c_uchar);
    pub fn RfbClientSetServerHost(client: *mut RfbClient, host: *const c_char);
    pub fn RfbClientSetServerPort(client: *mut RfbClient, port: c_int);
    pub fn RfbClientAdoptConnectedSocket(client: *mut RfbClient, socket_handle: usize);

    // 设置回调
    pub fn RfbClientSetMallocFrameBuffer(
        client: *mut RfbClient,
        callback: MallocFrameBufferCallback,
    );
    pub fn RfbClientSetGotFrameBufferUpdate(
        client: *mut RfbClient,
        callback: FramebufferUpdateCallback,
    );
    pub fn RfbClientSetHandleCursorShape(
        client: *mut RfbClient,
        callback: HandleCursorShapeCallback,
    );
    pub fn RfbClientSetGotXCutText(client: *mut RfbClient, callback: GotXCutTextCallback);
    pub fn RfbClientSetGotCursorPos(client: *mut RfbClient, callback: GotCursorPosCallback);
    pub fn RfbClientSetGetPassword(client: *mut RfbClient, callback: GetPasswordCallback);
    pub fn RfbClientDefaultMallocFrameBuffer(client: *mut RfbClient) -> i8;

    // clientData 辅助函数
    pub fn rfbClientSetClientData(client: *mut RfbClient, tag: *mut c_void, data: *mut c_void);
    pub fn rfbClientGetClientData(client: *mut RfbClient, tag: *mut c_void) -> *mut c_void;

    // 错误处理
    pub fn RfbClientSetLastError(client: *mut RfbClient, error: *const c_char);
    pub fn RfbClientGetLastError(client: *mut RfbClient) -> *const c_char;
    pub fn RfbClientInstallLogCapture();

    // 日志设置
    pub fn rfbEnableClientLogging();
    pub fn rfbDisableClientLogging();
    pub fn logmsg(level: c_int, format: *const c_char, ...);
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 将 Rust 字符串转换为 C 字符串指针
///
/// # Safety
/// 返回的指针指向的内存由调用者管理，必须在使用后释放
pub unsafe fn str_to_cstring(s: &str) -> *mut c_char {
    let c_string = std::ffi::CString::new(s).unwrap_or_default();
    c_string.into_raw()
}

/// 释放 C 字符串指针
///
/// # Safety
/// ptr 必须是由 `str_to_cstring` 返回的有效指针
pub unsafe fn free_cstring(ptr: *mut c_char) {
    if !ptr.is_null() {
        let _ = std::ffi::CString::from_raw(ptr);
    }
}

/// 从 C 字符串安全地创建 Rust 字符串
///
/// # Safety
/// ptr 必须是有效的以 null 结尾的 C 字符串
pub unsafe fn cstring_to_str(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    CStr::from_ptr(ptr).to_str().ok().map(|s| s.to_string())
}

/// 检查客户端是否已连接
///
/// # Safety
/// client 必须是有效的客户端指针
pub unsafe fn is_connected(client: *mut RfbClient) -> bool {
    !client.is_null() && RfbClientGetScreenWidth(client) > 0
}

/// 获取帧缓冲区大小（字节数）
///
/// # Safety
/// client 必须是有效的客户端指针
pub unsafe fn get_framebuffer_size(client: *mut RfbClient) -> usize {
    let width = RfbClientGetScreenWidth(client) as usize;
    let height = RfbClientGetScreenHeight(client) as usize;
    // RGBA = 4 bytes per pixel
    width * height * 4
}
