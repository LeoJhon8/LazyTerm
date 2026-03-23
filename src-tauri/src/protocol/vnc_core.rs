//! VNC 核心逻辑模块
//! 包含 VNC 帧处理、光标同步和会话运行逻辑

use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;

use crate::types::{VncControlMsg, VncControlOutcome, VncCursorEventPayload};
use crate::utils::log_vnc_info;
use vnc::{
    ClientKeyEvent as VncClientKeyEvent,
    ClientMouseEvent as VncClientMouseEvent,
    VncClient,
    VncEvent,
    X11Event,
};

// ============================================================================
// 常量
// ============================================================================

const VNC_INPUT_REFRESH_DELAY: Duration = Duration::from_millis(75);
const VNC_IDLE_KEEPALIVE_INTERVAL: Duration = Duration::from_millis(1000);
const VNC_SNAPSHOT_COMMIT_DELAY: Duration = Duration::from_millis(60);

// ============================================================================
// VNC 帧发射
// ============================================================================

fn emit_vnc_frame(
    frame_channel: &tauri::ipc::Channel<Response>,
    desktop_width: u16,
    desktop_height: u16,
    region_left: u16,
    region_top: u16,
    region_width: u16,
    region_height: u16,
    encoding_rgba: bool,
    is_png: bool,
    image_bytes: Vec<u8>,
) -> Result<(), String> {
    let full_frame = region_left == 0
        && region_top == 0
        && region_width == desktop_width
        && region_height == desktop_height;

    let mut packet = Vec::with_capacity(13 + image_bytes.len());
    packet.extend_from_slice(&desktop_width.to_le_bytes());
    packet.extend_from_slice(&desktop_height.to_le_bytes());
    packet.extend_from_slice(&region_left.to_le_bytes());
    packet.extend_from_slice(&region_top.to_le_bytes());
    packet.extend_from_slice(&region_width.to_le_bytes());
    packet.extend_from_slice(&region_height.to_le_bytes());

    let mut flags = 0u8;
    if full_frame {
        flags |= 0x01;
    }
    if encoding_rgba {
        flags |= 0x02;
    }
    if is_png {
        flags |= 0x04;
    }

    packet.push(flags);
    packet.extend_from_slice(&image_bytes);

    frame_channel
        .send(Response::new(packet))
        .map_err(|e| format!("send VNC frame via channel failed: {e}"))
}

// ============================================================================
// VNC 快照缓冲区和 BLIT
// ============================================================================

fn ensure_vnc_snapshot_buffer(
    snapshot_rgba: &mut Vec<u8>,
    desktop_width: u16,
    desktop_height: u16,
) -> Result<(), String> {
    if desktop_width == 0 || desktop_height == 0 {
        return Err("VNC desktop size is zero".to_string());
    }

    let expected_len = desktop_width as usize * desktop_height as usize * 4;
    if snapshot_rgba.len() != expected_len {
        snapshot_rgba.clear();
        snapshot_rgba.resize(expected_len, 0);
    }

    Ok(())
}

fn blit_vnc_rgba_rect(
    snapshot_rgba: &mut [u8],
    desktop_width: u16,
    desktop_height: u16,
    region_left: u16,
    region_top: u16,
    region_width: u16,
    region_height: u16,
    rgba_bytes: &[u8],
) -> Result<(), String> {
    let expected_len = region_width as usize * region_height as usize * 4;
    if rgba_bytes.len() != expected_len {
        return Err(format!(
            "VNC frame size mismatch: expected {} bytes, got {} bytes",
            expected_len,
            rgba_bytes.len()
        ));
    }

    if region_left as usize + region_width as usize > desktop_width as usize
        || region_top as usize + region_height as usize > desktop_height as usize
    {
        return Err(format!(
            "VNC frame region out of bounds: region={}x{}@{},{} desktop={}x{}",
            region_width,
            region_height,
            region_left,
            region_top,
            desktop_width,
            desktop_height
        ));
    }

    let desktop_stride = desktop_width as usize * 4;
    let region_stride = region_width as usize * 4;
    let dest_x = region_left as usize * 4;

    for row in 0..region_height as usize {
        let source_start = row * region_stride;
        let source_end = source_start + region_stride;
        let dest_start = (region_top as usize + row) * desktop_stride + dest_x;
        let dest_end = dest_start + region_stride;
        snapshot_rgba[dest_start..dest_end].copy_from_slice(&rgba_bytes[source_start..source_end]);
    }

    Ok(())
}

