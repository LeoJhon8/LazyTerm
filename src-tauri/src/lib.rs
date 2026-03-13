use async_trait::async_trait;
use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::{ImageBuffer, Rgba};
use ironrdp::connector::credssp::{CredsspProcessGenerator, CredsspSequence, KerberosConfig};
use ironrdp::connector::sspi::credssp::ClientState;
use ironrdp::connector::sspi::generator::GeneratorState;
use ironrdp::connector::sspi::network_client::NetworkClient;
use ironrdp::connector::{self, ConnectionResult, Credentials};
use ironrdp::connector::connection_activation::ConnectionActivationState;
use ironrdp::connector::Sequence as _;
use ironrdp::displaycontrol::pdu::MonitorLayoutEntry;
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::input::{Database as RdpInputDatabase, MouseButton as RdpMouseButton, MousePosition, Operation, Scancode, WheelRotations};
use ironrdp::pdu::geometry::InclusiveRectangle;
use ironrdp::pdu::gcc::KeyboardType;
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp::pdu::rdp::client_info::{PerformanceFlags, TimezoneInfo};
use ironrdp::pdu::rdp::headers::ShareDataPdu;
use ironrdp::pdu::rdp::refresh_rectangle::RefreshRectanglePdu;
use ironrdp::pdu::rdp::suppress_output::SuppressOutputPdu;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::{fast_path, ActiveStage, ActiveStageOutput};
use ironrdp::core::WriteBuf;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use russh::client;
use russh_keys::key;
use sspi::network_client::reqwest_network_client::ReqwestNetworkClient;
use std::{
    collections::HashMap,
    io::{Cursor, Write},
    net::{TcpStream, ToSocketAddrs},
    path::Path,
    sync::{mpsc as std_mpsc, Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};
use russh_sftp::client::SftpSession;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex as TokioMutex};
use tokio_rustls::rustls;
use uuid::Uuid;
use x509_cert::der::Decode as _;

// --- 数据结构定义 ---

/// 用于控制 SSH 后台任务的内部消息
enum SshControlMsg {
    SendData(Vec<u8>),
    Resize(u32, u32),
    Close,
}

enum RdpControlMsg {
    Pointer(RdpPointerEventPayload),
    Key(RdpKeyboardEventPayload),
    ReleaseAll,
    Resize(u16, u16),
    Close,
}

const RDP_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const RDP_POLL_TIMEOUT: Duration = Duration::from_millis(100);
const RDP_FRAME_INTERVAL: Duration = Duration::from_millis(41);
const RDP_JPEG_QUALITY: u8 = 72;
const RDP_FIRST_FRAME_WAKE_DELAY: Duration = Duration::from_millis(700);
const RDP_FIRST_FRAME_WAKE_REPEAT: Duration = Duration::from_secs(2);

fn rdp_target_label(config: &RdpConnectConfig) -> String {
    format!("{}:{}", config.host, config.port)
}

fn log_rdp_info(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    println!("[RDP][{session_id}][{target}][{stage}] {}", message.as_ref());
}

fn log_rdp_error(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    eprintln!("[RDP][{session_id}][{target}][{stage}] {}", message.as_ref());
}

fn map_sftp_error(context: &str, err: &impl std::fmt::Display, path: Option<&str>) -> String {
    let msg = err.to_string();
    let hint = if msg.contains("PermissionDenied") {
        "权限不足，请检查账号权限或目标目录权限。"
    } else if msg.contains("NoSuchFile") {
        "路径不存在，请确认远端目录已存在或可创建。"
    } else if msg.contains("ConnectionLost") || msg.contains("Connection") {
        "连接中断，请检查网络或服务端连接状态。"
    } else if msg.contains("Failure") {
        "远端返回失败，请检查服务端 SFTP 配置。"
    } else {
        "请检查服务器与路径配置。"
    };
    if let Some(p) = path {
        format!("{context}：{hint} (path={p})")
    } else {
        format!("{context}：{hint}")
    }
}

/// 本地终端会话管理
struct LocalTerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}
fn request_rdp_refresh(
    framed: &mut UpgradedFramed,
    user_channel_id: u16,
    io_channel_id: u16,
    share_id: u32,
    image: &DecodedImage,
) -> Result<(), String> {
    let full_rect = InclusiveRectangle {
        left: 0,
        top: 0,
        right: image.width().saturating_sub(1),
        bottom: image.height().saturating_sub(1),
    };

    let mut buffer = WriteBuf::new();
    let suppress_output_pdu = ShareDataPdu::SuppressOutput(SuppressOutputPdu {
        desktop_rect: Some(full_rect.clone()),
    });
    let written = connector::legacy::encode_share_data(
        user_channel_id,
        io_channel_id,
        share_id,
        suppress_output_pdu,
        &mut buffer,
    )
    .map_err(|e| format!("encode suppress output request failed: {e}"))?;
    framed
        .write_all(&buffer[..written])
        .map_err(|e| format!("send suppress output request failed: {e}"))?;

    buffer.clear();
    let refresh_pdu = ShareDataPdu::RefreshRectangle(RefreshRectanglePdu {
        areas_to_refresh: vec![full_rect],
    });
    let written = connector::legacy::encode_share_data(
        user_channel_id,
        io_channel_id,
        share_id,
        refresh_pdu,
        &mut buffer,
    )
    .map_err(|e| format!("encode refresh rectangle request failed: {e}"))?;
    framed
        .write_all(&buffer[..written])
        .map_err(|e| format!("send refresh rectangle request failed: {e}"))?;

    framed
        .get_inner_mut()
        .0
        .flush()
        .map_err(|e| format!("flush refresh request failed: {e}"))?;

    Ok(())
}


/// SSH 终端会话管理
struct SshTerminalSession {
    control_tx: mpsc::UnboundedSender<SshControlMsg>,
}

struct RdpSession {
    control_tx: std_mpsc::Sender<RdpControlMsg>,
}

struct RdpConnectionContext {
    connection_result: ConnectionResult,
    share_id: u32,
}

/// 全局应用状态，存储所有活动会话
struct AppState {
    local_sessions: Arc<StdMutex<HashMap<String, LocalTerminalSession>>>,
    ssh_sessions: Arc<TokioMutex<HashMap<String, SshTerminalSession>>>,
    rdp_sessions: Arc<StdMutex<HashMap<String, RdpSession>>>,
    sftp_upload_cancellations: Arc<StdMutex<HashMap<String, bool>>>,
}

struct SftpUploadCancelGuard {
    upload_id: String,
    cancellations: Arc<StdMutex<HashMap<String, bool>>>,
}

impl Drop for SftpUploadCancelGuard {
    fn drop(&mut self) {
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(&self.upload_id);
        }
    }
}

// --- Russh 客户端回调处理 ---

#[derive(Clone)]
struct Client;

#[async_trait]
impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        println!("收到服务器公钥响应");
        Ok(true)
    }

    async fn disconnected(&mut self, reason: client::DisconnectReason<Self::Error>) -> Result<(), Self::Error> {
        println!("--- SSH 连接已断开: {:?} ---", reason);
        Ok(())
    }
}

/// 前端传入的 SSH 配置
#[derive(serde::Deserialize, Debug)]
pub struct SshConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>, // 濡傛灉绉侀挜鏈夊瘑鐮?
    pub initial_cols: Option<u32>,
    pub initial_rows: Option<u32>,
}
#[derive(serde::Deserialize, Debug)]
pub struct SftpUploadItem {
    pub local_path: String,
    pub remote_path: String,
}

