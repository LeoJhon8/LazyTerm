//! VNC session runtime.
//!
//! This layer owns the session lifecycle, control flow, refresh policy, and frontend frame emission.
//! It should not know about libvncclient callbacks or pixel layout details.

use std::future::{pending, Future};
use std::pin::Pin;
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::Arc;
use std::time::Duration;

use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::mpsc;
use tokio::time::{interval, Instant};

use crate::types::{VncControlMsg, VncCursorEventPayload};
use crate::utils::log_vnc_info;

use super::vnc_client::{
    FrameUpdateRegion, MouseButton, VncClient, VncClientConfig, VncClientEvent, VncEncoding,
};

const VNC_INPUT_REFRESH_DELAY: Duration = Duration::from_millis(16);
const VNC_IDLE_REFRESH_INTERVAL: Duration = Duration::from_millis(150);
const VNC_SNAPSHOT_COMMIT_DELAY: Duration = Duration::from_millis(16);
const VNC_REFRESH_BOUNDS: u16 = 4096;
const VNC_COMPRESSED_FULL_FRAME_THRESHOLD_PERCENT: u32 = 20;
pub const VNC_JPEG_QUALITY: u8 = 30;
const VNC_COMPRESSED_FRAME_MIN_INTERVAL: Duration = Duration::from_millis(120);
const VNC_ENABLE_DIAGNOSTIC_LOGS: bool = false;
const VNC_TRACE_ONLY_FULL_REFRESH: bool = true;
const VNC_STARTUP_FULL_REFRESH_RETRY_INTERVAL: Duration = Duration::from_secs(3);
const VNC_SLOW_COMMIT_LOG_THRESHOLD: Duration = Duration::from_millis(30);

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

fn encode_snapshot_jpeg(
    desktop_width: u16,
    desktop_height: u16,
    snapshot_rgba: &[u8],
    quality: u8,
) -> Result<Vec<u8>, String> {
    use image::codecs::jpeg::JpegEncoder;
    use image::{ColorType, ImageBuffer, Rgb};

    let pixel_count = desktop_width as usize * desktop_height as usize;
    let expected_len = pixel_count * 4;
    if snapshot_rgba.len() != expected_len {
        return Err(format!(
            "unexpected VNC RGBA snapshot length: {} != {}",
            snapshot_rgba.len(),
            expected_len
        ));
    }

    let mut rgb_bytes = Vec::with_capacity(pixel_count * 3);
    for chunk in snapshot_rgba.chunks_exact(4) {
        rgb_bytes.extend_from_slice(&chunk[..3]);
    }

    let Some(image_buffer) = ImageBuffer::<Rgb<u8>, Vec<u8>>::from_raw(
        desktop_width as u32,
        desktop_height as u32,
        rgb_bytes,
    ) else {
        return Err("failed to build RGB image buffer for VNC snapshot".to_string());
    };

    let mut jpeg_bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, quality);
    encoder
        .encode(
            image_buffer.as_raw(),
            desktop_width as u32,
            desktop_height as u32,
            ColorType::Rgb8.into(),
        )
        .map_err(|e| format!("encode VNC snapshot to JPEG failed: {e}"))?;

    Ok(jpeg_bytes)
}

struct VncSessionRuntime<R: Runtime> {
    app: AppHandle<R>,
    session_id: String,
    target: String,
    client: Arc<VncClient>,
    event_receiver: Receiver<VncClientEvent>,
    frame_channel: tauri::ipc::Channel<Response>,
    control_rx: mpsc::UnboundedReceiver<VncControlMsg>,
    pending_control: Option<VncControlMsg>,
    desktop_width: u16,
    desktop_height: u16,
    pending_refresh: bool,
    startup_full_refresh_in_flight: bool,
    startup_full_refresh_sent_at: Option<Instant>,
    snapshot_dirty: bool,
    dirty_region: Option<DirtyRegion>,
    has_received_frame: bool,
    /// 是否曾经收到过帧。与 has_received_frame 不同，此标志在分辨率变化时不会重置。
    /// 用于 schedule_refresh 的输入刷新门控，避免分辨率变化期间阻塞用户输入刷新。
    ever_received_frame: bool,
    emitted_snapshot_count: u64,
    last_compressed_frame_at: Option<Instant>,
    session_started_at: Instant,
    refresh_seq: u64,
    dirty_log_count: u32,
    commit_seq: u64,
    jpeg_quality: u8,
    view_only: bool,
}

