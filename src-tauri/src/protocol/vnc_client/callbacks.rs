//! C callback bridge for libvncclient.
//!
//! This layer should stay thin: collect raw callback data, update the client framebuffer,
//! and publish high-level client events to Rust.

use std::collections::HashMap;
use std::ffi::{c_char, c_int};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, Weak};

use once_cell::sync::Lazy;

use super::super::vnc_ffi as ffi;
use super::frame::{FrameBuffer, FrameUpdateRegion};
use super::ClipboardEvent;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct FrameBufferUpdate {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct CursorInfo {
    pub hotspot_x: u16,
    pub hotspot_y: u16,
    pub width: u16,
    pub height: u16,
    pub rgba_data: Vec<u8>,
}

#[allow(dead_code)]
#[derive(Debug)]
pub enum CallbackEvent {
    FrameBufferUpdate(FrameBufferUpdate),
    CursorShape(CursorInfo),
    Clipboard(ClipboardEvent),
    CursorPosition { x: u16, y: u16 },
    ResolutionChange { width: u16, height: u16 },
}

pub(crate) struct SessionContext {
    pub event_sender: Sender<CallbackEvent>,
    pub framebuffer: FrameBuffer,
}

static SESSIONS: Lazy<Mutex<HashMap<usize, Weak<SessionContext>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(crate) fn register_session(ptr: usize, context: Weak<SessionContext>) {
    let mut sessions = SESSIONS.lock().unwrap();
    sessions.insert(ptr, context);
}

pub(crate) fn unregister_session(ptr: usize) {
    let mut sessions = SESSIONS.lock().unwrap();
    sessions.remove(&ptr);
}

fn get_context(ptr: usize) -> Option<Arc<SessionContext>> {
    let sessions = SESSIONS.lock().unwrap();
    sessions.get(&ptr).and_then(|weak| weak.upgrade())
}

unsafe fn framebuffer_update_callback_impl(
    client: *mut ffi::RfbClient,
    x: c_int,
    y: c_int,
    w: c_int,
    h: c_int,
) {
    let ptr = client as usize;

    if let Some(ctx) = get_context(ptr) {
        if x < 0 || y < 0 || w <= 0 || h <= 0 {
            return;
        }

        let raw_framebuffer = ffi::RfbClientGetFrameBuffer(client);
        if raw_framebuffer.is_null() {
            return;
        }

        let pixel_format = ffi::RfbClientGetPixelFormat(client);
        let bytes_per_pixel = usize::from(pixel_format.bits_per_pixel).div_ceil(8);
        if bytes_per_pixel == 0 {
            return;
        }

        let (fb_width, fb_height) = ctx.framebuffer.size();
        let x = x as usize;
        let y = y as usize;
        let width = w as usize;
        let height = h as usize;

        if x >= fb_width as usize || y >= fb_height as usize {
            return;
        }

        let copy_width = width.min(fb_width as usize - x);
        let copy_height = height.min(fb_height as usize - y);
        let source_stride = fb_width as usize * bytes_per_pixel;
        let updated_region = ctx.framebuffer.write_native_region_from_framebuffer(
            FrameUpdateRegion {
                x,
                y,
                width: copy_width,
                height: copy_height,
            },
            pixel_format,
            raw_framebuffer.cast_const(),
            source_stride,
        );

        if let Some(region) = updated_region {
            let _ = ctx
                .event_sender
                .send(CallbackEvent::FrameBufferUpdate(FrameBufferUpdate {
                    x: region.x as u16,
                    y: region.y as u16,
                    width: region.width as u16,
                    height: region.height as u16,
                }));
        }
    }
}

pub unsafe extern "C" fn framebuffer_update_callback(
    client: *mut ffi::RfbClient,
    x: c_int,
    y: c_int,
    w: c_int,
    h: c_int,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        framebuffer_update_callback_impl(client, x, y, w, h);
    }));
}

unsafe fn handle_cursor_shape_callback_impl(
    client: *mut ffi::RfbClient,
    xhot: c_int,
    yhot: c_int,
    width: c_int,
    height: c_int,
    _bytes_per_pixel: c_int,
) {
    let ptr = client as usize;

    if let Some(ctx) = get_context(ptr) {
        let cursor_size = (width.max(0) as usize)
            .saturating_mul(height.max(0) as usize)
            .saturating_mul(4);

        let _ = ctx.event_sender.send(CallbackEvent::CursorShape(CursorInfo {
            hotspot_x: xhot.max(0) as u16,
            hotspot_y: yhot.max(0) as u16,
            width: width.max(0) as u16,
            height: height.max(0) as u16,
            rgba_data: vec![0u8; cursor_size],
        }));
    }
}

pub unsafe extern "C" fn handle_cursor_shape_callback(
    client: *mut ffi::RfbClient,
    xhot: c_int,
    yhot: c_int,
    width: c_int,
    height: c_int,
    bytes_per_pixel: c_int,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        handle_cursor_shape_callback_impl(client, xhot, yhot, width, height, bytes_per_pixel);
    }));
}

unsafe fn got_xcut_text_callback_impl(
    client: *mut ffi::RfbClient,
    text: *mut c_char,
    len: c_int,
) {
    let ptr = client as usize;

    if let Some(ctx) = get_context(ptr) {
        if !text.is_null() && len > 0 {
            let text_slice = std::slice::from_raw_parts(text as *const u8, len as usize);
            if let Ok(text_str) = String::from_utf8(text_slice.to_vec()) {
                let _ = ctx
                    .event_sender
                    .send(CallbackEvent::Clipboard(ClipboardEvent { text: text_str }));
            }
        }
    }
}

pub unsafe extern "C" fn got_xcut_text_callback(
    client: *mut ffi::RfbClient,
    text: *mut c_char,
    len: c_int,
) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        got_xcut_text_callback_impl(client, text, len);
    }));
}

unsafe fn got_cursor_pos_callback_impl(
    client: *mut ffi::RfbClient,
    x: c_int,
    y: c_int,
) -> i8 {
    let ptr = client as usize;

    if let Some(ctx) = get_context(ptr) {
        let _ = ctx.event_sender.send(CallbackEvent::CursorPosition {
            x: x.max(0) as u16,
            y: y.max(0) as u16,
        });
    }

    -1
}

pub unsafe extern "C" fn got_cursor_pos_callback(
    client: *mut ffi::RfbClient,
    x: c_int,
    y: c_int,
) -> i8 {
    catch_unwind(AssertUnwindSafe(|| got_cursor_pos_callback_impl(client, x, y))).unwrap_or(-1)
}

unsafe fn malloc_framebuffer_callback_impl(client: *mut ffi::RfbClient) -> i8 {
    let ptr = client as usize;

    if let Some(ctx) = get_context(ptr) {
        let width = ffi::RfbClientGetScreenWidth(client).max(0) as u16;
        let height = ffi::RfbClientGetScreenHeight(client).max(0) as u16;

        ctx.framebuffer.resize(width, height);

        let _ = ctx
            .event_sender
            .send(CallbackEvent::ResolutionChange { width, height });
    }

    ffi::RfbClientDefaultMallocFrameBuffer(client)
}

pub unsafe extern "C" fn malloc_framebuffer_callback(client: *mut ffi::RfbClient) -> i8 {
    catch_unwind(AssertUnwindSafe(|| malloc_framebuffer_callback_impl(client))).unwrap_or(0)
}
