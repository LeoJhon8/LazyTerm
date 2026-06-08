//! Safe FreeRDP client wrapper.

use std::ffi::{CStr, CString};
use std::ptr;
use std::time::Duration;

use super::freerdp_ffi as ffi;

#[derive(Debug, Clone)]
pub struct FreeRdpClientConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub domain: Option<String>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct FreeRdpFrame {
    pub desktop_width: u32,
    pub desktop_height: u32,
    pub left: u32,
    pub top: u32,
    pub width: u32,
    pub height: u32,
    pub full: bool,
    pub rgba: Vec<u8>,
}

pub struct FreeRdpClient {
    raw: *mut ffi::LazyFreeRdpClient,
}

unsafe impl Send for FreeRdpClient {}

impl FreeRdpClient {
    pub fn connect(config: &FreeRdpClientConfig) -> Result<Self, String> {
        let host = cstring("host", &config.host)?;
        let username = cstring("username", &config.username)?;
        let password = cstring("password", &config.password)?;
        let domain = match config.domain.as_deref().filter(|value| !value.is_empty()) {
            Some(value) => Some(cstring("domain", value)?),
            None => None,
        };

        let raw_config = ffi::LazyFreeRdpConfig {
            host: host.as_ptr(),
            port: config.port,
            username: username.as_ptr(),
            password: password.as_ptr(),
            domain: domain
                .as_ref()
                .map(|value| value.as_ptr())
                .unwrap_or(ptr::null()),
            width: config.width,
            height: config.height,
        };

        let raw = unsafe { ffi::lazy_freerdp_client_new(&raw_config) };
        if raw.is_null() {
            return Err("failed to allocate FreeRDP client".to_string());
        }

        let mut client = Self { raw };
        let connected = unsafe { ffi::lazy_freerdp_client_connect(client.raw) };
        if connected == 0 {
            let error = client.last_error();
            unsafe { ffi::lazy_freerdp_client_free(client.raw) };
            client.raw = ptr::null_mut();
            return Err(error);
        }

        Ok(client)
    }

    pub fn poll_frame(&mut self, timeout: Duration) -> Result<Option<FreeRdpFrame>, String> {
        let timeout_ms = timeout.as_millis().min(u128::from(u32::MAX)) as u32;
        let mut raw_frame = ffi::LazyFreeRdpFrame::default();
        let result = unsafe {
            ffi::lazy_freerdp_client_poll(self.raw, timeout_ms, &mut raw_frame as *mut _)
        };

        match result {
            1 => {
                let frame = self.copy_frame(&raw_frame)?;
                unsafe { ffi::lazy_freerdp_frame_free(&mut raw_frame as *mut _) };
                Ok(Some(frame))
            }
            0 => Ok(None),
            _ => Err(self.last_error()),
        }
    }

    pub fn send_pointer_move(&mut self, x: u16, y: u16) -> Result<(), String> {
        self.send_pointer(x, y, ffi::LAZY_RDP_POINTER_MOVE, 0)
    }

    pub fn send_pointer_button(
        &mut self,
        x: u16,
        y: u16,
        button: u8,
        down: bool,
    ) -> Result<(), String> {
        let flags = match (button, down) {
            (0, true) => ffi::LAZY_RDP_POINTER_LEFT_DOWN,
            (0, false) => ffi::LAZY_RDP_POINTER_LEFT_UP,
            (1, true) => ffi::LAZY_RDP_POINTER_MIDDLE_DOWN,
            (1, false) => ffi::LAZY_RDP_POINTER_MIDDLE_UP,
            (2, true) => ffi::LAZY_RDP_POINTER_RIGHT_DOWN,
            (2, false) => ffi::LAZY_RDP_POINTER_RIGHT_UP,
            _ => return Ok(()),
        };

        self.send_pointer(x, y, flags, 0)
    }