#[derive(serde::Serialize, Debug)]
pub struct SftpUploadProgress {
    pub file_index: usize,
    pub file_name: String,
    pub local_path: String,
    pub file_size: u64,
    pub file_sent: u64,
    pub overall_total: u64,
    pub overall_sent: u64,
}

#[derive(serde::Serialize, Debug)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub icon_type: String, // 'cmd', 'powershell', 'bash', 'ssh'
}

#[derive(serde::Deserialize, Debug, Clone)]
pub struct RdpConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub auto_resize: Option<bool>,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RdpPointerEventPayload {
    pub kind: String,
    pub x: u16,
    pub y: u16,
    pub button: Option<u8>,
    pub delta_x: Option<i16>,
    pub delta_y: Option<i16>,
}

#[derive(serde::Deserialize, Debug, Clone)]
pub struct RdpKeyboardEventPayload {
    pub scancode: u16,
    pub down: bool,
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RdpFrameEvent {
    pub width: u16,
    pub height: u16,
    pub mime_type: String,
    pub image_base64: String,
}

type UpgradedFramed = ironrdp_blocking::Framed<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>;

/// 核心功能：使用 russh-keys 解析多种格式的私钥
fn load_ssh_key(path: &str, passphrase: Option<String>) -> Result<key::KeyPair, String> {
    let key_content = std::fs::read_to_string(path)
        .map_err(|e| format!("无法读取密钥文件: {}", e))?;

    // decode_secret_key 支持: OpenSSH, PKCS#1, PKCS#8 以及多种加密算法
    russh_keys::decode_secret_key(&key_content, passphrase.as_deref())
        .map_err(|e| format!("私钥解析失败: {:?}. 请检查格式或密码。", e))
}

fn build_rdp_config(config: &RdpConnectConfig) -> Result<connector::Config, String> {
    let password = config
        .password
        .clone()
        .ok_or_else(|| "RDP 连接当前仅支持密码认证。".to_string())?;

    let width = config.width.unwrap_or(1280).clamp(200, 8192);
    let height = config.height.unwrap_or(720).clamp(200, 8192);
    let (width, height) = MonitorLayoutEntry::adjust_display_size(width, height);

    Ok(connector::Config {
        credentials: Credentials::UsernamePassword {
            username: config.username.clone(),
            password,
        },
        domain: config.domain.clone(),
        enable_tls: false,
        enable_credssp: true,
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: connector::DesktopSize { width: width as u16, height: height as u16 },
        bitmap: None,
        client_build: 0,
        client_name: "lazy-term-rdp".to_owned(),
        client_dir: "C:\\Windows\\System32\\mstscax.dll".to_owned(),
        #[cfg(windows)]
        platform: MajorPlatformType::WINDOWS,
        #[cfg(target_os = "macos")]
        platform: MajorPlatformType::MACINTOSH,
        #[cfg(target_os = "ios")]
        platform: MajorPlatformType::IOS,
        #[cfg(target_os = "linux")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "android")]
        platform: MajorPlatformType::ANDROID,
        #[cfg(target_os = "freebsd")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "dragonfly")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "openbsd")]
        platform: MajorPlatformType::UNIX,
        #[cfg(target_os = "netbsd")]
        platform: MajorPlatformType::UNIX,
        enable_server_pointer: true,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        pointer_software_rendering: true,
        performance_flags: PerformanceFlags::default(),
        desktop_scale_factor: 0,
        hardware_id: None,
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
    })
}

fn connect_rdp(
    session_id: &str,
    target: &str,
    config: connector::Config,
    server_name: String,
    port: u16,
) -> Result<(RdpConnectionContext, UpgradedFramed), String> {
    log_rdp_info(session_id, target, "resolve", "resolving target address");
    let server_addr = (server_name.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("lookup addr failed: {e}"))?
        .next()
        .ok_or_else(|| "socket address not found".to_string())?;

    log_rdp_info(session_id, target, "tcp", format!("connecting to {server_addr}"));
    let tcp_stream = TcpStream::connect(server_addr).map_err(|e| format!("TCP connect failed: {e}"))?;
    tcp_stream
        .set_read_timeout(Some(RDP_HANDSHAKE_TIMEOUT))
        .map_err(|e| format!("set read timeout failed: {e}"))?;
    tcp_stream
        .set_write_timeout(Some(RDP_HANDSHAKE_TIMEOUT))
        .map_err(|e| format!("set write timeout failed: {e}"))?;

    log_rdp_info(session_id, target, "tcp", "TCP connection established");

    let client_addr = tcp_stream.local_addr().map_err(|e| format!("get socket local address failed: {e}"))?;
    let mut framed = ironrdp_blocking::Framed::new(tcp_stream);
    let mut client_connector = connector::ClientConnector::new(config, client_addr);

    log_rdp_info(session_id, target, "negotiation", "starting RDP negotiation");
    let should_upgrade = ironrdp_blocking::connect_begin(&mut framed, &mut client_connector)
        .map_err(|e| format!("begin connection failed: {e}"))?;

    let initial_stream = framed.into_inner_no_leftover();
    log_rdp_info(session_id, target, "tls", "starting TLS handshake");
    let (upgraded_stream, server_public_key) = tls_upgrade(initial_stream, server_name.clone())?;
    log_rdp_info(session_id, target, "tls", "TLS handshake completed");
    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut client_connector);
    let mut upgraded_framed = ironrdp_blocking::Framed::new(upgraded_stream);

    let mut network_client = ReqwestNetworkClient;
    log_rdp_info(session_id, target, "auth", "starting CredSSP and session finalization");
    let connection_context = connect_finalize_with_share_id(
        client_connector,
        &mut upgraded_framed,
        &mut network_client,
        server_name.into(),
        server_public_key,
        None,
    )
    .map_err(|e| format!("finalize connection failed: {e}"))?;

    log_rdp_info(
        session_id,
        target,
        "connected",
        format!(
            "desktop session established at {}x{}",
            connection_context.connection_result.desktop_size.width,
            connection_context.connection_result.desktop_size.height
        ),
    );

    upgraded_framed
        .get_inner_mut()
        .0
        .get_mut()
        .set_read_timeout(Some(RDP_POLL_TIMEOUT))
        .map_err(|e| format!("set session read timeout failed: {e}"))?;

    let _ = upgraded;

    Ok((connection_context, upgraded_framed))
}

fn resolve_credssp_state(
    generator: &mut CredsspProcessGenerator<'_>,
    network_client: &mut impl NetworkClient,
) -> Result<ClientState, String> {
    let mut state = generator.start();

    loop {
        match state {
            GeneratorState::Suspended(request) => {
                let response = network_client
                    .send(&request)
                    .map_err(|e| format!("network client send failed: {e}"))?;
                state = generator.resume(Ok(response));
            }
            GeneratorState::Completed(client_state) => {
                return client_state.map_err(|e| format!("CredSSP failed: {e}"));
            }
        }
    }
}

