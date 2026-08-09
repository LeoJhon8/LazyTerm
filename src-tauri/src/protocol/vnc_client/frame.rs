//! 帧缓冲区管理模块
//!
//! 负责保存客户端内的标准 RGBA 桌面快照，并封装服务端原始像素到 RGBA 的转换。

#![allow(dead_code)]

use std::sync::Arc;

use parking_lot::RwLock;

use super::super::vnc_ffi::RfbPixelFormat;

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
        Self::rgba8888()
    }
}

impl PixelFormat {
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
}

#[derive(Debug, Clone, Copy)]
pub struct FrameUpdateRegion {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
}

/// 帧缓冲区
///
/// 统一以 RGBA8888 保存桌面图像，避免更高层再接触 libvncclient 的像素格式细节。
#[derive(Debug, Clone)]
pub struct FrameBuffer {
    inner: Arc<RwLock<FrameBufferInner>>,
}

#[derive(Debug)]
struct FrameBufferInner {
    width: u16,
    height: u16,
    data: Vec<u8>,
}

impl FrameBuffer {
    pub fn new(width: u16, height: u16) -> Self {
        let size = width as usize * height as usize * 4;
        Self {
            inner: Arc::new(RwLock::new(FrameBufferInner {
                width,
                height,
                data: vec![0; size],
            })),
        }
    }

    pub fn size(&self) -> (u16, u16) {
        let inner = self.inner.read();
        (inner.width, inner.height)
    }

    pub fn snapshot_rgba(&self) -> (u16, u16, Vec<u8>) {
        let inner = self.inner.read();
        (inner.width, inner.height, inner.data.clone())
    }

    pub fn snapshot_region_rgba(&self, region: FrameUpdateRegion) -> Option<Vec<u8>> {
        let inner = self.inner.read();
        let width = inner.width as usize;
        let height = inner.height as usize;

        if region.width == 0 || region.height == 0 || region.x >= width || region.y >= height {
            return None;
        }

        let clipped_width = region.width.min(width - region.x);
        let clipped_height = region.height.min(height - region.y);
        let mut region_data = vec![0u8; clipped_width.checked_mul(clipped_height)?.checked_mul(4)?];
        let framebuffer_stride = width * 4;
        let region_stride = clipped_width * 4;

        for row in 0..clipped_height {
            let src_start = (region.y + row) * framebuffer_stride + region.x * 4;
            let dst_start = row * region_stride;
            let row_size = region_stride;
            region_data[dst_start..dst_start + row_size]
                .copy_from_slice(&inner.data[src_start..src_start + row_size]);
        }

        Some(region_data)
    }

    pub(crate) fn try_resize(&self, width: u16, height: u16) -> bool {
        let Some(required_len) = (width as usize)
            .checked_mul(height as usize)
            .and_then(|pixels| pixels.checked_mul(4))
        else {
            return false;
        };
        let mut inner = self.inner.write();
        let current_len = inner.data.len();
        if required_len > inner.data.capacity()
            && inner
                .data
                .try_reserve_exact(required_len - current_len)
                .is_err()
        {
            return false;
        }
        inner.width = width;
        inner.height = height;
        inner.data.resize(required_len, 0);
        true
    }

