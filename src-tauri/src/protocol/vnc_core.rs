//! VNC 核心逻辑模块
//! 
//! 本模块基于 LibVNCClient FFI 实现 VNC 协议核心功能。

use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Response;
use tauri::{AppHandle, Runtime};
use tokio::sync::mpsc;
use tokio::time::{interval, Instant};

use crate::types::{VncControlMsg, VncControlOutcome};
use crate::utils::log_vnc_info;

use super::vnc_client::{
    MouseButton, VncClient, VncClientConfig, VncEncoding, VncEventLoopHandle, ControlMessage,
};

// ============================================================================
// 常量
// ============================================================================

const VNC_INPUT_REFRESH_DELAY: Duration = Duration::from_millis(75);
const VNC_IDLE_KEEPALIVE_INTERVAL: Duration = Duration::from_millis(1000);
const VNC_SNAPSHOT_COMMIT_DELAY: Duration = Duration::from_millis(60);

// ============================================================================
// 帧发射（保持与原有实现相同的二进制协议）
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
// 快照缓冲区
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

fn emit_vnc_snapshot(
    frame_channel: &tauri::ipc::Channel<Response>,
    desktop_width: u16,
    desktop_height: u16,
    snapshot_rgba: &[u8],
) -> Result<(), String> {
    use image::{ImageBuffer, DynamicImage, ImageFormat};

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

/// 控制消息处理器
pub struct VncController {
    client: Arc<VncClient>,
}

impl VncController {
    pub fn new(client: Arc<VncClient>) -> Self {
        Self { client }
    }

    pub async fn handle_control(&self, control: VncControlMsg) -> Result<VncControlOutcome, String> {
        match control {
            VncControlMsg::Pointer(payload) => {
                let mut buttons = Vec::new();
                if payload.button_mask & 1 != 0 { buttons.push(MouseButton::Left); }
                if payload.button_mask & 2 != 0 { buttons.push(MouseButton::Middle); }
                if payload.button_mask & 4 != 0 { buttons.push(MouseButton::Right); }
                if payload.button_mask & 8 != 0 { buttons.push(MouseButton::ScrollUp); }
                if payload.button_mask & 16 != 0 { buttons.push(MouseButton::ScrollDown); }

                self.client
                    .send_pointer(payload.x, payload.y, &buttons)
                    .await
                    .map_err(|e| format!("send VNC pointer input failed: {e}"))?;
                
                Ok(VncControlOutcome::Continue(Some(true)))
            }
            VncControlMsg::Key(payload) => {
                self.client
                    .send_key(payload.key_sym, payload.down)
                    .await
                    .map_err(|e| format!("send VNC keyboard input failed: {e}"))?;
                
                Ok(VncControlOutcome::Continue(Some(true)))
            }
            VncControlMsg::Refresh => {
                Ok(VncControlOutcome::Continue(Some(true)))
            }
            VncControlMsg::Close => {
                self.client.close().await;
                Ok(VncControlOutcome::Close)
            }
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
    let client = Arc::new(client);
    let controller = VncController::new(client.clone());

    let mut desktop_width = 0u16;
    let mut desktop_height = 0u16;
    let mut _cursor_mode_synced = false;
    let mut pending_refresh: Option<bool> = Some(true);
    let mut snapshot_rgba = Vec::new();
    let mut snapshot_dirty = false;
    
    let mut refresh_timer = interval(VNC_IDLE_KEEPALIVE_INTERVAL);
    refresh_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    
    let mut snapshot_timer = interval(VNC_SNAPSHOT_COMMIT_DELAY);
    snapshot_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    snapshot_timer.tick().await;

    let (event_handle, mut event_result) = start_vnc_event_loop(
        client.clone(),
        app.clone(),
        session_id.clone(),
    );

    loop {
        tokio::select! {
            _ = snapshot_timer.tick(), if snapshot_dirty => {
                if desktop_width > 0 && desktop_height > 0 && !snapshot_rgba.is_empty() {
                    if let Err(e) = emit_vnc_snapshot(&frame_channel, desktop_width, desktop_height, &snapshot_rgba) {
                        log::warn!("Failed to emit VNC snapshot: {}", e);
                    }
                }
                snapshot_dirty = false;
            }
            
            _ = refresh_timer.tick() => {
                let full_refresh = pending_refresh.take().unwrap_or(false);
                
                if let Err(e) = client.request_update(0, 0, 4096, 4096, !full_refresh).await {
                    log::error!("VNC refresh request failed: {}", e);
                    break;
                }
                
                pending_refresh = None;
            }
            
            maybe_control = control_rx.recv() => {
                let Some(control) = maybe_control else {
                    let _ = client.close().await;
                    break;
                };

                match controller.handle_control(control).await {
                    Ok(VncControlOutcome::Continue(refresh_request)) => {
                        if let Some(full_refresh) = refresh_request {
                            pending_refresh = Some(pending_refresh.unwrap_or(false) || full_refresh);
                            if full_refresh {
                                let next_tick = Instant::now() + VNC_INPUT_REFRESH_DELAY;
                                refresh_timer.reset_at(next_tick);
                            }
                        }
                    }
                    Ok(VncControlOutcome::Close) => {
                        let _ = client.close().await;
                        break;
                    }
                    Err(e) => {
                        log::error!("VNC control error: {}", e);
                        break;
                    }
                }
            }
            
            result = client.handle_message() => {
                match result {
                    Ok(true) => {
                        let fb = client.framebuffer();
                        let (new_width, new_height) = fb.size();
                        
                        if new_width != desktop_width || new_height != desktop_height {
                            desktop_width = new_width;
                            desktop_height = new_height;
                            ensure_vnc_snapshot_buffer(&mut snapshot_rgba, desktop_width, desktop_height)?;
                            log_vnc_info(&session_id, &target, "resolution", format!("desktop resized to {}x{}", desktop_width, desktop_height));
                            pending_refresh = Some(true);
                        }
                        
                        snapshot_dirty = true;
                    }
                    Ok(false) => {}
                    Err(e) => {
                        log::error!("VNC message handling error: {}", e);
                        break;
                    }
                }
            }
            
            result = &mut event_result => {
                if let Err(e) = result {
                    log::error!("VNC event loop error: {:?}", e);
                }
                break;
            }
        }
    }

    event_handle.shutdown();
    Ok(())
}

/// 启动 VNC 事件处理循环
fn start_vnc_event_loop(
    client: Arc<VncClient>,
    _app: AppHandle<impl Runtime>,
    _session_id: String,
) -> (VncEventLoopHandle, tokio::sync::oneshot::Receiver<()>) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let (control_tx, mut control_rx) = mpsc::unbounded_channel();

    let handle = VncEventLoopHandle { control_tx };

    tokio::spawn(async move {
        let _cursor_mode_synced = false;
        let _last_fb_update: Option<(u16, u16, u16, u16)> = None;

        loop {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(10)) => {}
                
                Some(msg) = control_rx.recv() => {
                    match msg {
                        ControlMessage::RequestRefresh { full } => {
                            let _ = client.request_update(0, 0, 4096, 4096, !full).await;
                        }
                        ControlMessage::Shutdown => {
                            break;
                        }
                    }
                }
            }
        }

        let _ = tx.send(());
    });

    (handle, rx)
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 将 VNC 配置转换为 LibVNCClient 配置
pub fn convert_config(
    config: &crate::types::VncConnectConfig,
) -> VncClientConfig {
    VncClientConfig {
        host: config.host.clone(),
        port: config.port,
        password: config.password.clone(),
        shared: config.shared.unwrap_or(true),
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