fn perform_credssp_step(
    connector: &mut connector::ClientConnector,
    framed: &mut UpgradedFramed,
    network_client: &mut impl NetworkClient,
    buf: &mut WriteBuf,
    server_name: connector::ServerName,
    server_public_key: Vec<u8>,
    kerberos_config: Option<KerberosConfig>,
) -> Result<(), String> {
    let selected_protocol = match connector.state {
        connector::ClientConnectorState::Credssp { selected_protocol, .. } => selected_protocol,
        _ => return Err("invalid connector state for CredSSP sequence".to_string()),
    };

    let (mut sequence, mut ts_request) = CredsspSequence::init(
        connector.config.credentials.clone(),
        connector.config.domain.as_deref(),
        selected_protocol,
        server_name,
        server_public_key,
        kerberos_config,
    )
    .map_err(|e| format!("CredSSP init failed: {e}"))?;

    loop {
        let client_state = {
            let mut generator = sequence.process_ts_request(ts_request);
            resolve_credssp_state(&mut generator, network_client)?
        };

        buf.clear();
        let written = sequence
            .handle_process_result(client_state, buf)
            .map_err(|e| format!("CredSSP process result failed: {e}"))?;

        if let Some(response_len) = written.size() {
            framed
                .write_all(&buf[..response_len])
                .map_err(|e| format!("CredSSP write failed: {e}"))?;
        }

        let Some(next_pdu_hint) = sequence.next_pdu_hint() else {
            break;
        };

        let pdu = framed
            .read_by_hint(next_pdu_hint)
            .map_err(|e| format!("CredSSP read failed: {e}"))?;

        if let Some(next_request) = sequence
            .decode_server_message(&pdu)
            .map_err(|e| format!("CredSSP decode failed: {e}"))?
        {
            ts_request = next_request;
        } else {
            break;
        }
    }

    connector.mark_credssp_as_done();
    Ok(())
}

fn connect_finalize_with_share_id(
    mut connector: connector::ClientConnector,
    framed: &mut UpgradedFramed,
    network_client: &mut impl NetworkClient,
    server_name: connector::ServerName,
    server_public_key: Vec<u8>,
    kerberos_config: Option<KerberosConfig>,
) -> Result<RdpConnectionContext, String> {
    let mut buf = WriteBuf::new();
    let mut share_id: Option<u32> = None;

    if connector.should_perform_credssp() {
        perform_credssp_step(
            &mut connector,
            framed,
            network_client,
            &mut buf,
            server_name,
            server_public_key,
            kerberos_config,
        )?;
    }

    loop {
        buf.clear();

        let written = if let Some(next_pdu_hint) = connector.next_pdu_hint() {
            let pdu = framed
                .read_by_hint(next_pdu_hint)
                .map_err(|e| format!("read frame by hint failed: {e}"))?;

            if share_id.is_none()
                && matches!(connector.state, connector::ClientConnectorState::CapabilitiesExchange { .. })
            {
                let send_data_ctx = connector::legacy::decode_send_data_indication(&pdu)
                    .map_err(|e| format!("decode send data indication failed: {e}"))?;
                let share_control_ctx = connector::legacy::decode_share_control(send_data_ctx)
                    .map_err(|e| format!("decode share control failed: {e}"))?;
                share_id = Some(share_control_ctx.share_id);
            }

            connector
                .step(&pdu, &mut buf)
                .map_err(|e| format!("connection step failed: {e}"))?
        } else {
            connector
                .step_no_input(&mut buf)
                .map_err(|e| format!("connection step without input failed: {e}"))?
        };

        if let Some(response_len) = written.size() {
            framed
                .write_all(&buf[..response_len])
                .map_err(|e| format!("write response failed: {e}"))?;
        }

        if let connector::ClientConnectorState::Connected { result } = connector.state {
            return Ok(RdpConnectionContext {
                connection_result: result,
                share_id: share_id.ok_or_else(|| "share_id was not captured during activation".to_string())?,
            });
        }
    }
}

fn tls_upgrade(
    stream: TcpStream,
    server_name: String,
) -> Result<(rustls::StreamOwned<rustls::ClientConnection, TcpStream>, Vec<u8>), String> {
    let mut config = rustls::client::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(danger::NoCertificateVerification))
        .with_no_client_auth();

    config.key_log = Arc::new(rustls::KeyLogFile::new());
    config.resumption = rustls::client::Resumption::disabled();

    let server_name = server_name
        .try_into()
        .map_err(|e| format!("invalid server name: {e}"))?;

    let client = rustls::ClientConnection::new(Arc::new(config), server_name)
        .map_err(|e| format!("create TLS client failed: {e}"))?;
    let mut tls_stream = rustls::StreamOwned::new(client, stream);

    tls_stream.flush().map_err(|e| format!("TLS handshake flush failed: {e}"))?;

    let cert = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certificates| certificates.first())
        .ok_or_else(|| "peer certificate is missing".to_string())?;

    let server_public_key = extract_tls_server_public_key(cert)?;
    Ok((tls_stream, server_public_key))
}

fn extract_tls_server_public_key(cert: &[u8]) -> Result<Vec<u8>, String> {
    let cert = x509_cert::Certificate::from_der(cert).map_err(|e| format!("parse certificate failed: {e}"))?;
    cert.tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .map(|value| value.to_owned())
        .ok_or_else(|| "subject public key BIT STRING is not aligned".to_string())
}

fn emit_rdp_frame<R: Runtime>(app: &AppHandle<R>, session_id: &str, image: &DecodedImage) -> Result<(), String> {
    let buffer = image.data().to_vec();
    let image_buffer = ImageBuffer::<Rgba<u8>, _>::from_raw(
        u32::from(image.width()),
        u32::from(image.height()),
        buffer,
    )
    .ok_or_else(|| "invalid RDP image buffer".to_string())?;

    let dynamic_image = image::DynamicImage::ImageRgba8(image_buffer);
    let rgb_image = dynamic_image.to_rgb8();
    let mut encoded_bytes = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut encoded_bytes, RDP_JPEG_QUALITY);
    encoder
        .encode_image(&image::DynamicImage::ImageRgb8(rgb_image))
        .map_err(|e| format!("encode JPEG failed: {e}"))?;

    let payload = RdpFrameEvent {
        width: image.width(),
        height: image.height(),
        mime_type: "image/jpeg".to_string(),
        image_base64: base64::engine::general_purpose::STANDARD.encode(encoded_bytes.into_inner()),
    };

    app.emit(&format!("rdp-frame-{session_id}"), payload)
        .map_err(|e| format!("emit RDP frame failed: {e}"))
}

fn handle_rdp_outputs<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    framed: &mut UpgradedFramed,
    active_stage: &mut ActiveStage,
    image: &mut DecodedImage,
    outputs: Vec<ActiveStageOutput>,
    last_frame_emit_at: &mut Instant,
) -> Result<bool, String> {
    let mut should_emit_frame = false;
    let mut force_emit_frame = false;

    for output in outputs {
        match output {
            ActiveStageOutput::ResponseFrame(frame) => {
                framed.write_all(&frame).map_err(|e| format!("write response failed: {e}"))?;
            }
            ActiveStageOutput::GraphicsUpdate(_) => {
                should_emit_frame = true;
            }
            ActiveStageOutput::PointerDefault
            | ActiveStageOutput::PointerHidden
            | ActiveStageOutput::PointerPosition { .. }
            | ActiveStageOutput::PointerBitmap(_) => {}
            ActiveStageOutput::Terminate(_) => {
                return Ok(false);
            }
            ActiveStageOutput::DeactivateAll(mut activation) => {
                let mut buffer = WriteBuf::new();
                loop {
                    buffer.clear();

                    let written = if let Some(next_pdu_hint) = activation.next_pdu_hint() {
                        let pdu = framed
                            .read_by_hint(next_pdu_hint)
                            .map_err(|e| format!("connection reactivation read failed: {e}"))?;
                        activation
                            .step(&pdu, &mut buffer)
                            .map_err(|e| format!("connection reactivation step failed: {e}"))?
                    } else {
                        activation
                            .step_no_input(&mut buffer)
                            .map_err(|e| format!("connection reactivation step failed: {e}"))?
                    };

                    if let Some(response_len) = written.size() {
                        framed
                            .write_all(&buffer[..response_len])
                            .map_err(|e| format!("connection reactivation write failed: {e}"))?;
                    }

                    if let ConnectionActivationState::Finalized {
                        io_channel_id,
                        user_channel_id,
                        desktop_size,
                        enable_server_pointer,
                        pointer_software_rendering,
                    } = activation.connection_activation_state()
                    {
                        *image = DecodedImage::new(PixelFormat::RgbA32, desktop_size.width, desktop_size.height);
                        active_stage.set_fastpath_processor(
                            fast_path::ProcessorBuilder {
                                io_channel_id,
                                user_channel_id,
                                enable_server_pointer,
                                pointer_software_rendering,
                            }
                            .build(),
                        );
                        active_stage.set_enable_server_pointer(enable_server_pointer);
                        should_emit_frame = true;
                        force_emit_frame = true;
                        break;
                    }
                }
            }
        }
    }

    if should_emit_frame && (force_emit_frame || last_frame_emit_at.elapsed() >= RDP_FRAME_INTERVAL) {
        emit_rdp_frame(app, session_id, image)?;
        *last_frame_emit_at = Instant::now();
    }

    Ok(true)
}

