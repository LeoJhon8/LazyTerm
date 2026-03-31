//! 回调处理模块
//!
//! 管理 LibVNCClient 的 C 回调与 Rust 代码的桥接
//! 使用 thread-local 存储和通道实现安全的回调传递

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_uchar, c_void, CStr};
use std::os::raw::{c_schar, c_uint};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, Weak};
use once_cell::sync::Lazy;

use super::super::vnc_ffi as ffi;
use super::frame::{FrameBuffer, PixelFormat};
use super::ClipboardEvent;

/// 帧缓冲区更新信息
#[derive(Debug, Clone)]
pub struct FrameBufferUpdate {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

/// 光标信息
#[derive(Debug, Clone)]
pub struct CursorInfo {
    pub hotspot_x: u16,
    pub hotspot_y: u16,
    pub width: u16,
    pub height: u16,
    pub rgba_data: Vec<u8>, // RGBA 格式
}

/// 回调事件类型
#[derive(Debug)]
pub enum CallbackEvent {
    FrameBufferUpdate(FrameBufferUpdate),
    CursorShape(CursorInfo),
    Clipboard(ClipboardEvent),
    CursorPosition { x: u16, y: u16 },
    ResolutionChange { width: u16, height: u16 },
}

/// 会话上下文
/// 
/// 每个 VNC 连接都有一个对应的上下文，存储回调状态
pub(crate) struct SessionContext {
    pub session_id: String,
    pub event_sender: Sender<CallbackEvent>,
    pub framebuffer: FrameBuffer,
}

// ============================================================================
// 全局会话管理
// ============================================================================

/// 全局会话映射表
/// 
/// 使用 Mutex 保护，因为回调可能从任意线程调用
static SESSIONS: Lazy<Mutex<HashMap<usize, Weak<SessionContext>>>> = 
    Lazy::new(|| Mutex::new(HashMap::new()));

/// 注册会话
pub(crate) fn register_session(ptr: usize, context: Weak<SessionContext>) {
    let mut sessions = SESSIONS.lock().unwrap();
    sessions.insert(ptr, context);
}

/// 注销会话
pub(crate) fn unregister_session(ptr: usize) {
    let mut sessions = SESSIONS.lock().unwrap();
    sessions.remove(&ptr);
}

/// 获取会话上下文
fn get_context(ptr: usize) -> Option<Arc<SessionContext>> {
    let sessions = SESSIONS.lock().unwrap();
    sessions.get(&ptr).and_then(|weak| weak.upgrade())
}

// ============================================================================
// C 回调函数
// ============================================================================

/// 帧缓冲区更新回调
/// 
/// # Safety
/// 此函数在 LibVNCClient 内部线程中调用
pub unsafe extern "C" fn framebuffer_update_callback(
    client: *mut ffi::RfbClient,
    x: c_int,
    y: c_int,
    w: c_int,
    h: c_int,
) {
    let ptr = client as usize;
    
    if let Some(ctx) = get_context(ptr) {
        // 获取帧缓冲区数据
        let fb_ptr = ffi::RfbClientGetFrameBuffer(client);
        if !fb_ptr.is_null() {
            let (fb_width, fb_height) = ctx.framebuffer.size();
            let bytes_per_pixel = 4; // LibVNCClient 默认使用 32 位
            let stride = fb_width as usize * bytes_per_pixel;
            
            // 计算需要复制的区域
            let region_size = (w * h * bytes_per_pixel as c_int) as usize;
            let mut region_data = vec![0u8; region_size];
            
            for row in 0..h as usize {
                let src_y = y as usize + row;
                let src_start = src_y * stride + x as usize * bytes_per_pixel;
                let dest_start = row * w as usize * bytes_per_pixel;
                let row_size = w as usize * bytes_per_pixel;
                
                // 从原始帧缓冲区复制
                std::ptr::copy_nonoverlapping(
                    fb_ptr.add(src_start),
                    region_data.as_mut_ptr().add(dest_start),
                    row_size,
                );
            }
            
            // BGRA 转换为 RGBA
            for i in (0..region_data.len()).step_by(4) {
                let b = region_data[i];
                region_data[i] = region_data[i + 2]; // R
                region_data[i + 2] = b;             // B
                // G 和 A 保持不变
            }
            
            // 更新内部帧缓冲区
            ctx.framebuffer.update(|data, fb_w, _fb_h, _format| {
                let fb_stride = fb_w as usize * 4;
                let region_stride = w as usize * 4;
                
                for row in 0..h as usize {
                    let dest_y = y as usize + row;
                    let dest_start = dest_y * fb_stride + x as usize * 4;
                    let src_start = row * region_stride;
                    let row_size = region_stride;
                    
                    data[dest_start..dest_start + row_size]
                        .copy_from_slice(&region_data[src_start..src_start + row_size]);
                }
            });
        }
        
        // 发送更新事件
        let _ = ctx.event_sender.send(CallbackEvent::FrameBufferUpdate(FrameBufferUpdate {
            x: x as u16,
            y: y as u16,
            width: w as u16,
            height: h as u16,
        }));
    }
}

/// 光标形状处理回调
/// 
/// # Safety
/// 此函数在 LibVNCClient 内部线程中调用
pub unsafe extern "C" fn handle_cursor_shape_callback(
    client: *mut ffi::RfbClient,
    xhot: c_int,
    yhot: c_int,
    width: c_int,
    height: c_int,
    bytes_per_row: c_int,
    mask: *mut c_uchar,
) {
    let ptr = client as usize;
    
    if let Some(ctx) = get_context(ptr) {
        let cursor_size = (width * height * 4) as usize;
        let mut rgba_data = vec![0u8; cursor_size];
        
        if !mask.is_null() {
            // LibVNCClient 提供的光标数据格式需要解析
            // 简化处理：假设是标准的光标位图格式
            let mask_slice = std::slice::from_raw_parts(mask, (bytes_per_row * height) as usize);
            
            // 这里需要根据实际情况解析光标数据
            // 标准 X11 光标格式包含位图和掩码
            for y in 0..height as usize {
                for x in 0..width as usize {
                    let idx = (y * width as usize + x) * 4;
                    let mask_idx = y * bytes_per_row as usize + x / 8;
                    let bit = 7 - (x % 8);
                    let visible = (mask_slice[mask_idx] >> bit) & 1 != 0;
                    
                    if visible {
                        // 白色光标（简化）
                        rgba_data[idx] = 255;     // R
                        rgba_data[idx + 1] = 255; // G
                        rgba_data[idx + 2] = 255; // B
                        rgba_data[idx + 3] = 255; // A
                    } else {
                        rgba_data[idx + 3] = 0;   // 透明
                    }
                }
            }
        }
        
        let _ = ctx.event_sender.send(CallbackEvent::CursorShape(CursorInfo {
            hotspot_x: xhot as u16,
            hotspot_y: yhot as u16,
            width: width as u16,
            height: height as u16,
            rgba_data,
        }));
    }
}

/// 剪贴板文本回调
/// 
/// # Safety
/// 此函数在 LibVNCClient 内部线程中调用
pub unsafe extern "C" fn got_xcut_text_callback(
    client: *mut ffi::RfbClient,
    text: *mut c_char,
    len: c_int,
) {
    let ptr = client as usize;
    
    if let Some(ctx) = get_context(ptr) {
        if !text.is_null() && len > 0 {
            let text_slice = std::slice::from_raw_parts(text as *const u8, len as usize);
            if let Ok(text_str) = String::from_utf8(text_slice.to_vec()) {
                let _ = ctx.event_sender.send(CallbackEvent::Clipboard(ClipboardEvent {
                    text: text_str,
                }));
            }
        }
    }
}

/// 鼠标位置回调
/// 
/// # Safety
/// 此函数在 LibVNCClient 内部线程中调用
pub unsafe extern "C" fn got_cursor_pos_callback(
    client: *mut ffi::RfbClient,
    x: c_int,
    y: c_int,
) {
    let ptr = client as usize;
    
    if let Some(ctx) = get_context(ptr) {
        let _ = ctx.event_sender.send(CallbackEvent::CursorPosition {
            x: x as u16,
            y: y as u16,
        });
    }
}

/// 分辨率变更回调（实际上是 MallocFrameBuffer 回调）
/// 
/// # Safety
/// 此函数在 LibVNCClient 内部线程中调用
pub unsafe extern "C" fn malloc_framebuffer_callback(
    client: *mut ffi::RfbClient,
) {
    let ptr = client as usize;
    
    if let Some(ctx) = get_context(ptr) {
        let width = ffi::RfbClientGetScreenWidth(client) as u16;
        let height = ffi::RfbClientGetScreenHeight(client) as u16;
        
        ctx.framebuffer.resize(width, height);
        
        let _ = ctx.event_sender.send(CallbackEvent::ResolutionChange { width, height });
    }
}
