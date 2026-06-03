#![allow(dead_code)]

//! Low-level FreeRDP C FFI bindings.

use std::ffi::{c_char, c_int, c_uchar, c_uint, c_ushort, c_void};

pub const LAZY_RDP_POINTER_MOVE: c_ushort = 0x0001;
pub const LAZY_RDP_POINTER_LEFT_DOWN: c_ushort = 0x0002;
pub const LAZY_RDP_POINTER_LEFT_UP: c_ushort = 0x0004;
pub const LAZY_RDP_POINTER_RIGHT_DOWN: c_ushort = 0x0008;
pub const LAZY_RDP_POINTER_RIGHT_UP: c_ushort = 0x0010;
pub const LAZY_RDP_POINTER_MIDDLE_DOWN: c_ushort = 0x0020;
pub const LAZY_RDP_POINTER_MIDDLE_UP: c_ushort = 0x0040;
pub const LAZY_RDP_POINTER_WHEEL: c_ushort = 0x0080;
pub const LAZY_RDP_POINTER_HWHEEL: c_ushort = 0x0100;

#[repr(C)]
pub struct LazyFreeRdpClient {
    _private: [u8; 0],
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct LazyFreeRdpConfig {
    pub host: *const c_char,
    pub port: c_ushort,
    pub username: *const c_char,
    pub password: *const c_char,
    pub domain: *const c_char,
    pub width: c_uint,
    pub height: c_uint,
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct LazyFreeRdpFrame {
    pub desktop_width: c_uint,
    pub desktop_height: c_uint,
    pub left: c_uint,
    pub top: c_uint,
    pub width: c_uint,
    pub height: c_uint,
    pub full: c_uchar,
    pub rgba: *mut c_uchar,
    pub rgba_len: usize,
}

impl Default for LazyFreeRdpFrame {
    fn default() -> Self {
        Self {
            desktop_width: 0,
            desktop_height: 0,
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            full: 0,
            rgba: std::ptr::null_mut(),
            rgba_len: 0,
        }
    }
}

unsafe extern "C" {
    pub fn lazy_freerdp_client_new(config: *const LazyFreeRdpConfig) -> *mut LazyFreeRdpClient;
    pub fn lazy_freerdp_client_connect(client: *mut LazyFreeRdpClient) -> c_int;
    pub fn lazy_freerdp_client_poll(
        client: *mut LazyFreeRdpClient,
        timeout_ms: c_uint,
        frame: *mut LazyFreeRdpFrame,
    ) -> c_int;
    pub fn lazy_freerdp_frame_free(frame: *mut LazyFreeRdpFrame);
    pub fn lazy_freerdp_client_send_pointer(
        client: *mut LazyFreeRdpClient,
        x: c_ushort,
        y: c_ushort,
        flags: c_ushort,
        wheel_delta: i16,
    ) -> c_int;
    pub fn lazy_freerdp_client_send_key(
        client: *mut LazyFreeRdpClient,
        scancode: c_uint,
        down: c_uchar,
    ) -> c_int;
    pub fn lazy_freerdp_client_resize(
        client: *mut LazyFreeRdpClient,
        width: c_uint,
        height: c_uint,
    ) -> c_int;
    pub fn lazy_freerdp_client_close(client: *mut LazyFreeRdpClient);
    pub fn lazy_freerdp_client_free(client: *mut LazyFreeRdpClient);
    pub fn lazy_freerdp_client_last_error(client: *mut LazyFreeRdpClient) -> *const c_char;
    pub fn lazy_freerdp_version() -> *const c_char;
}

pub type OpaqueVoid = c_void;