fn map_rdp_mouse_button(button: Option<u8>) -> Option<RdpMouseButton> {
    match button {
        Some(0) => Some(RdpMouseButton::Left),
        Some(1) => Some(RdpMouseButton::Middle),
        Some(2) => Some(RdpMouseButton::Right),
        Some(3) => Some(RdpMouseButton::X1),
        Some(4) => Some(RdpMouseButton::X2),
        _ => None,
    }
}

fn handle_rdp_control<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    control: RdpControlMsg,
    framed: &mut UpgradedFramed,
    active_stage: &mut ActiveStage,
    image: &mut DecodedImage,
    input_db: &mut RdpInputDatabase,
    last_frame_emit_at: &mut Instant,
) -> Result<bool, String> {
    match control {
        RdpControlMsg::Pointer(payload) => {
            let mut operations = vec![Operation::MouseMove(MousePosition { x: payload.x, y: payload.y })];

            match payload.kind.as_str() {
                "down" => {
                    if let Some(button) = map_rdp_mouse_button(payload.button) {
                        operations.push(Operation::MouseButtonPressed(button));
                    }
                }
                "up" => {
                    if let Some(button) = map_rdp_mouse_button(payload.button) {
                        operations.push(Operation::MouseButtonReleased(button));
                    }
                }
                "wheel" => {
                    let delta_y = payload.delta_y.unwrap_or_default();
                    let delta_x = payload.delta_x.unwrap_or_default();

                    if delta_x.abs() > delta_y.abs() && delta_x != 0 {
                        operations.push(Operation::WheelRotations(WheelRotations {
                            is_vertical: false,
                            rotation_units: if delta_x > 0 { -120 } else { 120 },
                        }));
                    } else if delta_y != 0 {
                        operations.push(Operation::WheelRotations(WheelRotations {
                            is_vertical: true,
                            rotation_units: if delta_y > 0 { -120 } else { 120 },
                        }));
                    }
                }
                _ => {}
            }

            let outputs = active_stage
                .process_fastpath_input(image, &input_db.apply(operations))
                .map_err(|e| format!("process pointer input failed: {e}"))?;

            handle_rdp_outputs(app, session_id, framed, active_stage, image, outputs, last_frame_emit_at)
        }
        RdpControlMsg::Key(payload) => {
            let operation = if payload.down {
                Operation::KeyPressed(Scancode::from_u16(payload.scancode))
            } else {
                Operation::KeyReleased(Scancode::from_u16(payload.scancode))
            };

            let outputs = active_stage
                .process_fastpath_input(image, &input_db.apply([operation]))
                .map_err(|e| format!("process keyboard input failed: {e}"))?;

            handle_rdp_outputs(app, session_id, framed, active_stage, image, outputs, last_frame_emit_at)
        }
        RdpControlMsg::ReleaseAll => {
            let outputs = active_stage
                .process_fastpath_input(image, &input_db.release_all())
                .map_err(|e| format!("release keyboard state failed: {e}"))?;

            handle_rdp_outputs(app, session_id, framed, active_stage, image, outputs, last_frame_emit_at)
        }
        RdpControlMsg::Resize(width, height) => {
            let (width, height) = MonitorLayoutEntry::adjust_display_size(width as u32, height as u32);
            if let Some(response_frame) = active_stage.encode_resize(width, height, None, None) {
                let response_frame = response_frame.map_err(|e| format!("encode resize failed: {e}"))?;
                framed.write_all(&response_frame).map_err(|e| format!("send resize failed: {e}"))?;
            }
            Ok(true)
        }
        RdpControlMsg::Close => {
            let outputs = active_stage
                .graceful_shutdown()
                .map_err(|e| format!("graceful shutdown failed: {e}"))?;
            let _ = handle_rdp_outputs(app, session_id, framed, active_stage, image, outputs, last_frame_emit_at);
            Ok(false)
        }
    }
}

fn run_rdp_session<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    target: String,
    connection_context: RdpConnectionContext,
    mut framed: UpgradedFramed,
    control_rx: std_mpsc::Receiver<RdpControlMsg>,
) -> Result<(), String> {
    let share_id = connection_context.share_id;
    let io_channel_id = connection_context.connection_result.io_channel_id;
    let user_channel_id = connection_context.connection_result.user_channel_id;
    let desktop_width = connection_context.connection_result.desktop_size.width;
    let desktop_height = connection_context.connection_result.desktop_size.height;

    let mut image = DecodedImage::new(PixelFormat::RgbA32, desktop_width, desktop_height);
    let mut active_stage = ActiveStage::new(connection_context.connection_result);
    let mut input_db = RdpInputDatabase::new();
    let mut received_server_frame = false;
    let mut last_frame_emit_at = Instant::now() - RDP_FRAME_INTERVAL;
    let started_at = Instant::now();
    let mut last_first_frame_wake_at: Option<Instant> = None;

    log_rdp_info(&session_id, &target, "stream", "frontend frame channel initialized");

    framed
        .get_inner_mut()
        .0
        .flush()
        .map_err(|e| format!("flush upgraded stream failed: {e}"))?;
    log_rdp_info(&session_id, &target, "stream", "flushed upgraded stream after connect");

    request_rdp_refresh(&mut framed, user_channel_id, io_channel_id, share_id, &image)?;
    log_rdp_info(&session_id, &target, "stream", "sent initial SuppressOutput + RefreshRectangle request");

    loop {
        while let Ok(control) = control_rx.try_recv() {
            if !handle_rdp_control(
                &app,
                &session_id,
                control,
                &mut framed,
                &mut active_stage,
                &mut image,
                &mut input_db,
                &mut last_frame_emit_at,
            )? {
                log_rdp_info(&session_id, &target, "close", "session closed by frontend request");
                return Ok(());
            }
        }

        if !received_server_frame {
            let elapsed = started_at.elapsed();
            let should_request_refresh = elapsed >= RDP_FIRST_FRAME_WAKE_DELAY
                && last_first_frame_wake_at.is_none_or(|last| last.elapsed() >= RDP_FIRST_FRAME_WAKE_REPEAT);

            if should_request_refresh {
                last_first_frame_wake_at = Some(Instant::now());
                log_rdp_info(
                    &session_id,
                    &target,
                    "stream",
                    format!("no server frame after {} ms, sending refresh request", elapsed.as_millis()),
                );
                let _ = request_rdp_refresh(&mut framed, user_channel_id, io_channel_id, share_id, &image);
            }
        }

        match framed.read_pdu() {
            Ok((action, payload)) => {
                if !received_server_frame {
                    received_server_frame = true;
                    log_rdp_info(
                        &session_id,
                        &target,
                        "stream",
                        format!("received first server update after {} ms", started_at.elapsed().as_millis()),
                    );
                }

                let outputs = active_stage
                    .process(&mut image, action, &payload)
                    .map_err(|e| format!("process active stage failed: {e}"))?;

                if !handle_rdp_outputs(
                    &app,
                    &session_id,
                    &mut framed,
                    &mut active_stage,
                    &mut image,
                    outputs,
                    &mut last_frame_emit_at,
                )? {
                    return Ok(());
                }
            }
            Err(error) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("read RDP frame failed: {error}")),
        }
    }
}