    pub(crate) fn write_native_region(
        &self,
        region: FrameUpdateRegion,
        server_format: RfbPixelFormat,
        source: &[u8],
    ) -> Option<FrameUpdateRegion> {
        let mut inner = self.inner.write();
        let width = inner.width as usize;
        let height = inner.height as usize;

        if region.width == 0 || region.height == 0 || region.x >= width || region.y >= height {
            return None;
        }

        let clipped_width = region.width.min(width - region.x);
        let clipped_height = region.height.min(height - region.y);
        let source_bpp = bytes_per_pixel(server_format);
        if source_bpp == 0 {
            return None;
        }

        let required_len = clipped_width
            .checked_mul(clipped_height)?
            .checked_mul(source_bpp)?;
        if source.len() < required_len {
            return None;
        }

        let framebuffer_stride = width * 4;
        let source_stride = clipped_width * source_bpp;

        if is_bgrx8888_format(server_format) {
            for row in 0..clipped_height {
                let dest_y = region.y + row;
                let dest_row = dest_y * framebuffer_stride + region.x * 4;
                let src_row = row * source_stride;
                let dest_slice = &mut inner.data[dest_row..dest_row + clipped_width * 4];
                let source_slice = &source[src_row..src_row + source_stride];

                for (dest_px, src_px) in dest_slice
                    .chunks_exact_mut(4)
                    .zip(source_slice.chunks_exact(4))
                {
                    dest_px[0] = src_px[2];
                    dest_px[1] = src_px[1];
                    dest_px[2] = src_px[0];
                    dest_px[3] = 255;
                }
            }

            return Some(FrameUpdateRegion {
                x: region.x,
                y: region.y,
                width: clipped_width,
                height: clipped_height,
            });
        }

        for row in 0..clipped_height {
            let dest_y = region.y + row;
            let dest_row = dest_y * framebuffer_stride + region.x * 4;
            let src_row = row * source_stride;

            for col in 0..clipped_width {
                let source_idx = src_row + col * source_bpp;
                let dest_idx = dest_row + col * 4;
                let rgba = decode_pixel_to_rgba(
                    server_format,
                    &source[source_idx..source_idx + source_bpp],
                );
                inner.data[dest_idx..dest_idx + 4].copy_from_slice(&rgba);
            }
        }

        Some(FrameUpdateRegion {
            x: region.x,
            y: region.y,
            width: clipped_width,
            height: clipped_height,
        })
    }

    pub(crate) unsafe fn write_native_region_from_framebuffer(
        &self,
        region: FrameUpdateRegion,
        server_format: RfbPixelFormat,
        framebuffer_ptr: *const u8,
        source_stride: usize,
    ) -> Option<FrameUpdateRegion> {
        if framebuffer_ptr.is_null() {
            return None;
        }

        let mut inner = self.inner.write();
        let width = inner.width as usize;
        let height = inner.height as usize;

        if region.width == 0 || region.height == 0 || region.x >= width || region.y >= height {
            return None;
        }

        let clipped_width = region.width.min(width - region.x);
        let clipped_height = region.height.min(height - region.y);
        let source_bpp = bytes_per_pixel(server_format);
        if source_bpp == 0 {
            return None;
        }

        let framebuffer_stride = width * 4;
        let source_row_size = clipped_width.checked_mul(source_bpp)?;

        if is_bgrx8888_format(server_format) {
            for row in 0..clipped_height {
                let dest_y = region.y + row;
                let dest_row = dest_y * framebuffer_stride + region.x * 4;
                let src_row_ptr =
                    framebuffer_ptr.add((region.y + row) * source_stride + region.x * source_bpp);
                let source_slice = std::slice::from_raw_parts(src_row_ptr, source_row_size);
                let dest_slice = &mut inner.data[dest_row..dest_row + clipped_width * 4];

                for (dest_px, src_px) in dest_slice
                    .chunks_exact_mut(4)
                    .zip(source_slice.chunks_exact(4))
                {
                    dest_px[0] = src_px[2];
                    dest_px[1] = src_px[1];
                    dest_px[2] = src_px[0];
                    dest_px[3] = 255;
                }
            }

            return Some(FrameUpdateRegion {
                x: region.x,
                y: region.y,
                width: clipped_width,
                height: clipped_height,
            });
        }

        for row in 0..clipped_height {
            let dest_y = region.y + row;
            let dest_row = dest_y * framebuffer_stride + region.x * 4;
            let src_row_ptr =
                framebuffer_ptr.add((region.y + row) * source_stride + region.x * source_bpp);
            let source_slice = std::slice::from_raw_parts(src_row_ptr, source_row_size);

            for col in 0..clipped_width {
                let source_idx = col * source_bpp;
                let dest_idx = dest_row + col * 4;
                let rgba = decode_pixel_to_rgba(
                    server_format,
                    &source_slice[source_idx..source_idx + source_bpp],
                );
                inner.data[dest_idx..dest_idx + 4].copy_from_slice(&rgba);
            }
        }

        Some(FrameUpdateRegion {
            x: region.x,
            y: region.y,
            width: clipped_width,
            height: clipped_height,
        })
    }
}

