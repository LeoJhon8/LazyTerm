//! RDP runtime backed by FreeRDP.

use crate::types::RdpConnectConfig;

pub fn build_rdp_full_address(config: &RdpConnectConfig) -> String {
    if config.port == 3389 {
        config.host.clone()
    } else {
        format!("{}:{}", config.host, config.port)
    }
}

#[cfg(feature = "rdp-freerdp")]
mod freerdp_runtime {
    use std::collections::HashSet;
    use std::sync::mpsc as std_mpsc;
    use std::time::{Duration, Instant};

    use image::codecs::jpeg::JpegEncoder;
    use image::ExtendedColorType;
    use tauri::ipc::{Channel, Response};
    use tauri::{AppHandle, Runtime};

    use crate::protocol::freerdp_client::{FreeRdpClient, FreeRdpClientConfig, FreeRdpFrame};
    use crate::types::{RdpConnectConfig, RdpControlMsg, RdpPointerEventPayload};
    use crate::utils::log_rdp_info;

    const RDP_POLL_TIMEOUT: Duration = Duration::from_millis(16);
    const RDP_IDLE_FRAME_INTERVAL: Duration = Duration::from_millis(33);
    const RDP_INTERACTIVE_FRAME_INTERVAL: Duration = Duration::from_millis(16);
    const RDP_FULL_JPEG_QUALITY: u8 = 58;
    const RDP_POINTER_MOVE_JPEG_QUALITY: u8 = 28;
    const RDP_WHEEL_JPEG_QUALITY: u8 = 32;
    const RDP_KEYBOARD_JPEG_QUALITY: u8 = 42;
    const RDP_CLICK_JPEG_QUALITY: u8 = 46;
    const RDP_INTERACTION_WINDOW: Duration = Duration::from_millis(320);

    pub struct RdpFrameEncoderState {
        rgb_buffer: Vec<u8>,
        jpeg_buffer: Vec<u8>,
        packet_buffer: Vec<u8>,
        last_interaction: Option<(RdpInteractionKind, Instant)>,
    }

    #[derive(Clone, Copy)]
    enum RdpFrameEncodeMode {
        Jpeg { quality: u8 },
        RawRgba,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum RdpInteractionKind {
        PointerMove,
        Wheel,
        Keyboard,
        Click,
    }

    impl RdpInteractionKind {
        fn priority(self) -> u8 {
            match self {
                Self::PointerMove => 4,
                Self::Wheel => 3,
                Self::Keyboard => 2,
                Self::Click => 1,
            }
        }

        fn jpeg_quality(self) -> u8 {
            match self {
                Self::PointerMove => RDP_POINTER_MOVE_JPEG_QUALITY,
                Self::Wheel => RDP_WHEEL_JPEG_QUALITY,
                Self::Keyboard => RDP_KEYBOARD_JPEG_QUALITY,
                Self::Click => RDP_CLICK_JPEG_QUALITY,
            }
        }

        fn prefer_raw_rgba(self) -> bool {
            matches!(self, Self::PointerMove | Self::Wheel)
        }
    }

    impl RdpFrameEncoderState {
        fn new() -> Self {
            Self {
                rgb_buffer: Vec::new(),
                jpeg_buffer: Vec::new(),
                packet_buffer: Vec::new(),
                last_interaction: None,
            }
        }

        fn mark_interaction(&mut self, kind: RdpInteractionKind) {
            let now = Instant::now();
            self.last_interaction = match self.last_interaction {
                Some((current_kind, current_at))
                    if now.duration_since(current_at) <= RDP_INTERACTION_WINDOW
                        && current_kind.priority() > kind.priority() =>
                {
                    Some((current_kind, now))
                }
                _ => Some((kind, now)),
            };
        }

        fn interaction_kind(&self) -> Option<RdpInteractionKind> {
            self.last_interaction.and_then(|(kind, instant)| {
                (instant.elapsed() <= RDP_INTERACTION_WINDOW).then_some(kind)
            })
        }

        fn encode_mode(&self, prioritize_speed: bool) -> RdpFrameEncodeMode {
            if let Some(kind) = self.interaction_kind() {
                if kind.prefer_raw_rgba() {
                    return RdpFrameEncodeMode::RawRgba;
                }

                return RdpFrameEncodeMode::Jpeg {
                    quality: kind.jpeg_quality(),
                };
            }

            RdpFrameEncodeMode::Jpeg {
                quality: if prioritize_speed {
                    RDP_FULL_JPEG_QUALITY.saturating_sub(8)
                } else {
                    RDP_FULL_JPEG_QUALITY
                },
            }
        }
    }