// --- Tauri 指令实现 ---

/// 创建本地终端 (Portable-PTY)
#[tauri::command]
async fn create_terminal<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    cwd: Option<String>,
    shell: Option<String>,
    admin: Option<bool>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut shell_cmd = shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
        }
    });

    // 针对 Windows 特殊处理 'bash' / 'git-bash' 的路径探测
    if cfg!(target_os = "windows") && (shell_cmd == "bash.exe" || shell_cmd == "git-bash" || shell_cmd == "bash") {
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let common_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe".to_string(),
            "C:\\Program Files\\Git\\usr\\bin\\bash.exe".to_string(),
            format!("{}\\AppData\\Local\\Programs\\Git\\bin\\bash.exe", user_profile),
            format!("{}\\AppData\\Local\\Programs\\Git\\usr\\bin\\bash.exe", user_profile),
        ];
        for path in common_paths {
            if std::path::Path::new(&path).exists() {
                shell_cmd = path;
                break;
            }
        }
    }

    let mut cmd = if cfg!(target_os = "windows") && admin.unwrap_or(false) {
        // Windows 11 sudo 默认可能会开新窗口
        // 使用 --inline (或 -e) 尝试在当前控制台会话中运行
        // 注意：这要求用户在 Windows 设置中将 sudo 配置为“内联”或“允许输入”模式
        let mut c = CommandBuilder::new("sudo");
        c.arg("--inline"); 
        c.arg(shell_cmd);
        c
    } else {
        CommandBuilder::new(shell_cmd)
    };

    if let Some(path) = cwd {
        cmd.cwd(path);
    }

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    let session_id_clone = session_id.clone();
    let local_sessions = state.local_sessions.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let event_name = format!("terminal-data-{}", session_id_clone);
        let close_event_name = format!("terminal-close-{}", session_id_clone);
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 { break; }
            let data = String::from_utf8_lossy(&buffer[..n]).to_string();
            let _ = app.emit(&event_name, data);
        }

        let should_emit_close = local_sessions.lock().unwrap().remove(&session_id_clone).is_some();
        if should_emit_close {
            let _ = app.emit(&close_event_name, ());
        }
    });

    state.local_sessions.lock().unwrap().insert(
        session_id.clone(),
        LocalTerminalSession { master, writer },
    );

    Ok(session_id)
}

/// 获取当前系统可用的 Shell 列表
#[tauri::command]
async fn get_available_shells() -> Result<Vec<ShellInfo>, String> {
    let mut shells = Vec::new();

    if cfg!(target_os = "windows") {
        shells.push(ShellInfo { name: "CMD".into(), path: "cmd.exe".into(), icon_type: "cmd".into() });
        shells.push(ShellInfo { name: "PowerShell".into(), path: "powershell.exe".into(), icon_type: "powershell".into() });
        
        // 探测 PowerShell Core
        if std::path::Path::new("C:\\Program Files\\PowerShell\\7\\pwsh.exe").exists() {
            shells.push(ShellInfo { name: "PowerShell 7".into(), path: "pwsh.exe".into(), icon_type: "powershell".into() });
        }

        // 探测 Git Bash
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let git_bash_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe".to_string(),
            format!("{}\\AppData\\Local\\Programs\\Git\\bin\\bash.exe", user_profile),
        ];
        
        for path in git_bash_paths {
            if std::path::Path::new(&path).exists() {
                shells.push(ShellInfo { name: "Git Bash".into(), path: path.into(), icon_type: "bash".into() });
                break;
            }
        }
    } else {
        // macOS / Linux
        let common = ["bash", "zsh", "fish", "sh"];
        for s in common {
            let path = format!("/bin/{}", s);
            let usr_path = format!("/usr/bin/{}", s);
            if std::path::Path::new(&path).exists() {
                shells.push(ShellInfo { name: s.to_uppercase(), path, icon_type: "bash".into() });
            } else if std::path::Path::new(&usr_path).exists() {
                shells.push(ShellInfo { name: s.to_uppercase(), path: usr_path, icon_type: "bash".into() });
            }
        }
    }

    Ok(shells)
}