#[derive(Clone, Copy)]
struct DirtyRegion {
    x: u16,
    y: u16,
    width: u16,
    height: u16,
}

impl<R: Runtime> VncSessionRuntime<R> {
    async fn poll_server_message(client: Arc<VncClient>) -> Result<bool, String> {
        client
            .handle_message()
            .await
            .map_err(|error| format!("VNC message handling error: {error}"))
    }

    fn new(
        app: AppHandle<R>,
        session_id: String,
        target: String,
        client: VncClient,
        event_receiver: Receiver<VncClientEvent>,
        frame_channel: tauri::ipc::Channel<Response>,
        control_rx: mpsc::UnboundedReceiver<VncControlMsg>,
        jpeg_quality: u8,
        view_only: bool,
    ) -> Self {
        Self {
            app,
            session_id,
            target,
            client: Arc::new(client),
            event_receiver,
            frame_channel,
            control_rx,
            pending_control: None,
            desktop_width: 0,
            desktop_height: 0,
            pending_refresh: true,
            startup_full_refresh_in_flight: false,
            startup_full_refresh_sent_at: None,
            snapshot_dirty: false,
            dirty_region: None,
            has_received_frame: false,
            ever_received_frame: false,
            emitted_snapshot_count: 0,
            last_compressed_frame_at: None,
            session_started_at: Instant::now(),
            refresh_seq: 0,
            dirty_log_count: 0,
            commit_seq: 0,
            jpeg_quality,
            view_only,
        }
    }