    pub fn send_pointer_wheel(
        &mut self,
        x: u16,
        y: u16,
        delta: i16,
        horizontal: bool,
    ) -> Result<(), String> {
        let flags = if horizontal {
            ffi::LAZY_RDP_POINTER_HWHEEL
        } else {
            ffi::LAZY_RDP_POINTER_WHEEL
        };

        self.send_pointer(x, y, flags, delta)
    }

    pub fn send_key(&mut self, scancode: u16, down: bool) -> Result<(), String> {
        let scancode = normalize_rdp_scancode_for_freerdp(scancode);
        let result = unsafe { ffi::lazy_freerdp_client_send_key(self.raw, scancode, down as u8) };
        if result == 0 {
            return Err(self.last_error());
        }
        Ok(())
    }

    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), String> {
        let result = unsafe { ffi::lazy_freerdp_client_resize(self.raw, width, height) };
        if result == 0 {
            return Err(self.last_error());
        }
        Ok(())
    }

    pub fn close(&mut self) {
        if !self.raw.is_null() {
            unsafe { ffi::lazy_freerdp_client_close(self.raw) };
        }
    }

    pub fn version() -> Option<String> {
        let ptr = unsafe { ffi::lazy_freerdp_version() };
        if ptr.is_null() {
            return None;
        }

        unsafe { CStr::from_ptr(ptr) }
            .to_str()
            .ok()
            .map(ToOwned::to_owned)
    }

    fn send_pointer(&mut self, x: u16, y: u16, flags: u16, wheel_delta: i16) -> Result<(), String> {
        let result =
            unsafe { ffi::lazy_freerdp_client_send_pointer(self.raw, x, y, flags, wheel_delta) };
        if result == 0 {
            return Err(self.last_error());
        }
        Ok(())
    }

    fn copy_frame(&self, raw_frame: &ffi::LazyFreeRdpFrame) -> Result<FreeRdpFrame, String> {
        if raw_frame.rgba.is_null() {
            return Err("FreeRDP returned an empty frame".to_string());
        }

        let expected_len = raw_frame
            .width
            .checked_mul(raw_frame.height)
            .and_then(|pixels| pixels.checked_mul(4))
            .map(|value| value as usize)
            .ok_or_else(|| "FreeRDP frame dimensions overflowed".to_string())?;

        if raw_frame.rgba_len != expected_len {
            return Err(format!(
                "unexpected FreeRDP frame length: {} != {}",
                raw_frame.rgba_len, expected_len
            ));
        }

        let rgba =
            unsafe { std::slice::from_raw_parts(raw_frame.rgba, raw_frame.rgba_len) }.to_vec();

        Ok(FreeRdpFrame {
            desktop_width: raw_frame.desktop_width,
            desktop_height: raw_frame.desktop_height,
            left: raw_frame.left,
            top: raw_frame.top,
            width: raw_frame.width,
            height: raw_frame.height,
            full: raw_frame.full != 0,
            rgba,
        })
    }

    fn last_error(&self) -> String {
        if self.raw.is_null() {
            return "FreeRDP client is not available".to_string();
        }

        let ptr = unsafe { ffi::lazy_freerdp_client_last_error(self.raw) };
        if ptr.is_null() {
            return "unknown FreeRDP error".to_string();
        }

        unsafe { CStr::from_ptr(ptr) }
            .to_str()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|_| "FreeRDP returned an invalid error message".to_string())
    }
}

impl Drop for FreeRdpClient {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            unsafe { ffi::lazy_freerdp_client_free(self.raw) };
            self.raw = ptr::null_mut();
        }
    }
}

fn cstring(label: &str, value: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| format!("RDP {label} contains an invalid NUL byte"))
}

fn normalize_rdp_scancode_for_freerdp(scancode: u16) -> u32 {
    const FREERDP_KBDEXT: u32 = 0x0100;

    if (scancode & 0xff00) == 0xe000 {
        u32::from(scancode & 0x00ff) | FREERDP_KBDEXT
    } else {
        u32::from(scancode)
    }
}