fn bytes_per_pixel(format: RfbPixelFormat) -> usize {
    usize::from(format.bits_per_pixel).div_ceil(8)
}

fn is_bgrx8888_format(format: RfbPixelFormat) -> bool {
    format.bits_per_pixel == 32
        && format.big_endian == 0
        && format.true_colour != 0
        && format.red_max == 255
        && format.green_max == 255
        && format.blue_max == 255
        && format.red_shift == 16
        && format.green_shift == 8
        && format.blue_shift == 0
}

fn expand_channel(value: u32, max: u32) -> u8 {
    if max == 0 {
        return 0;
    }

    (((value as u64) * 255) / (max as u64)) as u8
}

fn decode_pixel_to_rgba(format: RfbPixelFormat, pixel: &[u8]) -> [u8; 4] {
    let bytes_per_pixel = bytes_per_pixel(format);
    if pixel.len() < bytes_per_pixel {
        return [0, 0, 0, 255];
    }

    let raw = if format.big_endian != 0 {
        pixel
            .iter()
            .take(bytes_per_pixel)
            .fold(0u32, |acc, byte| (acc << 8) | u32::from(*byte))
    } else {
        pixel
            .iter()
            .take(bytes_per_pixel)
            .enumerate()
            .fold(0u32, |acc, (index, byte)| {
                acc | (u32::from(*byte) << (index * 8))
            })
    };

    if format.true_colour != 0 && format.red_max > 0 && format.green_max > 0 && format.blue_max > 0
    {
        let red_max = u32::from(format.red_max);
        let green_max = u32::from(format.green_max);
        let blue_max = u32::from(format.blue_max);
        let red = (raw >> format.red_shift) & red_max;
        let green = (raw >> format.green_shift) & green_max;
        let blue = (raw >> format.blue_shift) & blue_max;

        return [
            expand_channel(red, red_max),
            expand_channel(green, green_max),
            expand_channel(blue, blue_max),
            255,
        ];
    }

    match bytes_per_pixel {
        4 | 3 => [pixel[2], pixel[1], pixel[0], 255],
        2 => {
            let packed = u16::from_le_bytes([pixel[0], pixel[1]]);
            let red = ((packed >> 11) & 0x1f) as u32;
            let green = ((packed >> 5) & 0x3f) as u32;
            let blue = (packed & 0x1f) as u32;
            [
                expand_channel(red, 0x1f),
                expand_channel(green, 0x3f),
                expand_channel(blue, 0x1f),
                255,
            ]
        }
        1 => [pixel[0], pixel[0], pixel[0], 255],
        _ => [0, 0, 0, 255],
    }
}

pub(crate) fn decode_cursor_to_rgba(
    width: usize,
    height: usize,
    server_format: RfbPixelFormat,
    source: &[u8],
    mask: &[u8],
) -> Option<Vec<u8>> {
    let pixel_count = width.checked_mul(height)?;
    let source_bpp = bytes_per_pixel(server_format);
    let source_len = pixel_count.checked_mul(source_bpp)?;
    if source_bpp == 0 || source.len() < source_len || mask.len() < pixel_count {
        return None;
    }

    let mut rgba = Vec::with_capacity(pixel_count.checked_mul(4)?);
    for (index, source_pixel) in source[..source_len].chunks_exact(source_bpp).enumerate() {
        let mut decoded = decode_pixel_to_rgba(server_format, source_pixel);
        decoded[3] = if mask[index] == 0 { 0 } else { 255 };
        rgba.extend_from_slice(&decoded);
    }

    Some(rgba)
}