    async fn run(mut self) -> Result<(), String> {
        let mut refresh_timer = interval(VNC_IDLE_REFRESH_INTERVAL);
        refresh_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut snapshot_timer = interval(VNC_SNAPSHOT_COMMIT_DELAY);
        snapshot_timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        snapshot_timer.tick().await;

        self.drain_client_events()?;
        self.refresh_desktop_metrics()?;
        self.client
            .request_update(0, 0, VNC_REFRESH_BOUNDS, VNC_REFRESH_BOUNDS, false)
            .await
            .map_err(|e| format!("send initial VNC refresh request failed: {e}"))?;
        self.pending_refresh = false;
        self.mark_startup_full_refresh_in_flight();
        self.log_refresh_request(
            "initial",
            true,
            false,
            VNC_REFRESH_BOUNDS,
            VNC_REFRESH_BOUNDS,
        );

        let mut message_future: Pin<Box<dyn Future<Output = Result<bool, String>> + Send>> =
            Box::pin(pending());
        let mut message_poll_active = false;

        loop {
            if let Some(control) = self.take_pending_control() {
                if !self.handle_control(control, &mut refresh_timer).await {
                    break;
                }
                continue;
            }

            if !message_poll_active {
                message_future = Box::pin(Self::poll_server_message(Arc::clone(&self.client)));
                message_poll_active = true;
            }

            tokio::select! {
                _ = snapshot_timer.tick(), if self.snapshot_dirty => {
                    self.commit_snapshot_frame().await?;
                }

                _ = refresh_timer.tick() => {
                    if !self.has_received_frame && self.startup_full_refresh_in_flight {
                        let Some(sent_at) = self.startup_full_refresh_sent_at else {
                            continue;
                        };

                        if sent_at.elapsed() < VNC_STARTUP_FULL_REFRESH_RETRY_INTERVAL {
                            continue;
                        }

                        self.startup_full_refresh_in_flight = false;
                    }

                    let client = Arc::clone(&self.client);
                    let full_refresh = self.pending_refresh || !self.has_received_frame;
                    let request_width = if self.desktop_width > 0 { self.desktop_width } else { VNC_REFRESH_BOUNDS };
                    let request_height = if self.desktop_height > 0 { self.desktop_height } else { VNC_REFRESH_BOUNDS };
                    // 异步发送刷新请求，避免在 HandleRFBServerMessage 持有 io_lock 时阻塞主循环
                    let session_id = self.session_id.clone();
                    let target = self.target.clone();
                    let incremental = !full_refresh;
                    tokio::spawn(async move {
                        if let Err(e) = client.request_update(0, 0, request_width, request_height, incremental).await {
                            log::warn!("VNC refresh request failed for {} ({}): {}", session_id, target, e);
                        }
                    });
                    self.pending_refresh = false;
                    if full_refresh && !self.has_received_frame {
                        self.mark_startup_full_refresh_in_flight();
                    }
                    self.log_refresh_request("timer", full_refresh, !full_refresh, request_width, request_height);
                }

                maybe_control = self.control_rx.recv() => {
                    let Some(control) = maybe_control else {
                        self.client.close().await;
                        break;
                    };

                    let control = self.coalesce_control(control);
                    if !self.handle_control(control, &mut refresh_timer).await {
                        break;
                    }
                }

                result = &mut message_future, if message_poll_active => {
                    message_poll_active = false;
                    message_future = Box::pin(pending());

                    match result {
                        Ok(true) => {
                            self.drain_client_events()?;
                            self.refresh_desktop_metrics()?;
                            self.mark_snapshot_dirty_from_client()?;
                            if self.has_received_frame {
                                let request_width = if self.desktop_width > 0 { self.desktop_width } else { VNC_REFRESH_BOUNDS };
                                let request_height = if self.desktop_height > 0 { self.desktop_height } else { VNC_REFRESH_BOUNDS };
                                let full_refresh = self.pending_refresh;
                                self.client
                                    .request_update(
                                        0,
                                        0,
                                        request_width,
                                        request_height,
                                        !full_refresh,
                                    )
                                    .await
                                    .map_err(|e| format!("send follow-up VNC refresh request failed: {e}"))?;
                                self.log_refresh_request("followup", full_refresh, !full_refresh, request_width, request_height);
                                self.pending_refresh = false;
                            }
                        }
                        Ok(false) => {}
                        Err(error) => {
                            log::error!("{}", error);
                            break;
                        }
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_control(
        &mut self,
        control: VncControlMsg,
        refresh_timer: &mut tokio::time::Interval,
    ) -> bool {
        match control {
            VncControlMsg::Pointer(payload) => {
                if self.view_only {
                    return true;
                }
                let mut buttons = Vec::new();
                if payload.button_mask & 1 != 0 {
                    buttons.push(MouseButton::Left);
                }
                if payload.button_mask & 2 != 0 {
                    buttons.push(MouseButton::Middle);
                }
                if payload.button_mask & 4 != 0 {
                    buttons.push(MouseButton::Right);
                }
                if payload.button_mask & 8 != 0 {
                    buttons.push(MouseButton::ScrollUp);
                }
                if payload.button_mask & 16 != 0 {
                    buttons.push(MouseButton::ScrollDown);
                }

                // 异步发送指针事件，避免在 HandleRFBServerMessage 持有 io_lock 时阻塞主循环
                let client = Arc::clone(&self.client);
                let session_id = self.session_id.clone();
                let target = self.target.clone();
                let x = payload.x;
                let y = payload.y;
                tokio::spawn(async move {
                    if let Err(error) = client.send_pointer(x, y, &buttons).await {
                        log::warn!(
                            "VNC pointer input failed for {} ({}): {}",
                            session_id,
                            target,
                            error
                        );
                    }
                });
                self.schedule_refresh(false, refresh_timer);
                true
            }
            VncControlMsg::Key(payload) => {
                if self.view_only {
                    return true;
                }
                // 异步发送键盘事件，避免在 HandleRFBServerMessage 持有 io_lock 时阻塞主循环
                let client = Arc::clone(&self.client);
                let session_id = self.session_id.clone();
                let target = self.target.clone();
                let key_sym = payload.key_sym;
                let down = payload.down;
                tokio::spawn(async move {
                    if let Err(error) = client.send_key(key_sym, down).await {
                        log::warn!(
                            "VNC keyboard input failed for {} ({}): {}",
                            session_id,
                            target,
                            error
                        );
                    }
                });
                self.schedule_refresh(false, refresh_timer);
                true
            }
            VncControlMsg::PasteClipboard(payload) => {
                if self.view_only {
                    return true;
                }

                let client = Arc::clone(&self.client);
                let session_id = self.session_id.clone();
                let target = self.target.clone();
                tokio::spawn(async move {
                    if let Err(error) = client
                        .paste_clipboard(payload.text, payload.key_sym, payload.modifier_key_syms)
                        .await
                    {
                        log::warn!(
                            "VNC clipboard paste failed for {} ({}): {}",
                            session_id,
                            target,
                            error
                        );
                    }
                });
                self.schedule_refresh(false, refresh_timer);
                true
            }
            VncControlMsg::TypeText(payload) => {
                if self.view_only {
                    return true;
                }

                let client = Arc::clone(&self.client);
                let session_id = self.session_id.clone();
                let target = self.target.clone();
                tokio::spawn(async move {
                    if let Err(error) = client
                        .type_text(payload.text, payload.modifier_key_syms)
                        .await
                    {
                        log::warn!(
                            "VNC text input failed for {} ({}): {}",
                            session_id,
                            target,
                            error
                        );
                    }
                });
                self.schedule_refresh(false, refresh_timer);
                true
            }
            VncControlMsg::Refresh => {
                if !self.has_received_frame && self.startup_full_refresh_in_flight {
                    return true;
                }

                if VNC_ENABLE_DIAGNOSTIC_LOGS {
                    log_vnc_info(
                        &self.session_id,
                        &self.target,
                        "refresh",
                        format!(
                            "t={}ms queued refresh request from control channel full=true pending_refresh_before={} has_received_frame={} startup_in_flight={}",
                            self.elapsed_ms(),
                            self.pending_refresh,
                            self.has_received_frame,
                            self.startup_full_refresh_in_flight,
                        ),
                    );
                }
                self.schedule_refresh(true, refresh_timer);
                true
            }
            VncControlMsg::Close => {
                self.client.close().await;
                false
            }
        }
    }

    fn schedule_refresh(&mut self, full_refresh: bool, refresh_timer: &mut tokio::time::Interval) {
        if !self.ever_received_frame && !full_refresh {
            return;
        }

        self.pending_refresh = self.pending_refresh || full_refresh;
        refresh_timer.reset_at(Instant::now() + VNC_INPUT_REFRESH_DELAY);
    }

    fn take_pending_control(&mut self) -> Option<VncControlMsg> {
        let first = if let Some(control) = self.pending_control.take() {
            control
        } else {
            self.control_rx.try_recv().ok()?
        };

        Some(self.coalesce_control(first))
    }

    fn coalesce_control(&mut self, first: VncControlMsg) -> VncControlMsg {
        match first {
            VncControlMsg::Pointer(mut payload) => {
                loop {
                    match self.control_rx.try_recv() {
                        Ok(VncControlMsg::Pointer(next))
                            if next.button_mask == payload.button_mask =>
                        {
                            payload = next;
                        }
                        Ok(other) => {
                            self.pending_control = Some(other);
                            break;
                        }
                        Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
                        Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break,
                    }
                }

                VncControlMsg::Pointer(payload)
            }
            VncControlMsg::Refresh => {
                loop {
                    match self.control_rx.try_recv() {
                        Ok(VncControlMsg::Refresh) => {}
                        Ok(other) => {
                            self.pending_control = Some(other);
                            break;
                        }
                        Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
                        Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break,
                    }
                }

                VncControlMsg::Refresh
            }
            other => other,
        }
    }

    fn drain_client_events(&mut self) -> Result<(), String> {
        loop {
            match self.event_receiver.try_recv() {
                Ok(event) => match event {
                    VncClientEvent::FrameBufferUpdate(update) => {
                        if !self.has_received_frame {
                            log_vnc_info(
                                &self.session_id,
                                &self.target,
                                "frame",
                                "received first framebuffer update",
                            );
                        }
                        self.has_received_frame = true;
                        self.ever_received_frame = true;
                        self.startup_full_refresh_in_flight = false;
                        self.startup_full_refresh_sent_at = None;
                        self.snapshot_dirty = true;
                        self.merge_dirty_region(DirtyRegion {
                            x: update.x,
                            y: update.y,
                            width: update.width,
                            height: update.height,
                        });
                    }
                    VncClientEvent::ResolutionChange { width, height } => {
                        if width != self.desktop_width || height != self.desktop_height {
                            self.desktop_width = width;
                            self.desktop_height = height;
                            log_vnc_info(
                                &self.session_id,
                                &self.target,
                                "resolution",
                                format!("desktop resized to {}x{}", width, height),
                            );
                            self.has_received_frame = false;
                            self.pending_refresh = true;
                            self.startup_full_refresh_in_flight = false;
                            self.startup_full_refresh_sent_at = None;
                            self.snapshot_dirty = false;
                            self.dirty_region = None;
                        }
                    }
                    VncClientEvent::CursorShape(cursor) => {
                        let payload = VncCursorEventPayload {
                            hotspot_x: cursor.hotspot_x,
                            hotspot_y: cursor.hotspot_y,
                            width: cursor.width,
                            height: cursor.height,
                            rgba_bytes: cursor.rgba_data,
                        };
                        let _ = self
                            .app
                            .emit(&format!("vnc-cursor-{}", self.session_id), payload);
                    }
                    VncClientEvent::Clipboard(clipboard) => {
                        let _ = self.app.emit(
                            &format!("vnc-clipboard-{}", self.session_id),
                            clipboard.text,
                        );
                    }
                    VncClientEvent::CursorPosition { .. } => {}
                },
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    return Err("VNC client event channel disconnected".to_string());
                }
            }
        }

        Ok(())
    }

    fn refresh_desktop_metrics(&mut self) -> Result<(), String> {
        let (width, height) = self.client.framebuffer_size();
        if width == 0 || height == 0 {
            return Ok(());
        }

        if width != self.desktop_width || height != self.desktop_height {
            self.desktop_width = width;
            self.desktop_height = height;
            log_vnc_info(
                &self.session_id,
                &self.target,
                "resolution",
                format!("desktop resized to {}x{}", width, height),
            );
            self.has_received_frame = false;
            self.pending_refresh = true;
            self.startup_full_refresh_in_flight = false;
            self.startup_full_refresh_sent_at = None;
            self.snapshot_dirty = false;
            self.dirty_region = None;
        }

        Ok(())
    }

    fn mark_snapshot_dirty_from_client(&mut self) -> Result<(), String> {
        let (framebuffer_width, framebuffer_height) = self.client.framebuffer_size();
        if framebuffer_width != self.desktop_width || framebuffer_height != self.desktop_height {
            return Err(format!(
                "VNC framebuffer size mismatch: framebuffer={}x{}, desktop={}x{}",
                framebuffer_width, framebuffer_height, self.desktop_width, self.desktop_height
            ));
        }

        Ok(())
    }

    async fn commit_snapshot_frame(&mut self) -> Result<(), String> {
        if self.desktop_width == 0 || self.desktop_height == 0 {
            self.snapshot_dirty = false;
            return Ok(());
        }

        let commit_started_at = Instant::now();
        let Some(region) = self.take_dirty_region() else {
            self.snapshot_dirty = false;
            return Ok(());
        };

        let full_frame = region.x == 0
            && region.y == 0
            && region.width == self.desktop_width
            && region.height == self.desktop_height;

        let desktop_area = self.desktop_area();
        let region_area = u32::from(region.width) * u32::from(region.height);
        let area_pct = if desktop_area == 0 {
            0
        } else {
            region_area.saturating_mul(100) / desktop_area
        };
        let prefer_full_compressed = full_frame
            || (desktop_area > 0
                && region_area.saturating_mul(100)
                    >= desktop_area.saturating_mul(VNC_COMPRESSED_FULL_FRAME_THRESHOLD_PERCENT));

        if prefer_full_compressed {
            if let Some(last_sent_at) = self.last_compressed_frame_at {
                let elapsed = Instant::now().saturating_duration_since(last_sent_at);
                if elapsed < VNC_COMPRESSED_FRAME_MIN_INTERVAL {
                    if VNC_ENABLE_DIAGNOSTIC_LOGS && !VNC_TRACE_ONLY_FULL_REFRESH {
                        self.commit_seq += 1;
                        log_vnc_info(
                            &self.session_id,
                            &self.target,
                            "commit",
                            format!(
                                "t={}ms seq={} deferred path=compressed region={}x{}@{},{} area_pct={} since_last_compressed={}ms min_interval={}ms",
                                self.elapsed_ms(),
                                self.commit_seq,
                                region.width,
                                region.height,
                                region.x,
                                region.y,
                                area_pct,
                                elapsed.as_millis(),
                                VNC_COMPRESSED_FRAME_MIN_INTERVAL.as_millis(),
                            ),
                        );
                    }
                    self.dirty_region = Some(region);
                    self.snapshot_dirty = true;
                    return Ok(());
                }
            }

            let snapshot_started_at = Instant::now();
            let (_, _, rgba) = self.client.snapshot_rgba();
            let snapshot_elapsed = snapshot_started_at.elapsed();
            let encode_started_at = Instant::now();
            let jpeg_bytes = encode_snapshot_jpeg(
                self.desktop_width,
                self.desktop_height,
                &rgba,
                self.jpeg_quality,
            )?;
            let encode_elapsed = encode_started_at.elapsed();
            let send_started_at = Instant::now();
            emit_vnc_frame(
                &self.frame_channel,
                self.desktop_width,
                self.desktop_height,
                0,
                0,
                self.desktop_width,
                self.desktop_height,
                false,
                false,
                jpeg_bytes,
            )?;
            let send_elapsed = send_started_at.elapsed();
            let total_elapsed = commit_started_at.elapsed();
            self.last_compressed_frame_at = Some(Instant::now());
            let should_log = VNC_ENABLE_DIAGNOSTIC_LOGS
                && (!VNC_TRACE_ONLY_FULL_REFRESH || total_elapsed >= VNC_SLOW_COMMIT_LOG_THRESHOLD);
            if should_log {
                self.commit_seq += 1;
                log_vnc_info(
                    &self.session_id,
                    &self.target,
                    "commit",
                    format!(
                        "t={}ms seq={} path=compressed full={} region={}x{}@{},{} area_pct={} snapshot_ms={} encode_ms={} send_ms={} total_ms={}",
                        self.elapsed_ms(),
                        self.commit_seq,
                        full_frame,
                        region.width,
                        region.height,
                        region.x,
                        region.y,
                        area_pct,
                        snapshot_elapsed.as_millis(),
                        encode_elapsed.as_millis(),
                        send_elapsed.as_millis(),
                        total_elapsed.as_millis(),
                    ),
                );
            }
        } else {
            let snapshot_started_at = Instant::now();
            let rgba_bytes = self
                .client
                .snapshot_region_rgba(FrameUpdateRegion {
                    x: region.x as usize,
                    y: region.y as usize,
                    width: region.width as usize,
                    height: region.height as usize,
                })
                .ok_or_else(|| "failed to snapshot VNC dirty region".to_string())?;
            let snapshot_elapsed = snapshot_started_at.elapsed();
            let send_started_at = Instant::now();

            emit_vnc_frame(
                &self.frame_channel,
                self.desktop_width,
                self.desktop_height,
                region.x,
                region.y,
                region.width,
                region.height,
                true,
                false,
                rgba_bytes,
            )?;
            let send_elapsed = send_started_at.elapsed();
            let total_elapsed = commit_started_at.elapsed();
            self.commit_seq += 1;
            let should_log = VNC_ENABLE_DIAGNOSTIC_LOGS
                && (total_elapsed >= VNC_SLOW_COMMIT_LOG_THRESHOLD
                    || (!VNC_TRACE_ONLY_FULL_REFRESH
                        && (self.commit_seq <= 12
                            || self.elapsed_ms() <= 5_000
                            || area_pct >= VNC_COMPRESSED_FULL_FRAME_THRESHOLD_PERCENT)));
            if should_log {
                log_vnc_info(
                    &self.session_id,
                    &self.target,
                    "commit",
                    format!(
                        "t={}ms seq={} path=rgba full={} region={}x{}@{},{} area_pct={} snapshot_ms={} send_ms={} total_ms={}",
                        self.elapsed_ms(),
                        self.commit_seq,
                        full_frame,
                        region.width,
                        region.height,
                        region.x,
                        region.y,
                        area_pct,
                        snapshot_elapsed.as_millis(),
                        send_elapsed.as_millis(),
                        total_elapsed.as_millis(),
                    ),
                );
            }
        }
        self.emitted_snapshot_count += 1;
        if self.emitted_snapshot_count == 1 {
            log_vnc_info(
                &self.session_id,
                &self.target,
                "frame",
                "emitted first snapshot frame to frontend",
            );
        }
        self.snapshot_dirty = false;
        Ok(())
    }

    fn merge_dirty_region(&mut self, next: DirtyRegion) {
        let merged = match self.dirty_region.take() {
            Some(current) => {
                let left = current.x.min(next.x);
                let top = current.y.min(next.y);
                let right = current
                    .x
                    .saturating_add(current.width)
                    .max(next.x.saturating_add(next.width));
                let bottom = current
                    .y
                    .saturating_add(current.height)
                    .max(next.y.saturating_add(next.height));
                DirtyRegion {
                    x: left,
                    y: top,
                    width: right.saturating_sub(left),
                    height: bottom.saturating_sub(top),
                }
            }
            None => next,
        };
        self.maybe_log_dirty_merge(next, merged);
        self.dirty_region = Some(merged);
    }

    fn take_dirty_region(&mut self) -> Option<DirtyRegion> {
        if !self.has_received_frame {
            return None;
        }

        self.dirty_region.take().map(|region| DirtyRegion {
            x: region.x.min(self.desktop_width),
            y: region.y.min(self.desktop_height),
            width: region
                .width
                .min(self.desktop_width.saturating_sub(region.x)),
            height: region
                .height
                .min(self.desktop_height.saturating_sub(region.y)),
        })
    }

    fn elapsed_ms(&self) -> u128 {
        self.session_started_at.elapsed().as_millis()
    }

    fn desktop_area(&self) -> u32 {
        u32::from(self.desktop_width) * u32::from(self.desktop_height)
    }

    fn log_refresh_request(
        &mut self,
        reason: &str,
        full_refresh: bool,
        incremental: bool,
        request_width: u16,
        request_height: u16,
    ) {
        if !VNC_ENABLE_DIAGNOSTIC_LOGS {
            return;
        }

        if VNC_TRACE_ONLY_FULL_REFRESH && !full_refresh {
            return;
        }

        self.refresh_seq += 1;
        log_vnc_info(
            &self.session_id,
            &self.target,
            "refresh",
            format!(
                "t={}ms seq={} reason={} full={} incremental={} request={}x{} pending_refresh={} has_received_frame={} startup_in_flight={}",
                self.elapsed_ms(),
                self.refresh_seq,
                reason,
                full_refresh,
                incremental,
                request_width,
                request_height,
                self.pending_refresh,
                self.has_received_frame,
                self.startup_full_refresh_in_flight,
            ),
        );
    }

    fn maybe_log_dirty_merge(&mut self, update: DirtyRegion, merged: DirtyRegion) {
        if !VNC_ENABLE_DIAGNOSTIC_LOGS {
            return;
        }

        if VNC_TRACE_ONLY_FULL_REFRESH {
            return;
        }

        let desktop_area = self.desktop_area();
        let merged_area = u32::from(merged.width) * u32::from(merged.height);
        let merged_area_pct = if desktop_area == 0 {
            0
        } else {
            merged_area.saturating_mul(100) / desktop_area
        };

        let should_log = self.dirty_log_count < 12
            || merged_area_pct >= VNC_COMPRESSED_FULL_FRAME_THRESHOLD_PERCENT
            || self.elapsed_ms() <= 5_000;
        if !should_log {
            return;
        }

        self.dirty_log_count += 1;
        log_vnc_info(
            &self.session_id,
            &self.target,
            "dirty",
            format!(
                "t={}ms seq={} update={}x{}@{},{} merged={}x{}@{},{} merged_area_pct={} has_received_frame={}",
                self.elapsed_ms(),
                self.dirty_log_count,
                update.width,
                update.height,
                update.x,
                update.y,
                merged.width,
                merged.height,
                merged.x,
                merged.y,
                merged_area_pct,
                self.has_received_frame,
            ),
        );
    }

    fn mark_startup_full_refresh_in_flight(&mut self) {
        self.startup_full_refresh_in_flight = true;
        self.startup_full_refresh_sent_at = Some(Instant::now());
    }
}

pub async fn run_vnc_session<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    target: String,
    client: VncClient,
    event_receiver: Receiver<VncClientEvent>,
    frame_channel: tauri::ipc::Channel<Response>,
    control_rx: mpsc::UnboundedReceiver<VncControlMsg>,
    jpeg_quality: u8,
    view_only: bool,
) -> Result<(), String> {
    VncSessionRuntime::new(
        app,
        session_id,
        target,
        client,
        event_receiver,
        frame_channel,
        control_rx,
        jpeg_quality,
        view_only,
    )
    .run()
    .await
}

pub fn convert_config(config: &crate::types::VncConnectConfig) -> VncClientConfig {
    let port = if config.port < 5900 && config.port > 0 {
        config.port + 5900
    } else {
        config.port
    };

    VncClientConfig {
        host: config.host.clone(),
        port,
        password: config.password.clone(),
        shared: config.shared.unwrap_or(true),
        view_only: config.view_only.unwrap_or(false),
        allow_jpeg: config.allow_jpeg.unwrap_or(true),
        use_remote_cursor: false,
        handle_new_fb_size: true,
        jpeg_quality: 8,
        compression_level: 6,
        encodings: vec![
            VncEncoding::CopyRect,
            VncEncoding::Hextile,
            VncEncoding::Rre,
            VncEncoding::Raw,
        ],
    }
}