/// 创建 SSH 终端 (异步全格式支持)
#[tauri::command]
async fn create_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: SshConnectConfig,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    
    // --- 算法兼容性增强设计 ---
    // Ubuntu 24.04 (OpenSSH 9.x) 建议使用默认算法并由系统自动协商
    let mut ssh_config = client::Config::default();
    
    // 使用默认首选列表，包含 ED25519, RSA-SHA2 等
    ssh_config.preferred = russh::Preferred::DEFAULT;

    let ssh_config = Arc::new(ssh_config);
    println!("--- SSH 连接尝试: {}@{}:{} ---", config.username, config.host, config.port);
    let addr = format!("{}:{}", config.host, config.port);

    // 1. 建立连接
    let mut handle = client::connect(ssh_config, addr.clone(), Client)
        .await
        .map_err(|e| {
            println!("网络连接失败 ({}): {:?}", addr, e);
            format!("网络连接失败: {:?}", e)
        })?;
    println!("网络底层连接已建立: {}", addr);

    // 2. 身份认证流程
    let mut authenticated = false;

    // 优先尝试私钥认证
    if let Some(key_path) = config.private_key_path {
        println!("尝试私钥认证: {}", key_path);
        let key_pair = load_ssh_key(&key_path, config.private_key_passphrase)?;
        match handle.authenticate_publickey(config.username.clone(), Arc::new(key_pair)).await {
            Ok(true) => {
                println!("私钥认证成功");
                authenticated = true;
            }
            Ok(false) => println!("服务器拒绝了私钥认证"),
            Err(e) => println!("私钥认证过程出错: {:?}", e),
        }
    }

    // 如果认证未成功，尝试密码
    if !authenticated {
        if let Some(password) = config.password.clone() {
            // 2.a 尝试 Keyboard-Interactive (优先走交互，避免“污染”会话)
            println!("开始认证交互 (尝试 Keyboard-Interactive 模式)...");
            
            // 给服务器一点喘息时间
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;

            // 启动交互流程
            let kbd_start_res = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                handle.authenticate_keyboard_interactive_start(config.username.clone(), None)
            ).await;

            let kbd_start_enum = match kbd_start_res {
                Ok(Ok(res)) => Some(res),
                _ => None, // 超时或底层错误
            };

            let mut kbd_authenticated = false;
            let mut should_fallback_to_password = false;

            if let Some(res) = kbd_start_enum {
                let mut current_kbd_res = Ok(res);
                // 处理交互循环
                for i in 0..5 {
                    match current_kbd_res {
                        Ok(client::KeyboardInteractiveAuthResponse::Success) => {
                            println!("Keyboard-Interactive 认证成功！");
                            kbd_authenticated = true;
                            break;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, name, .. }) => {
                            println!("收到交互请求 (轮次 {}): Name='{}', Prompts={}", i + 1, name, prompts.len());
                            let mut responses = Vec::new();
                            for _p in prompts.iter() {
                                responses.push(password.clone());
                            }
                            current_kbd_res = handle.authenticate_keyboard_interactive_respond(responses).await;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::Failure) => {
                            println!("Keyboard-Interactive 被服务器显式拒绝，切换为标准密码认证...");
                            should_fallback_to_password = true;
                            break;
                        }
                        Err(e) => {
                            println!("Keyboard-Interactive 流程错误: {:?}", e);
                            should_fallback_to_password = true;
                            break;
                        }
                    }
                }
            } else {
                println!("Keyboard-Interactive 启动失败或超时，尝试标准密码认证...");
                should_fallback_to_password = true;
            }

            if kbd_authenticated {
                authenticated = true;
            } else if should_fallback_to_password {
                // 2.b 如果 KBI 被拒绝或不支持，尝试标准密码认证 (RFC 4252)
                println!("开始尝试直接密码认证 (Password Authentication)...");
                match handle.authenticate_password(config.username.clone(), password).await {
                    Ok(true) => {
                        println!("标准密码认证成功");
                        authenticated = true;
                    }
                    Ok(false) => println!("标准密码认证也被服务器拒绝"),
                    Err(e) => println!("标准密码认证出错: {:?}", e),
                }
            }
        }
    }

    if !authenticated {
        println!("所有认证方式均已尝试，认证失败。");
        return Err("SSH 认证失败：密钥或密码错误".to_string());
    }
    println!("认证通过，正在初始化会话通道...");

    // 3. 打开 Channel 并请求 PTY
    let mut channel = handle.channel_open_session().await.map_err(|e| e.to_string())?;
    let initial_cols = config.initial_cols.unwrap_or(80).clamp(40, 400);
    let initial_rows = config.initial_rows.unwrap_or(24).clamp(12, 200);
    channel.request_pty(true, "xterm-256color", initial_cols, initial_rows, 0, 0, &[]).await.map_err(|e| e.to_string())?;
    let _ = channel.set_env(false, "TERM_PROGRAM", "LazyTerm").await;
    let _ = channel.set_env(false, "TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION")).await;
    let _ = channel.set_env(false, "COLORTERM", "truecolor").await;
    channel.request_shell(true).await.map_err(|e| e.to_string())?;

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<SshControlMsg>();
    let session_id_clone = session_id.clone();

    // 4. 后台任务：处理 SSH 双向数据流
    tokio::spawn(async move {
        let event_name = format!("terminal-data-{}", session_id_clone);
        let close_event_name = format!("terminal-close-{}", session_id_clone);
        loop {
            tokio::select! {
                // 读取远程服务器输出
                msg = channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { data }) => {
                            let _ = app.emit(&event_name, String::from_utf8_lossy(&data).to_string());
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                            // 发送连接关闭事件
                            let _ = app.emit(&close_event_name, ());
                            break;
                        }
                        _ => {}
                    }
                }
                // 处理本地控制请求
                Some(ctrl) = control_rx.recv() => {
                    match ctrl {
                        SshControlMsg::SendData(data) => { let _ = channel.data(&data[..]).await; }
                        SshControlMsg::Resize(cols, rows) => { let _ = channel.window_change(cols, rows, 0, 0).await; }
                        SshControlMsg::Close => { 
                            let _ = app.emit(&close_event_name, ());
                            let _ = channel.close().await; 
                            break; 
                        }
                    }
                }
            }
        }
    });

    state.ssh_sessions.lock().await.insert(
        session_id.clone(),
        SshTerminalSession { control_tx },
    );

    Ok(session_id)
}

#[tauri::command]
async fn create_rdp_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: RdpConnectConfig,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let target = rdp_target_label(&config);
    log_rdp_info(&session_id, &target, "connect", "received open request from frontend");

    let connector_config = build_rdp_config(&config).map_err(|error| {
        log_rdp_error(&session_id, &target, "config", &error);
        error
    })?;
    let (connection_context, framed) = connect_rdp(&session_id, &target, connector_config, config.host.clone(), config.port).map_err(|error| {
        log_rdp_error(&session_id, &target, "connect", &error);
        error
    })?;

    let (control_tx, control_rx) = std_mpsc::channel::<RdpControlMsg>();
    state.rdp_sessions.lock().unwrap().insert(
        session_id.clone(),
        RdpSession { control_tx },
    );

    log_rdp_info(&session_id, &target, "connect", "session registered in backend state");

    let session_id_clone = session_id.clone();
    let target_clone = target.clone();
    let app_clone = app.clone();
    let rdp_sessions = Arc::clone(&state.rdp_sessions);
    std::thread::spawn(move || {
        match run_rdp_session(app_clone.clone(), session_id_clone.clone(), target_clone.clone(), connection_context, framed, control_rx) {
            Ok(()) => log_rdp_info(&session_id_clone, &target_clone, "close", "session loop ended"),
            Err(error) => log_rdp_error(&session_id_clone, &target_clone, "runtime", &error),
        }
        rdp_sessions.lock().unwrap().remove(&session_id_clone);
        let _ = app_clone.emit(&format!("rdp-close-{}", session_id_clone), ());
    });

    Ok(session_id)
}