    #[derive(Default)]
    struct RdpInputState {
        pressed_keys: HashSet<u16>,
        pressed_buttons: HashSet<u8>,
        last_x: u16,
        last_y: u16,
    }

    pub fn build_rdp_config(config: &RdpConnectConfig) -> Result<FreeRdpClientConfig, String> {
        let password = config
            .password
            .clone()
            .ok_or_else(|| "RDP 连接当前仅支持密码认证。".to_string())?;

        let width = config.width.unwrap_or(1280).clamp(200, 8192);
        let height = config.height.unwrap_or(720).clamp(200, 8192);

        Ok(FreeRdpClientConfig {
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            password,
            domain: config.domain.clone(),
            width,
            height,
        })
    }

    pub fn connect_rdp(
        session_id: &str,
        target: &str,
        mut config: FreeRdpClientConfig,
        server_name: String,
        port: u16,
    ) -> Result<FreeRdpClient, String> {
        config.host = server_name;
        config.port = port;

        log_rdp_info(
            session_id,
            target,
            "connect",
            format!(
                "starting FreeRDP connection {}x{}",
                config.width, config.height
            ),
        );

        let client = FreeRdpClient::connect(&config)?;

        log_rdp_info(
            session_id,
            target,
            "connected",
            format!(
                "FreeRDP desktop session established{}",
                FreeRdpClient::version()
                    .map(|version| format!(" with FreeRDP {version}"))
                    .unwrap_or_default()
            ),
        );

        Ok(client)
    }

    pub fn run_rdp_session<R: Runtime>(
        _app: AppHandle<R>,
        session_id: String,
        target: String,
        mut client: FreeRdpClient,
        frame_channel: Channel<Response>,
        control_rx: std_mpsc::Receiver<RdpControlMsg>,
    ) -> Result<(), String> {
        let mut encoder_state = RdpFrameEncoderState::new();
        let mut input_state = RdpInputState::default();
        let mut has_emitted_frame = false;
        let mut pending_frame: Option<FreeRdpFrame> = None;
        let mut last_frame_emitted_at: Option<Instant> = None;
        let started_at = Instant::now();

        log_rdp_info(
            &session_id,
            &target,
            "stream",
            "FreeRDP frame channel initialized",
        );

        loop {
            while let Ok(control) = control_rx.try_recv() {
                if !handle_rdp_control(control, &mut client, &mut input_state, &mut encoder_state)?
                {
                    log_rdp_info(
                        &session_id,
                        &target,
                        "close",
                        "session closed by frontend request",
                    );
                    return Ok(());
                }
            }

            let frame_interval = if encoder_state.interaction_kind().is_some() {
                RDP_INTERACTIVE_FRAME_INTERVAL
            } else {
                RDP_IDLE_FRAME_INTERVAL
            };

            let poll_timeout = pending_frame
                .as_ref()
                .and_then(|_| frame_due_in(last_frame_emitted_at, frame_interval))
                .map(|remaining| remaining.min(RDP_POLL_TIMEOUT))
                .unwrap_or(RDP_POLL_TIMEOUT);

            if let Some(frame) = client.poll_frame(poll_timeout)? {
                if !has_emitted_frame {
                    log_rdp_info(
                        &session_id,
                        &target,
                        "stream",
                        format!(
                            "received first FreeRDP frame after {} ms",
                            started_at.elapsed().as_millis()
                        ),
                    );
                }

                pending_frame = Some(frame);
            }

            if let Some(frame) = pending_frame.take() {
                if !should_emit_frame(last_frame_emitted_at, frame_interval) {
                    pending_frame = Some(frame);
                    continue;
                }

                let encode_mode = encoder_state.encode_mode(!has_emitted_frame);
                emit_rdp_frame(&frame_channel, &frame, &mut encoder_state, encode_mode)?;
                has_emitted_frame = true;
                last_frame_emitted_at = Some(Instant::now());
            }
        }
    }

    fn should_emit_frame(last_frame_emitted_at: Option<Instant>, interval: Duration) -> bool {
        last_frame_emitted_at
            .map(|emitted_at| emitted_at.elapsed() >= interval)
            .unwrap_or(true)
    }

    fn frame_due_in(
        last_frame_emitted_at: Option<Instant>,
        interval: Duration,
    ) -> Option<Duration> {
        let elapsed = last_frame_emitted_at?.elapsed();
        Some(interval.saturating_sub(elapsed))
    }

