//! 帧缓冲区管理模块
//!
//! 提供对 VNC 帧缓冲区的安全访问和像素格式转换

#![allow(dead_code)]

use std::sync::Arc;
use parking_lot::RwLock;

/// 像素格式定义
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PixelFormat {
    pub bits_per_pixel: u8,
    pub depth: u8,
    pub big_endian: bool,
    pub true_colour: bool,
    pub red_max: u16,
    pub green_max: u16,
    pub blue_max: u16,
    pub red_shift: u8,
    pub green_shift: u8,
    pub blue_shift: u8,
}

impl Default for PixelFormat {
    fn default() -> Self {
        Self {
            bits_per_pixel: 32,
            depth: 24,
            big_endian: false,
            true_colour: true,
            red_max: 255,
            green_max: 255,
            blue_max: 255,
            red_shift: 16,
            green_shift: 8,
            blue_shift: 0,
        }
    }
}

impl PixelFormat {
    /// 创建 RGBA8888 格式
    pub fn rgba8888() -> Self {
        Self {
            bits_per_pixel: 32,
            depth: 24,
            big_endian: false,
            true_colour: true,
            red_max: 255,
            green_max: 255,
            blue_max: 255,
            red_shift: 16,
            green_shift: 8,
            blue_shift: 0,
        }
    }
    
    /// 计算每像素字节数
    pub fn bytes_per_pixel(&self) -> usize {
        (self.bits_per_pixel as usize + 7) / 8
    }
}

/// 帧缓冲区
/// 
/// 线程安全的帧缓冲区包装器，支持读写锁
#[derive(Debug, Clone)]
pub struct FrameBuffer {
    inner: Arc<RwLock<FrameBufferInner>>,
}

#[derive(Debug)]
struct FrameBufferInner {
    width: u16,
    height: u16,
    data: Vec<u8>,
    format: PixelFormat,
}

impl FrameBuffer {
    /// 创建新的帧缓冲区
    pub fn new(width: u16, height: u16, format: PixelFormat) -> Self {
        let size = width as usize * height as usize * format.bytes_per_pixel();
        Self {
            inner: Arc::new(RwLock::new(FrameBufferInner {
                width,
                height,
                data: vec![0; size],
                format,
            })),
        }
    }
    
    /// 获取尺寸
    pub fn size(&self) -> (u16, u16) {
        let inner = self.inner.read();
        (inner.width, inner.height)
    }
    
    /// 获取像素格式
    pub fn format(&self) -> PixelFormat {
        self.inner.read().format
    }
    
    /// 获取原始数据副本（RGBA 格式）
    /// 
    /// 如果内部格式不是 RGBA，会进行转换
    pub fn get_rgba(&self) -> (u16, u16, Vec<u8>) {
        let inner = self.inner.read();
        
        if inner.format.bits_per_pixel == 32 {
            // 已经是 RGBA，直接复制
            (inner.width, inner.height, inner.data.clone())
        } else {
            // 需要格式转换
            let rgba = convert_to_rgba(&inner.data, inner.width, inner.height, &inner.format);
            (inner.width, inner.height, rgba)
        }
    }
    
    /// 获取指定区域的 RGBA 数据
    pub fn get_region_rgba(&self, x: u16, y: u16, width: u16, height: u16) -> Option<Vec<u8>> {
        let inner = self.inner.read();
        
        if x + width > inner.width || y + height > inner.height {
            return None;
        }
        
        let bytes_per_pixel = inner.format.bytes_per_pixel();
        let stride = inner.width as usize * bytes_per_pixel;
        let region_stride = width as usize * 4; // RGBA output
        
        let mut region = vec![0u8; width as usize * height as usize * 4];
        
        for row in 0..height as usize {
            let src_y = y as usize + row;
            let src_start = src_y * stride + x as usize * bytes_per_pixel;
            let dest_start = row * region_stride;
            
            for col in 0..width as usize {
                let src_idx = src_start + col * bytes_per_pixel;
                let dest_idx = dest_start + col * 4;
                
                if inner.format.bits_per_pixel == 32 {
                    // 假设 BGRA 格式（LibVNCClient 默认）
                    region[dest_idx] = inner.data[src_idx + 2];     // R
                    region[dest_idx + 1] = inner.data[src_idx + 1]; // G
                    region[dest_idx + 2] = inner.data[src_idx];     // B
                    region[dest_idx + 3] = inner.data[src_idx + 3]; // A
                } else {
                    // 其他格式需要更复杂的转换
                    // 这里简化处理，实际使用时应根据 format 字段进行转换
                    region[dest_idx] = inner.data[src_idx];
                    region[dest_idx + 1] = inner.data[src_idx];
                    region[dest_idx + 2] = inner.data[src_idx];
                    region[dest_idx + 3] = 255;
                }
            }
        }
        
        Some(region)
    }
    
    /// 更新帧缓冲区（内部使用）
    pub(crate) fn update<F>(&self, f: F)
    where
        F: FnOnce(&mut [u8], u16, u16, PixelFormat),
    {
        let mut inner = self.inner.write();
        let width = inner.width;
        let height = inner.height;
        let format = inner.format;
        f(&mut inner.data, width, height, format);
    }
    
    /// 调整大小（内部使用）
    pub(crate) fn resize(&self, width: u16, height: u16) {
        let mut inner = self.inner.write();
        inner.width = width;
        inner.height = height;
        let new_size = width as usize * height as usize * inner.format.bytes_per_pixel();
        inner.data.resize(new_size, 0);
    }
}

/// 将各种像素格式转换为 RGBA
fn convert_to_rgba(data: &[u8], width: u16, height: u16, format: &PixelFormat) -> Vec<u8> {
    if format.bits_per_pixel == 32 {
        // BGRA to RGBA
        let mut rgba = vec![0u8; data.len()];
        for i in (0..data.len()).step_by(4) {
            rgba[i] = data[i + 2];     // R
            rgba[i + 1] = data[i + 1]; // G
            rgba[i + 2] = data[i];     // B
            rgba[i + 3] = data[i + 3]; // A
        }
        rgba
    } else if format.bits_per_pixel == 16 {
        // RGB565 to RGBA
        let pixel_count = width as usize * height as usize;
        let mut rgba = vec![0u8; pixel_count * 4];
        
        for i in 0..pixel_count {
            let pixel = u16::from_le_bytes([data[i * 2], data[i * 2 + 1]]);
            let r = ((pixel >> 11) & 0x1F) as u8;
            let g = ((pixel >> 5) & 0x3F) as u8;
            let b = (pixel & 0x1F) as u8;
            
            // 扩展到 8 位
            rgba[i * 4] = (r << 3) | (r >> 2);
            rgba[i * 4 + 1] = (g << 2) | (g >> 4);
            rgba[i * 4 + 2] = (b << 3) | (b >> 2);
            rgba[i * 4 + 3] = 255;
        }
        rgba
    } else {
        // 其他格式：简单复制并填充 alpha
        let pixel_count = width as usize * height as usize;
        let mut rgba = vec![0u8; pixel_count * 4];
        let bytes_per_pixel = (format.bits_per_pixel as usize + 7) / 8;
        
        for i in 0..pixel_count.min(data.len() / bytes_per_pixel) {
            let src_idx = i * bytes_per_pixel;
            let dest_idx = i * 4;
            
            // 简化处理：复制第一个通道到 RGB，设置 A=255
            rgba[dest_idx] = data[src_idx];
            rgba[dest_idx + 1] = data[src_idx];
            rgba[dest_idx + 2] = data[src_idx];
            rgba[dest_idx + 3] = 255;
        }
        rgba
    }
}