/// SFTP 上传文件
#[tauri::command]
async fn sftp_upload_file(
    config: SshConnectConfig,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let host = config.host.clone();
    let port = config.port;
    let username = config.username.clone();
    let password = config.password.clone();
    let key_path = config.private_key_path.clone();
    let passphrase = config.private_key_passphrase.clone();

    let mut ssh_config = client::Config::default();
    ssh_config.preferred = russh::Preferred::DEFAULT;
    let ssh_config = Arc::new(ssh_config);

    let addr = format!("{}:{}", host, port);
    let mut handle = client::connect(ssh_config, addr.clone(), Client)
        .await
        .map_err(|e| format!("连接失败：{}", e))?;

    let mut authenticated = false;

    if let Some(key_path) = key_path {
        let key_pair = load_ssh_key(&key_path, passphrase)?;
        match handle
            .authenticate_publickey(username.clone(), Arc::new(key_pair))
            .await
        {
            Ok(true) => authenticated = true,
            Ok(false) => {}
            Err(e) => return Err(format!("私钥认证失败：{}", e)),
        }
    }

    if !authenticated {
        if let Some(password) = password.clone() {
            let kbd_start_res = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                handle.authenticate_keyboard_interactive_start(username.clone(), None),
            ).await;

            let kbd_start_enum = match kbd_start_res {
                Ok(Ok(res)) => Some(res),
                _ => None,
            };

            let mut kbd_authenticated = false;
            let mut should_fallback_to_password = false;

            if let Some(res) = kbd_start_enum {
                let mut current_kbd_res = Ok(res);
                for _ in 0..5 {
                    match current_kbd_res {
                        Ok(client::KeyboardInteractiveAuthResponse::Success) => {
                            kbd_authenticated = true;
                            break;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. }) => {
                            let mut responses = Vec::new();
                            for _ in prompts.iter() {
                                responses.push(password.clone());
                            }
                            current_kbd_res = handle.authenticate_keyboard_interactive_respond(responses).await;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::Failure) => {
                            should_fallback_to_password = true;
                            break;
                        }
                        Err(_) => {
                            should_fallback_to_password = true;
                            break;
                        }
                    }
                }
            } else {
                should_fallback_to_password = true;
            }

            if kbd_authenticated {
                authenticated = true;
            } else if should_fallback_to_password {
                match handle
                    .authenticate_password(username.clone(), password)
                    .await
                {
                    Ok(true) => authenticated = true,
                    Ok(false) => {}
                Err(e) => return Err(format!("密码认证失败：{}", e)),
                }
            }
        }
    }

    if !authenticated {
        return Err("SSH 认证失败，请检查账号、私钥或密码。".to_string());
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开会话失败：{}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("请求 SFTP 子系统失败：{}", e))?;

    let stream = channel.into_stream();
    let sftp = SftpSession::new(stream)
        .await
        .map_err(|e| format!("SFTP 初始化失败：{}", e))?;

    let meta = tokio::fs::metadata(&local_path)
        .await
        .map_err(|e| format!("读取本地文件失败：{} (path={})", e, local_path))?;
    if !meta.is_file() {
        return Err(format!("读取本地文件失败：不是文件 (path={})", local_path));
    }
    let data = tokio::fs::read(&local_path)
        .await
        .map_err(|e| format!("读取本地文件失败：{} (path={})", e, local_path))?;
    let remote_path_resolved = if remote_path.starts_with("~/") {
        match sftp.canonicalize(".").await {
            Ok(cwd) => format!("{}/{}", cwd.trim_end_matches('/'), &remote_path[2..]),
            Err(_) => remote_path.clone(),
        }
    } else {
        remote_path.clone()
    };

    if let Some(parent) = remote_path_resolved.rsplit_once('/') {
        let dir = parent.0;
        if !dir.is_empty() {
            let mut cur = String::new();
            let mut first = true;
            for part in dir.split('/') {
                if part.is_empty() {
                    if first {
                        cur.push('/');
                    }
                    first = false;
                    continue;
                }
                if !cur.ends_with('/') && !cur.is_empty() {
                    cur.push('/');
                }
                cur.push_str(part);
                let exists = sftp.try_exists(cur.clone())
                    .await
                    .unwrap_or(false);
                if !exists {
                    if let Err(e) = sftp.create_dir(cur.clone()).await {
                        let exists_after = sftp.try_exists(cur.clone())
                            .await
                            .unwrap_or(false);
                        if !exists_after {
                            return Err(map_sftp_error("创建远程目录失败", &e, Some(&cur)));
                        }
                    }
                }
                first = false;
            }
        }
    }

    match sftp.create(&remote_path_resolved).await {
            Ok(mut file) => {
                match file.write_all(&data).await {
                    Ok(_) => {
                        let _ = sftp.close().await;
                        return Ok(());
                    }
                    Err(e) => {
                        return Err(map_sftp_error("写入远程文件失败", &e, Some(&remote_path_resolved)));
                    }
                }
            }
            Err(e) => {
                return Err(map_sftp_error("创建远程文件失败", &e, Some(&remote_path_resolved)));
            }
    }
}

/// SFTP 批量上传文件（带进度）
#[tauri::command]
async fn sftp_upload_files(
    app: AppHandle,
    state: State<'_, AppState>,
    config: SshConnectConfig,
    files: Vec<SftpUploadItem>,
    progress_event: String,
    upload_id: String,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    {
        let mut cancellations = state.sftp_upload_cancellations.lock().unwrap();
        cancellations.insert(upload_id.clone(), false);
    }
    let _cancel_guard = SftpUploadCancelGuard {
        upload_id: upload_id.clone(),
        cancellations: Arc::clone(&state.sftp_upload_cancellations),
    };

    let host = config.host.clone();
    let port = config.port;
    let username = config.username.clone();
    let password = config.password.clone();
    let key_path = config.private_key_path.clone();
    let passphrase = config.private_key_passphrase.clone();

    let mut ssh_config = client::Config::default();
    ssh_config.preferred = russh::Preferred::DEFAULT;
    let ssh_config = Arc::new(ssh_config);

    let addr = format!("{}:{}", host, port);
    let mut handle = client::connect(ssh_config, addr.clone(), Client)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let mut authenticated = false;

    if let Some(key_path) = key_path {
        let key_pair = load_ssh_key(&key_path, passphrase)?;
        match handle
            .authenticate_publickey(username.clone(), Arc::new(key_pair))
            .await
        {
            Ok(true) => authenticated = true,
            Ok(false) => {}
            Err(e) => return Err(format!("私钥认证失败: {}", e)),
        }
    }

    if !authenticated {
        if let Some(password) = password.clone() {
            let kbd_start_res = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                handle.authenticate_keyboard_interactive_start(username.clone(), None),
            ).await;

            let kbd_start_enum = match kbd_start_res {
                Ok(Ok(res)) => Some(res),
                _ => None,
            };

            let mut kbd_authenticated = false;
            let mut should_fallback_to_password = false;

            if let Some(res) = kbd_start_enum {
                let mut current_kbd_res = Ok(res);
                for _ in 0..5 {
                    match current_kbd_res {
                        Ok(client::KeyboardInteractiveAuthResponse::Success) => {
                            kbd_authenticated = true;
                            break;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. }) => {
                            let mut responses = Vec::new();
                            for _ in prompts.iter() {
                                responses.push(password.clone());
                            }
                            current_kbd_res = handle.authenticate_keyboard_interactive_respond(responses).await;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::Failure) => {
                            should_fallback_to_password = true;
                            break;
                        }
                        Err(_) => {
                            should_fallback_to_password = true;
                            break;
                        }
                    }
                }
            } else {
                should_fallback_to_password = true;
            }

            if kbd_authenticated {
                authenticated = true;
            } else if should_fallback_to_password {
                match handle
                    .authenticate_password(username.clone(), password)
                    .await
                {
                    Ok(true) => authenticated = true,
                    Ok(false) => {}
                Err(e) => return Err(format!("密码认证失败: {}", e)),
                }
            }
        }
    }

    if !authenticated {
        return Err("SSH 认证失败，请检查账号、私钥或密码。".to_string());
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开会话失败: {}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("请求 SFTP 子系统失败: {}", e))?;

    let stream = channel.into_stream();
    let sftp = SftpSession::new(stream)
        .await
        .map_err(|e| format!("SFTP 初始化失败: {}", e))?;

    let mut file_infos: Vec<(usize, SftpUploadItem, u64, String)> = Vec::new();
    let mut overall_total = 0u64;
    for (index, item) in files.into_iter().enumerate() {
        let meta = tokio::fs::metadata(&item.local_path)
            .await
            .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;
        if !meta.is_file() {
            return Err(format!("读取本地文件失败: 不是文件 (path={})", item.local_path));
        }
        let size = meta.len();
        overall_total += size;
        let file_name = Path::new(&item.local_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&item.local_path)
            .to_string();
        file_infos.push((index, item, size, file_name));
    }

    let mut overall_sent = 0u64;
    for (index, item, file_size, file_name) in file_infos.into_iter() {
        let cancelled = state
            .sftp_upload_cancellations
            .lock()
            .unwrap()
            .get(&upload_id)
            .copied()
            .unwrap_or(false);
        if cancelled {
            return Err("上传已停止".to_string());
        }

        let remote_path_resolved = if item.remote_path.starts_with("~/") {
            match sftp.canonicalize(".").await {
                Ok(cwd) => format!("{}/{}", cwd.trim_end_matches('/'), &item.remote_path[2..]),
                Err(_) => item.remote_path.clone(),
            }
        } else {
            item.remote_path.clone()
        };

        if remote_path_resolved.is_empty() {
            return Err("远程路径不能为空。".to_string());
        }

        if let Some(parent) = remote_path_resolved.rsplit_once('/') {
            let dir = parent.0;
            if !dir.is_empty() {
                let mut cur = String::new();
                let mut first = true;
                for part in dir.split('/') {
                    if part.is_empty() {
                        if first {
                            cur.push('/');
                        }
                        first = false;
                        continue;
                    }
                    if !cur.ends_with('/') && !cur.is_empty() {
                        cur.push('/');
                    }
                    cur.push_str(part);
                    let exists = sftp.try_exists(cur.clone())
                        .await
                        .unwrap_or(false);
                    if !exists {
                        if let Err(e) = sftp.create_dir(cur.clone()).await {
                            let exists_after = sftp.try_exists(cur.clone())
                                .await
                                .unwrap_or(false);
                            if !exists_after {
                                return Err(map_sftp_error("创建远程目录失败", &e, Some(&cur)));
                            }
                        }
                    }
                    first = false;
                }
            }
        }

        let mut local_file = tokio::fs::File::open(&item.local_path)
            .await
            .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;

        let mut remote_file = match sftp.create(&remote_path_resolved).await {
            Ok(file) => file,
            Err(e) => return Err(map_sftp_error("创建远程文件失败", &e, Some(&remote_path_resolved))),
        };

        let mut sent = 0u64;
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let cancelled = state
                .sftp_upload_cancellations
                .lock()
                .unwrap()
                .get(&upload_id)
                .copied()
                .unwrap_or(false);
            if cancelled {
                return Err("上传已停止".to_string());
            }

            let n = local_file.read(&mut buffer)
                .await
                .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;
            if n == 0 { break; }
            remote_file.write_all(&buffer[..n])
                .await
                .map_err(|e| map_sftp_error("写入远程文件失败", &e, Some(&remote_path_resolved)))?;
            sent += n as u64;
            overall_sent += n as u64;
            let progress = SftpUploadProgress {
                file_index: index,
                file_name: file_name.clone(),
                local_path: item.local_path.clone(),
                file_size,
                file_sent: sent.min(file_size),
                overall_total,
                overall_sent: overall_sent.min(overall_total),
            };
            let _ = app.emit(&progress_event, &progress);
        }

        if file_size == 0 {
            let progress = SftpUploadProgress {
                file_index: index,
                file_name: file_name.clone(),
                local_path: item.local_path.clone(),
                file_size,
                file_sent: 0,
                overall_total,
                overall_sent,
            };
            let _ = app.emit(&progress_event, &progress);
        }
    }

    let _ = sftp.close().await;
    Ok(())
}