    fn handle_rdp_control(
        control: RdpControlMsg,
        client: &mut FreeRdpClient,
        input_state: &mut RdpInputState,
        encoder_state: &mut RdpFrameEncoderState,
    ) -> Result<bool, String> {
        match control {
            RdpControlMsg::Pointer(payload) => {
                handle_pointer(payload, client, input_state, encoder_state)?;
                Ok(true)
            }
            RdpControlMsg::Key(payload) => {
                encoder_state.mark_interaction(RdpInteractionKind::Keyboard);
                if payload.down {
                    input_state.pressed_keys.insert(payload.scancode);
                } else {
                    input_state.pressed_keys.remove(&payload.scancode);
                }
                client.send_key(payload.scancode, payload.down)?;
                Ok(true)
            }
            RdpControlMsg::ReleaseAll => {
                encoder_state.mark_interaction(RdpInteractionKind::Keyboard);
                for scancode in input_state.pressed_keys.drain().collect::<Vec<_>>() {
                    let _ = client.send_key(scancode, false);
                }
                for button in input_state.pressed_buttons.drain().collect::<Vec<_>>() {
                    let _ = client.send_pointer_button(
                        input_state.last_x,
                        input_state.last_y,
                        button,
                        false,
                    );
                }
                Ok(true)
            }
            RdpControlMsg::Resize(width, height) => {
                let width = u32::from(width).clamp(200, 8192);
                let height = u32::from(height).clamp(200, 8192);
                client.resize(width, height)?;
                Ok(true)
            }
            RdpControlMsg::Close => {
                client.close();
                Ok(false)
            }
        }
    }

    fn handle_pointer(
        payload: RdpPointerEventPayload,
        client: &mut FreeRdpClient,
        input_state: &mut RdpInputState,
        encoder_state: &mut RdpFrameEncoderState,
    ) -> Result<(), String> {
        input_state.last_x = payload.x;
        input_state.last_y = payload.y;

        match payload.kind.as_str() {
            "move" => {
                encoder_state.mark_interaction(RdpInteractionKind::PointerMove);
                client.send_pointer_move(payload.x, payload.y)?;
            }
            "down" => {
                encoder_state.mark_interaction(RdpInteractionKind::Click);
                if let Some(button) = payload.button {
                    input_state.pressed_buttons.insert(button);
                    client.send_pointer_button(payload.x, payload.y, button, true)?;
                } else {
                    client.send_pointer_move(payload.x, payload.y)?;
                }
            }
            "up" => {
                encoder_state.mark_interaction(RdpInteractionKind::Click);
                if let Some(button) = payload.button {
                    input_state.pressed_buttons.remove(&button);
                    client.send_pointer_button(payload.x, payload.y, button, false)?;
                } else {
                    client.send_pointer_move(payload.x, payload.y)?;
                }
            }
            "wheel" => {
                encoder_state.mark_interaction(RdpInteractionKind::Wheel);
                let delta_y = payload.delta_y.unwrap_or_default();
                let delta_x = payload.delta_x.unwrap_or_default();

                if delta_x.abs() > delta_y.abs() && delta_x != 0 {
                    client.send_pointer_wheel(
                        payload.x,
                        payload.y,
                        if delta_x > 0 { -120 } else { 120 },
                        true,
                    )?;
                } else if delta_y != 0 {
                    client.send_pointer_wheel(
                        payload.x,
                        payload.y,
                        if delta_y > 0 { -120 } else { 120 },
                        false,
                    )?;
                }
            }
            _ => {}
        }

        Ok(())
    }