fn decode_vnc_jpeg_rect(jpeg_bytes: &[u8], region_width: u16, region_height: u16) -> Result<Vec<u8>, String> {
    let decoded = image::load_from_memory_with_format(jpeg_bytes, image::ImageFormat::Jpeg)
        .map_err(|e| format!("decode VNC JPEG frame failed: {e}"))?
        .to_rgba8();

    if decoded.width() != region_width as u32 || decoded.height() != region_height as u32 {
        return Err(format!(
            "decoded VNC JPEG size mismatch: expected {}x{}, got {}x{}",
            region_width,
            region_height,
            decoded.width(),
            decoded.height()
        ));
    }

    Ok(decoded.into_raw())
}

fn emit_vnc_snapshot(
    frame_channel: &tauri::ipc::Channel<Response>,
    desktop_width: u16,
    desktop_height: u16,
    snapshot_rgba: &[u8],
) -> Result<(), String> {
    use image::{ImageBuffer, DynamicImage, ImageFormat};

    // Encode RGBA snapshot into PNG (non-progressive) to avoid progressive scan artifacts
    let buf = match ImageBuffer::from_raw(desktop_width as u32, desktop_height as u32, snapshot_rgba.to_vec()) {
        Some(buf) => buf,
        None => return Err("failed to build image buffer for snapshot".to_string()),
    };

    let dyn_img = DynamicImage::ImageRgba8(buf);
    let mut png_bytes: Vec<u8> = Vec::new();
    dyn_img.write_to(&mut std::io::Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| format!("encode snapshot to PNG failed: {e}"))?;

    emit_vnc_frame(
        frame_channel,
        desktop_width,
        desktop_height,
        0,
        0,
        desktop_width,
        desktop_height,
        false,
        true,
        png_bytes,
    )
}

// ============================================================================
// VNC 控制消息处理
// ============================================================================

pub async fn handle_vnc_control(control: VncControlMsg, client: &VncClient) -> Result<VncControlOutcome, String> {
    match control {
        VncControlMsg::Pointer(payload) => {
            client
                .input(X11Event::PointerEvent(VncClientMouseEvent {
                    position_x: payload.x,
                    position_y: payload.y,
                    bottons: payload.button_mask,
                }))
                .await
                .map_err(|e| format!("send VNC pointer input failed: {e}"))?;
            Ok(VncControlOutcome::Continue(Some(true)))
        }
        VncControlMsg::Key(payload) => {
            client
                .input(X11Event::KeyEvent(VncClientKeyEvent {
                    keycode: payload.key_sym,
                    down: payload.down,
                }))
                .await
                .map_err(|e| format!("send VNC keyboard input failed: {e}"))?;
            Ok(VncControlOutcome::Continue(Some(true)))
        }
        VncControlMsg::Refresh => {
            Ok(VncControlOutcome::Continue(Some(true)))
        }
        VncControlMsg::Close => {
            let _ = client.close().await;
            Ok(VncControlOutcome::Close)
        }
    }
}

// ============================================================================
// VNC 会话运行
// ============================================================================