#[tauri::command]
fn cancel_sftp_upload(state: State<'_, AppState>, upload_id: String) -> Result<(), String> {
    let mut cancellations = state.sftp_upload_cancellations.lock().unwrap();
    if let Some(cancelled) = cancellations.get_mut(&upload_id) {
        *cancelled = true;
        Ok(())
    } else {
        Err("上传任务不存在或已结束".to_string())
    }
}

// --- 通用交互指令 ---

#[tauri::command]
fn write_to_terminal(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    let mut sessions = state.local_sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("本地会话不存在".to_string())
    }
}

#[tauri::command]
async fn write_to_ssh_session(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(SshControlMsg::SendData(data.into_bytes())).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("SSH会话不存在".to_string())
    }
}

#[tauri::command]
fn resize_terminal(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.local_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_ssh_session(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(SshControlMsg::Resize(cols as u32, rows as u32)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_terminal(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.local_sessions.lock().unwrap().remove(&session_id);
    Ok(())
}

#[tauri::command]
async fn close_ssh_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.ssh_sessions.lock().await.remove(&session_id) {
        let _ = session.control_tx.send(SshControlMsg::Close);
    }
    Ok(())
}

#[tauri::command]
fn send_rdp_pointer(state: State<'_, AppState>, session_id: String, payload: RdpPointerEventPayload) -> Result<(), String> {
    let sessions = state.rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(RdpControlMsg::Pointer(payload)).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RDP 会话不存在".to_string())
    }
}

#[tauri::command]
fn send_rdp_key(state: State<'_, AppState>, session_id: String, payload: RdpKeyboardEventPayload) -> Result<(), String> {
    let sessions = state.rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(RdpControlMsg::Key(payload)).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RDP 会话不存在".to_string())
    }
}

#[tauri::command]
fn release_rdp_inputs(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let sessions = state.rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(RdpControlMsg::ReleaseAll).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RDP 会话不存在".to_string())
    }
}

#[tauri::command]
fn resize_rdp_session(state: State<'_, AppState>, session_id: String, width: u16, height: u16) -> Result<(), String> {
    let sessions = state.rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(RdpControlMsg::Resize(width, height)).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RDP 会话不存在".to_string())
    }
}

#[tauri::command]
fn close_rdp_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.rdp_sessions.lock().unwrap().remove(&session_id) {
        let _ = session.control_tx.send(RdpControlMsg::Close);
    }
    Ok(())
}

mod danger {
    use tokio_rustls::rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
    use tokio_rustls::rustls::{pki_types, DigitallySignedStruct, Error, SignatureScheme};

    #[derive(Debug)]
    pub(super) struct NoCertificateVerification;

    impl ServerCertVerifier for NoCertificateVerification {
        fn verify_server_cert(
            &self,
            _: &pki_types::CertificateDer<'_>,
            _: &[pki_types::CertificateDer<'_>],
            _: &pki_types::ServerName<'_>,
            _: &[u8],
            _: pki_types::UnixTime,
        ) -> Result<ServerCertVerified, Error> {
            Ok(ServerCertVerified::assertion())
        }

        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &pki_types::CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, Error> {
            Ok(HandshakeSignatureValid::assertion())
        }

        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &pki_types::CertificateDer<'_>,
            _: &DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, Error> {
            Ok(HandshakeSignatureValid::assertion())
        }

        fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
            vec![
                SignatureScheme::RSA_PKCS1_SHA1,
                SignatureScheme::ECDSA_SHA1_Legacy,
                SignatureScheme::RSA_PKCS1_SHA256,
                SignatureScheme::ECDSA_NISTP256_SHA256,
                SignatureScheme::RSA_PKCS1_SHA384,
                SignatureScheme::ECDSA_NISTP384_SHA384,
                SignatureScheme::RSA_PKCS1_SHA512,
                SignatureScheme::ECDSA_NISTP521_SHA512,
                SignatureScheme::RSA_PSS_SHA256,
                SignatureScheme::RSA_PSS_SHA384,
                SignatureScheme::RSA_PSS_SHA512,
                SignatureScheme::ED25519,
                SignatureScheme::ED448,
            ]
        }
    }
}

// --- 程序入口 ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init()) 
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            local_sessions: Arc::new(StdMutex::new(HashMap::new())),
            ssh_sessions: Arc::new(TokioMutex::new(HashMap::new())),
            rdp_sessions: Arc::new(StdMutex::new(HashMap::new())),
            sftp_upload_cancellations: Arc::new(StdMutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            get_available_shells,
            create_ssh_session,
            create_rdp_session,
            sftp_upload_file,
            sftp_upload_files,
            cancel_sftp_upload,
            write_to_terminal,
            write_to_ssh_session,
            send_rdp_pointer,
            send_rdp_key,
            release_rdp_inputs,
            resize_terminal,
            resize_ssh_session,
            resize_rdp_session,
            close_terminal,
            close_ssh_session,
            close_rdp_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