    fn emit_rdp_frame(
        frame_channel: &Channel<Response>,
        frame: &FreeRdpFrame,
        encoder_state: &mut RdpFrameEncoderState,
        encode_mode: RdpFrameEncodeMode,
    ) -> Result<(), String> {
        let desktop_width = u16_from_dimension("desktop width", frame.desktop_width)?;
        let desktop_height = u16_from_dimension("desktop height", frame.desktop_height)?;
        let region_left = u16_from_dimension("region left", frame.left)?;
        let region_top = u16_from_dimension("region top", frame.top)?;
        let region_width = u16_from_dimension("region width", frame.width)?;
        let region_height = u16_from_dimension("region height", frame.height)?;

        let expected_len = frame
            .width
            .checked_mul(frame.height)
            .and_then(|pixels| pixels.checked_mul(4))
            .map(|value| value as usize)
            .ok_or_else(|| "RDP frame dimensions overflowed".to_string())?;
        if frame.rgba.len() != expected_len {
            return Err(format!(
                "unexpected RDP RGBA frame length: {} != {}",
                frame.rgba.len(),
                expected_len
            ));
        }

        encoder_state.packet_buffer.clear();
        encoder_state
            .packet_buffer
            .extend_from_slice(&desktop_width.to_le_bytes());
        encoder_state
            .packet_buffer
            .extend_from_slice(&desktop_height.to_le_bytes());
        encoder_state
            .packet_buffer
            .extend_from_slice(&region_left.to_le_bytes());
        encoder_state
            .packet_buffer
            .extend_from_slice(&region_top.to_le_bytes());
        encoder_state
            .packet_buffer
            .extend_from_slice(&region_width.to_le_bytes());
        encoder_state
            .packet_buffer
            .extend_from_slice(&region_height.to_le_bytes());

        let full_frame = frame.full
            || (frame.left == 0
                && frame.top == 0
                && frame.width == frame.desktop_width
                && frame.height == frame.desktop_height);

        match encode_mode {
            RdpFrameEncodeMode::RawRgba => {
                let mut flags = 0x02;
                if full_frame {
                    flags |= 0x01;
                }
                encoder_state.packet_buffer.push(flags);
                encoder_state.packet_buffer.extend_from_slice(&frame.rgba);
            }
            RdpFrameEncodeMode::Jpeg { quality } => {
                let pixel_count = frame.rgba.len() / 4;
                let rgb_len = pixel_count * 3;
                if encoder_state.rgb_buffer.len() != rgb_len {
                    encoder_state.rgb_buffer.resize(rgb_len, 0);
                }

                for (rgba_pixel, rgb_pixel) in frame
                    .rgba
                    .chunks_exact(4)
                    .zip(encoder_state.rgb_buffer.chunks_exact_mut(3))
                {
                    rgb_pixel[0] = rgba_pixel[0];
                    rgb_pixel[1] = rgba_pixel[1];
                    rgb_pixel[2] = rgba_pixel[2];
                }

                encoder_state.jpeg_buffer.clear();
                let mut encoder =
                    JpegEncoder::new_with_quality(&mut encoder_state.jpeg_buffer, quality);
                encoder
                    .encode(
                        &encoder_state.rgb_buffer,
                        frame.width,
                        frame.height,
                        ExtendedColorType::Rgb8,
                    )
                    .map_err(|e| format!("encode RDP JPEG failed: {e}"))?;

                encoder_state
                    .packet_buffer
                    .push(if full_frame { 0x01 } else { 0x00 });
                encoder_state
                    .packet_buffer
                    .extend_from_slice(&encoder_state.jpeg_buffer);
            }
        }

        frame_channel
            .send(Response::new(std::mem::take(
                &mut encoder_state.packet_buffer,
            )))
            .map_err(|e| format!("send RDP frame via channel failed: {e}"))
    }

    fn u16_from_dimension(label: &str, value: u32) -> Result<u16, String> {
        u16::try_from(value).map_err(|_| format!("RDP {label} exceeds u16 frame header: {value}"))
    }
}

#[cfg(feature = "rdp-freerdp")]
pub use freerdp_runtime::{build_rdp_config, connect_rdp, run_rdp_session};

#[cfg(not(feature = "rdp-freerdp"))]
mod disabled_runtime {
    use std::sync::mpsc as std_mpsc;

    use tauri::ipc::{Channel, Response};
    use tauri::{AppHandle, Runtime};

    use crate::types::{RdpConnectConfig, RdpControlMsg};

    pub struct DisabledRdpConfig;
    pub struct DisabledRdpClient;

    pub fn build_rdp_config(_: &RdpConnectConfig) -> Result<DisabledRdpConfig, String> {
        Err("RDP FreeRDP backend is disabled at compile time.".to_string())
    }

    pub fn connect_rdp(
        _: &str,
        _: &str,
        _: DisabledRdpConfig,
        _: String,
        _: u16,
    ) -> Result<DisabledRdpClient, String> {
        Err("RDP FreeRDP backend is disabled at compile time.".to_string())
    }

    pub fn run_rdp_session<R: Runtime>(
        _: AppHandle<R>,
        _: String,
        _: String,
        _: DisabledRdpClient,
        _: Channel<Response>,
        _: std_mpsc::Receiver<RdpControlMsg>,
    ) -> Result<(), String> {
        Err("RDP FreeRDP backend is disabled at compile time.".to_string())
    }
}

#[cfg(not(feature = "rdp-freerdp"))]
pub use disabled_runtime::{build_rdp_config, connect_rdp, run_rdp_session};