pub async fn run_vnc_session<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    target: String,
    client: VncClient,
    frame_channel: tauri::ipc::Channel<Response>,
    mut control_rx: mpsc::UnboundedReceiver<VncControlMsg>,
) -> Result<(), String> {
    let mut desktop_width = 0u16;
    let mut desktop_height = 0u16;
    let mut cursor_mode_synced = false;
    let mut pending_refresh: Option<bool> = Some(true);
    let mut snapshot_rgba = Vec::new();
    let mut snapshot_dirty = false;
    let refresh_timer = tokio::time::sleep(Duration::ZERO);
    let snapshot_timer = tokio::time::sleep(Duration::from_secs(3600));
    tokio::pin!(refresh_timer);
    tokio::pin!(snapshot_timer);

    loop {
        tokio::select! {
            _ = &mut snapshot_timer, if snapshot_dirty => {
                if desktop_width > 0 && desktop_height > 0 && !snapshot_rgba.is_empty() {
                    emit_vnc_snapshot(&frame_channel, desktop_width, desktop_height, &snapshot_rgba)?;
                }
                snapshot_dirty = false;
            }
            _ = &mut refresh_timer => {
                let full_refresh = pending_refresh.take().unwrap_or(false);
                client
                    .input(if full_refresh { X11Event::FullRefresh } else { X11Event::Refresh })
                    .await
                    .map_err(|e| format!("request VNC refresh failed: {e}"))?;

                refresh_timer
                    .as_mut()
                    .reset(tokio::time::Instant::now() + VNC_IDLE_KEEPALIVE_INTERVAL);
            }
            maybe_control = control_rx.recv() => {
                let Some(control) = maybe_control else {
                    let _ = client.close().await;
                    break;
                };

                match handle_vnc_control(control, &client).await? {
                    VncControlOutcome::Continue(refresh_request) => {
                        if let Some(full_refresh) = refresh_request {
                            pending_refresh = Some(pending_refresh.unwrap_or(false) || full_refresh);
                            let delay = if full_refresh {
                                Duration::ZERO
                            } else {
                                VNC_INPUT_REFRESH_DELAY
                            };
                            refresh_timer
                                .as_mut()
                                .reset(tokio::time::Instant::now() + delay);
                        }
                    }
                    VncControlOutcome::Close => break,
                }
            }
            event = client.recv_event() => {
                match event.map_err(|e| format!("receive VNC event failed: {e}"))? {
                    VncEvent::SetResolution(screen) => {
                        desktop_width = screen.width;
                        desktop_height = screen.height;
                        ensure_vnc_snapshot_buffer(&mut snapshot_rgba, desktop_width, desktop_height)?;
                        log_vnc_info(&session_id, &target, "resolution", format!("desktop resized to {}x{}", screen.width, screen.height));
                        pending_refresh = Some(true);
                        refresh_timer
                            .as_mut()
                            .reset(tokio::time::Instant::now());
                    }
                    VncEvent::RawImage(rect, data) => {
                        if desktop_width == 0 {
                            desktop_width = rect.x.saturating_add(rect.width);
                        }
                        if desktop_height == 0 {
                            desktop_height = rect.y.saturating_add(rect.height);
                        }

                        ensure_vnc_snapshot_buffer(&mut snapshot_rgba, desktop_width, desktop_height)?;
                        blit_vnc_rgba_rect(
                            &mut snapshot_rgba,
                            desktop_width,
                            desktop_height,
                            rect.x,
                            rect.y,
                            rect.width,
                            rect.height,
                            &data,
                        )?;
                        snapshot_dirty = true;
                        snapshot_timer
                            .as_mut()
                            .reset(tokio::time::Instant::now() + VNC_SNAPSHOT_COMMIT_DELAY);
                    }
                    VncEvent::JpegImage(rect, data) => {
                        if desktop_width == 0 {
                            desktop_width = rect.x.saturating_add(rect.width);
                        }
                        if desktop_height == 0 {
                            desktop_height = rect.y.saturating_add(rect.height);
                        }

                        ensure_vnc_snapshot_buffer(&mut snapshot_rgba, desktop_width, desktop_height)?;
                        let decoded = decode_vnc_jpeg_rect(&data, rect.width, rect.height)?;
                        blit_vnc_rgba_rect(
                            &mut snapshot_rgba,
                            desktop_width,
                            desktop_height,
                            rect.x,
                            rect.y,
                            rect.width,
                            rect.height,
                            &decoded,
                        )?;
                        snapshot_dirty = true;
                        snapshot_timer
                            .as_mut()
                            .reset(tokio::time::Instant::now() + VNC_SNAPSHOT_COMMIT_DELAY);
                    }
                    VncEvent::Copy(_, _) => {
                        pending_refresh = Some(true);
                        refresh_timer
                            .as_mut()
                            .reset(tokio::time::Instant::now());
                    }
                    VncEvent::SetCursor(rect, data) => {
                        app.emit(
                            &format!("vnc-cursor-{}", session_id),
                            VncCursorEventPayload {
                                hotspot_x: rect.x,
                                hotspot_y: rect.y,
                                width: rect.width,
                                height: rect.height,
                                rgba_bytes: data,
                            },
                        ).map_err(|e| format!("emit VNC cursor event failed: {e}"))?;

                        if !cursor_mode_synced {
                            cursor_mode_synced = true;
                            pending_refresh = Some(true);
                            refresh_timer
                                .as_mut()
                                .reset(tokio::time::Instant::now());
                        }
                    }
                    VncEvent::SetPixelFormat(pixel_format) => {
                        log_vnc_info(&session_id, &target, "pixel-format", format!("server pixel format updated: {}bpp", pixel_format.bits_per_pixel));
                    }
                    VncEvent::Bell => {}
                    VncEvent::Text(text) => {
                        log_vnc_info(&session_id, &target, "clipboard", format!("server clipboard updated: {} chars", text.len()));
                    }
                    VncEvent::Error(message) => return Err(format!("VNC runtime error: {message}")),
                    _ => {}
                }
            }
        }
    }

    Ok(())
}
