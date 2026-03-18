use async_trait::async_trait;
use ironrdp::core::other_err;
use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use ironrdp::connector::credssp::KerberosConfig;
use ironrdp::connector::sspi::credssp::ClientState;
use ironrdp::connector::sspi::credssp::{self, CredSspClient};
use ironrdp::connector::sspi::generator::GeneratorState;
use ironrdp::connector::sspi::network_client::NetworkClient;
use ironrdp::connector::sspi::negotiate::ProtocolConfig;
use ironrdp::connector::{self, ConnectionResult, Credentials};
use ironrdp::connector::connection_activation::ConnectionActivationState;
use ironrdp::connector::State as ConnectorState;
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
use ironrdp::pdu::PduHint;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::{fast_path, ActiveStage, ActiveStageOutput};
use ironrdp::core::WriteBuf;
use portable_pty::MasterPty;
use russh::client;
use russh_keys::key;
use sspi::network_client::reqwest_network_client::ReqwestNetworkClient;
use sspi::{AuthIdentity as SspiAuthIdentity, Username};
use std::{
    collections::HashMap,
    io::Write,
    net::{IpAddr, TcpStream, ToSocketAddrs},
    sync::{mpsc as std_mpsc, Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::sync::{mpsc, Mutex as TokioMutex};
use tokio_rustls::rustls;
use vnc::{
    ClientKeyEvent as VncClientKeyEvent,
    ClientMouseEvent as VncClientMouseEvent,
    VncClient,
    VncEvent,
    X11Event,
};
use x509_cert::der::Decode as _;

mod mstsc;
mod native_rdp;
mod commands;
mod logging;

use native_rdp::NativeRdpSession;

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

enum VncControlMsg {
    Pointer(VncPointerEventPayload),
    Key(VncKeyboardEventPayload),
    Refresh(bool),
    Close,
}

const RDP_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const RDP_POLL_TIMEOUT: Duration = Duration::from_millis(16);
const RDP_FRAME_INTERVAL: Duration = Duration::from_millis(41);
const RDP_POINTER_MOVE_FRAME_INTERVAL: Duration = Duration::from_millis(22);
const RDP_WHEEL_FRAME_INTERVAL: Duration = Duration::from_millis(26);
const RDP_KEYBOARD_FRAME_INTERVAL: Duration = Duration::from_millis(30);
const RDP_CLICK_FRAME_INTERVAL: Duration = Duration::from_millis(32);
const RDP_FRAME_BATCH_WINDOW: Duration = Duration::from_millis(28);
const RDP_POINTER_MOVE_BATCH_WINDOW: Duration = Duration::from_millis(8);
const RDP_WHEEL_BATCH_WINDOW: Duration = Duration::from_millis(10);
const RDP_KEYBOARD_BATCH_WINDOW: Duration = Duration::from_millis(12);
const RDP_CLICK_BATCH_WINDOW: Duration = Duration::from_millis(12);
const RDP_FULL_JPEG_QUALITY: u8 = 58;
const RDP_REFINEMENT_JPEG_QUALITY: u8 = 66;
const RDP_POINTER_MOVE_JPEG_QUALITY: u8 = 28;
const RDP_WHEEL_JPEG_QUALITY: u8 = 32;
const RDP_KEYBOARD_JPEG_QUALITY: u8 = 42;
const RDP_CLICK_JPEG_QUALITY: u8 = 46;
const RDP_INTERACTION_WINDOW: Duration = Duration::from_millis(320);
const RDP_REFINEMENT_DELAY: Duration = Duration::from_millis(90);
const RDP_FIRST_FRAME_WAKE_DELAY: Duration = Duration::from_millis(700);
const RDP_FIRST_FRAME_WAKE_REPEAT: Duration = Duration::from_secs(2);
const VNC_REFRESH_INTERVAL: Duration = Duration::from_millis(33);

fn rdp_target_label(config: &RdpConnectConfig) -> String {
    format!("{}:{}", config.host, config.port)
}

fn log_rdp_info(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    let scope = format!("RDP/{session_id}/{target}/{stage}");
    logging::info(&scope, message);
}

fn log_rdp_error(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    let scope = format!("RDP/{session_id}/{target}/{stage}");
    logging::error(&scope, message);
}

fn vnc_target_label(config: &VncConnectConfig) -> String {
    format!("{}:{}", config.host, config.port)
}

fn log_vnc_info(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    let scope = format!("VNC/{session_id}/{target}/{stage}");
    logging::info(&scope, message);
}

fn log_vnc_error(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    let scope = format!("VNC/{session_id}/{target}/{stage}");
    logging::error(&scope, message);
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

struct VncSession {
    control_tx: mpsc::UnboundedSender<VncControlMsg>,
}

struct RdpConnectionContext {
    connection_result: ConnectionResult,
    share_id: u32,
}

struct PendingRdpFrame {
    dirty: bool,
    force: bool,
    updated_at: Option<Instant>,
}

struct RdpFrameEncoderState {
    rgb_buffer: Vec<u8>,
    jpeg_buffer: Vec<u8>,
    packet_buffer: Vec<u8>,
    last_interaction: Option<(RdpInteractionKind, Instant)>,
    needs_refinement: bool,
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

    fn frame_interval(self) -> Duration {
        match self {
            Self::PointerMove => RDP_POINTER_MOVE_FRAME_INTERVAL,
            Self::Wheel => RDP_WHEEL_FRAME_INTERVAL,
            Self::Keyboard => RDP_KEYBOARD_FRAME_INTERVAL,
            Self::Click => RDP_CLICK_FRAME_INTERVAL,
        }
    }

    fn batch_window(self) -> Duration {
        match self {
            Self::PointerMove => RDP_POINTER_MOVE_BATCH_WINDOW,
            Self::Wheel => RDP_WHEEL_BATCH_WINDOW,
            Self::Keyboard => RDP_KEYBOARD_BATCH_WINDOW,
            Self::Click => RDP_CLICK_BATCH_WINDOW,
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
            needs_refinement: false,
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

    fn frame_interval(&self) -> Duration {
        self.interaction_kind()
            .map(RdpInteractionKind::frame_interval)
            .unwrap_or(RDP_FRAME_INTERVAL)
    }

    fn batch_window(&self) -> Duration {
        self.interaction_kind()
            .map(RdpInteractionKind::batch_window)
            .unwrap_or(RDP_FRAME_BATCH_WINDOW)
    }

    fn jpeg_quality(&self, prioritize_speed: bool) -> u8 {
        if let Some(kind) = self.interaction_kind() {
            kind.jpeg_quality()
        } else if prioritize_speed {
            RDP_FULL_JPEG_QUALITY.saturating_sub(8)
        } else {
            RDP_FULL_JPEG_QUALITY
        }
    }

    fn prefer_raw_rgba(&self) -> bool {
        self.interaction_kind().is_some_and(RdpInteractionKind::prefer_raw_rgba)
    }

    fn encode_mode(&self, prioritize_speed: bool) -> RdpFrameEncodeMode {
        if self.prefer_raw_rgba() {
            RdpFrameEncodeMode::RawRgba
        } else {
            RdpFrameEncodeMode::Jpeg {
                quality: self.jpeg_quality(prioritize_speed),
            }
        }
    }

    fn mark_degraded_emit(&mut self) {
        self.needs_refinement = true;
    }

    fn clear_refinement(&mut self) {
        self.needs_refinement = false;
    }

    fn should_emit_refinement(&self) -> bool {
        self.needs_refinement
            && self
                .last_interaction
                .is_some_and(|(_, instant)| instant.elapsed() > RDP_INTERACTION_WINDOW + RDP_REFINEMENT_DELAY)
    }
}

impl PendingRdpFrame {
    fn new() -> Self {
        Self {
            dirty: false,
            force: false,
            updated_at: None,
        }
    }

    fn mark_dirty(&mut self, force: bool) {
        self.dirty = true;
        self.force |= force;
        self.updated_at = Some(Instant::now());
    }

    fn clear(&mut self) {
        self.dirty = false;
        self.force = false;
        self.updated_at = None;
    }
}

#[derive(Clone, Copy, Debug)]
struct LocalCredsspTsRequestHint;

const LOCAL_CREDSSP_TS_REQUEST_HINT: LocalCredsspTsRequestHint = LocalCredsspTsRequestHint;

impl PduHint for LocalCredsspTsRequestHint {
    fn find_size(&self, bytes: &[u8]) -> ironrdp::core::DecodeResult<Option<(bool, usize)>> {
        match credssp::TsRequest::read_length(bytes) {
            Ok(length) => Ok(Some((true, length))),
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => Ok(None),
            Err(error) => Err(other_err!("LocalCredsspTsRequestHint", source: error)),
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct LocalCredsspEarlyUserAuthResultHint;

const LOCAL_CREDSSP_EARLY_USER_AUTH_RESULT_HINT: LocalCredsspEarlyUserAuthResultHint = LocalCredsspEarlyUserAuthResultHint;

impl PduHint for LocalCredsspEarlyUserAuthResultHint {
    fn find_size(&self, _: &[u8]) -> ironrdp::core::DecodeResult<Option<(bool, usize)>> {
        Ok(Some((true, credssp::EARLY_USER_AUTH_RESULT_PDU_SIZE)))
    }
}

type LocalCredsspProcessGenerator<'a> =
    sspi::generator::Generator<'a, sspi::generator::NetworkRequest, sspi::Result<Vec<u8>>, sspi::Result<ClientState>>;

#[derive(Debug, PartialEq)]
enum LocalCredsspState {
    Ongoing,
    EarlyUserAuthResult,
    Finished,
}

#[derive(Debug)]
struct LocalCredsspSequence {
    client: CredSspClient,
    state: LocalCredsspState,
    selected_protocol: ironrdp::pdu::nego::SecurityProtocol,
}

impl LocalCredsspSequence {
    fn next_pdu_hint(&self) -> Option<&dyn PduHint> {
        match self.state {
            LocalCredsspState::Ongoing => Some(&LOCAL_CREDSSP_TS_REQUEST_HINT),
            LocalCredsspState::EarlyUserAuthResult => Some(&LOCAL_CREDSSP_EARLY_USER_AUTH_RESULT_HINT),
            LocalCredsspState::Finished => None,
        }
    }

    fn init(
        credentials: Credentials,
        domain: Option<&str>,
        protocol: ironrdp::pdu::nego::SecurityProtocol,
        server_name: connector::ServerName,
        server_public_key: Vec<u8>,
    ) -> Result<(Self, credssp::TsRequest), String> {
        let credentials: sspi::Credentials = match credentials {
            Credentials::UsernamePassword { username, password } => {
                let username = Username::new(&username, domain).map_err(|e| format!("invalid username: {e}"))?;
                SspiAuthIdentity {
                    username,
                    password: password.into(),
                }
                .into()
            }
            Credentials::SmartCard { .. } => {
                return Err("smart card authentication is not supported by the local CredSSP path".to_string())
            }
        };

        let server_name = server_name.into_inner();
        let service_principal_name = format!("TERMSRV/{server_name}");
        let force_ntlm_only = server_name.parse::<IpAddr>().is_ok();
        let package_list = force_ntlm_only.then(|| "!kerberos,!pku2u".to_string());
        let protocol_config: Box<dyn ProtocolConfig> = Box::<sspi::ntlm::NtlmConfig>::default();

        let client = CredSspClient::new(
            server_public_key,
            credentials,
            credssp::CredSspMode::WithCredentials,
            credssp::ClientMode::Negotiate(sspi::NegotiateConfig {
                protocol_config,
                package_list,
                client_computer_name: server_name.clone(),
            }),
            service_principal_name,
        )
        .map_err(|e| format!("CredSSP init failed: {e}"))?;

        Ok((
            Self {
                client,
                state: LocalCredsspState::Ongoing,
                selected_protocol: protocol,
            },
            credssp::TsRequest::default(),
        ))
    }

    fn decode_server_message(&mut self, input: &[u8]) -> Result<Option<credssp::TsRequest>, String> {
        match self.state {
            LocalCredsspState::Ongoing => credssp::TsRequest::from_buffer(input)
                .map(Some)
                .map_err(|e| format!("CredSSP decode failed: {e}")),
            LocalCredsspState::EarlyUserAuthResult => {
                let result = credssp::EarlyUserAuthResult::from_buffer(input)
                    .map_err(|e| format!("CredSSP early auth decode failed: {e}"))?;

                match result {
                    credssp::EarlyUserAuthResult::Success => {
                        self.state = LocalCredsspState::Finished;
                        Ok(None)
                    }
                    credssp::EarlyUserAuthResult::AccessDenied => Err("CredSSP access denied".to_string()),
                }
            }
            LocalCredsspState::Finished => Err("CredSSP sequence is already finished".to_string()),
        }
    }

    fn process_ts_request(&mut self, request: credssp::TsRequest) -> LocalCredsspProcessGenerator<'_> {
        self.client.process(request)
    }

    fn handle_process_result(&mut self, result: ClientState, output: &mut WriteBuf) -> Result<connector::Written, String> {
        let (size, next_state) = match self.state {
            LocalCredsspState::Ongoing => {
                let (ts_request_from_client, next_state) = match result {
                    ClientState::ReplyNeeded(ts_request) => (ts_request, LocalCredsspState::Ongoing),
                    ClientState::FinalMessage(ts_request) => (
                        ts_request,
                        if self.selected_protocol.contains(ironrdp::pdu::nego::SecurityProtocol::HYBRID_EX) {
                            LocalCredsspState::EarlyUserAuthResult
                        } else {
                            LocalCredsspState::Finished
                        },
                    ),
                };

                let length = usize::from(ts_request_from_client.buffer_len());
                let unfilled_buffer = output.unfilled_to(length);
                ts_request_from_client
                    .encode_ts_request(unfilled_buffer)
                    .map_err(|e| format!("CredSSP encode failed: {e}"))?;
                output.advance(length);

                (connector::Written::from_size(length).map_err(|e| e.to_string())?, next_state)
            }
            LocalCredsspState::EarlyUserAuthResult => (connector::Written::Nothing, LocalCredsspState::Finished),
            LocalCredsspState::Finished => return Err("CredSSP sequence is already done".to_string()),
        };

        self.state = next_state;
        Ok(size)
    }
}

/// 全局应用状态，存储所有活动会话
struct AppState {
    local_sessions: Arc<StdMutex<HashMap<String, LocalTerminalSession>>>,
    ssh_sessions: Arc<TokioMutex<HashMap<String, SshTerminalSession>>>,
    rdp_sessions: Arc<StdMutex<HashMap<String, RdpSession>>>,
    vnc_sessions: Arc<StdMutex<HashMap<String, VncSession>>>,
    native_rdp_sessions: Arc<StdMutex<HashMap<String, NativeRdpSession>>>,
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
        logging::info("SSH/handler", "收到服务器公钥响应");
        Ok(true)
    }

    async fn disconnected(&mut self, reason: client::DisconnectReason<Self::Error>) -> Result<(), Self::Error> {
        logging::warn("SSH/handler", format!("连接已断开: {reason:?}"));
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
pub struct VncConnectConfig {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub shared: Option<bool>,
    pub allow_jpeg: Option<bool>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale_factor: f64,
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeRdpStateEventPayload {
    pub state: String,
    pub detail: Option<String>,
    pub rect: Option<NativeHostRect>,
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeRdpTraceEventPayload {
    pub timestamp_ms: u64,
    pub level: String,
    pub stage: String,
    pub message: String,
    pub extra: Option<String>,
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

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VncPointerEventPayload {
    pub x: u16,
    pub y: u16,
    pub button_mask: u8,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VncKeyboardEventPayload {
    pub key_sym: u32,
    pub down: bool,
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VncCursorEventPayload {
    pub hotspot_x: u16,
    pub hotspot_y: u16,
    pub width: u16,
    pub height: u16,
    pub rgba_bytes: Vec<u8>,
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

fn build_rdp_full_address(config: &RdpConnectConfig) -> String {
    if config.port == 3389 {
        config.host.clone()
    } else {
        format!("{}:{}", config.host, config.port)
    }
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
        session_id,
        target,
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
    generator: &mut LocalCredsspProcessGenerator<'_>,
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
    _kerberos_config: Option<KerberosConfig>,
) -> Result<(), String> {
    let selected_protocol = match connector.state {
        connector::ClientConnectorState::Credssp { selected_protocol, .. } => selected_protocol,
        _ => return Err("invalid connector state for CredSSP sequence".to_string()),
    };

    let (mut sequence, mut ts_request) = LocalCredsspSequence::init(
        connector.config.credentials.clone(),
        connector.config.domain.as_deref(),
        selected_protocol,
        server_name,
        server_public_key,
    )?;

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
    session_id: &str,
    target: &str,
    mut connector: connector::ClientConnector,
    framed: &mut UpgradedFramed,
    network_client: &mut impl NetworkClient,
    server_name: connector::ServerName,
    server_public_key: Vec<u8>,
    kerberos_config: Option<KerberosConfig>,
) -> Result<RdpConnectionContext, String> {
    let mut buf = WriteBuf::new();
    let mut share_id: Option<u32> = None;
    let finalize_started_at = Instant::now();
    let mut last_state_name = connector.state.name();

    log_rdp_info(
        session_id,
        target,
        "auth",
        format!("entered finalize flow at state {last_state_name}"),
    );

    if connector.should_perform_credssp() {
        let credssp_started_at = Instant::now();
        perform_credssp_step(
            &mut connector,
            framed,
            network_client,
            &mut buf,
            server_name,
            server_public_key,
            kerberos_config,
        )?;
        log_rdp_info(
            session_id,
            target,
            "auth",
            format!(
                "CredSSP finished in {} ms, next state {}",
                credssp_started_at.elapsed().as_millis(),
                connector.state.name()
            ),
        );
        last_state_name = connector.state.name();
    }

    loop {
        buf.clear();

        let written = if let Some(next_pdu_hint) = connector.next_pdu_hint() {
            let read_started_at = Instant::now();
            let pdu = framed
                .read_by_hint(next_pdu_hint)
                .map_err(|e| format!("read frame by hint failed: {e}"))?;
            let read_elapsed = read_started_at.elapsed();

            if read_elapsed >= Duration::from_millis(500) {
                log_rdp_info(
                    session_id,
                    target,
                    "auth",
                    format!(
                        "waited {} ms for server PDU while in state {}",
                        read_elapsed.as_millis(),
                        connector.state.name()
                    ),
                );
            }

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

        let state_name = connector.state.name();
        if state_name != last_state_name {
            log_rdp_info(
                session_id,
                target,
                "auth",
                format!(
                    "state transition: {} -> {} at {} ms",
                    last_state_name,
                    state_name,
                    finalize_started_at.elapsed().as_millis()
                ),
            );
            last_state_name = state_name;
        }

        if let connector::ClientConnectorState::Connected { result } = connector.state {
            log_rdp_info(
                session_id,
                target,
                "auth",
                format!("finalize flow completed in {} ms", finalize_started_at.elapsed().as_millis()),
            );
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

fn rect_width(rect: &InclusiveRectangle) -> u16 {
    rect.right.saturating_sub(rect.left).saturating_add(1)
}

fn rect_height(rect: &InclusiveRectangle) -> u16 {
    rect.bottom.saturating_sub(rect.top).saturating_add(1)
}

fn emit_rdp_frame(
    frame_channel: &Channel<Response>,
    image: &DecodedImage,
    encoder_state: &mut RdpFrameEncoderState,
    encode_mode: RdpFrameEncodeMode,
) -> Result<(), String> {
    let full_rect = InclusiveRectangle {
        left: 0,
        top: 0,
        right: image.width().saturating_sub(1),
        bottom: image.height().saturating_sub(1),
    };

    let encode_rect = full_rect;
    encoder_state.packet_buffer.clear();
    encoder_state.packet_buffer.extend_from_slice(&image.width().to_le_bytes());
    encoder_state.packet_buffer.extend_from_slice(&image.height().to_le_bytes());
    encoder_state.packet_buffer.extend_from_slice(&encode_rect.left.to_le_bytes());
    encoder_state.packet_buffer.extend_from_slice(&encode_rect.top.to_le_bytes());
    encoder_state.packet_buffer.extend_from_slice(&rect_width(&encode_rect).to_le_bytes());
    encoder_state.packet_buffer.extend_from_slice(&rect_height(&encode_rect).to_le_bytes());

    match encode_mode {
        RdpFrameEncodeMode::RawRgba => {
        encoder_state.packet_buffer.push(0x01 | 0x02);
        encoder_state.packet_buffer.extend_from_slice(image.data());
        }
        RdpFrameEncodeMode::Jpeg { quality } => {
            let rgba = image.data();
            let pixel_count = usize::from(image.width()) * usize::from(image.height());
            let rgb_len = pixel_count * 3;
            if encoder_state.rgb_buffer.len() != rgb_len {
                encoder_state.rgb_buffer.resize(rgb_len, 0);
            }

            for (rgba_pixel, rgb_pixel) in rgba.chunks_exact(4).zip(encoder_state.rgb_buffer.chunks_exact_mut(3)) {
                rgb_pixel[0] = rgba_pixel[0];
                rgb_pixel[1] = rgba_pixel[1];
                rgb_pixel[2] = rgba_pixel[2];
            }

            encoder_state.jpeg_buffer.clear();
            let mut encoder = JpegEncoder::new_with_quality(&mut encoder_state.jpeg_buffer, quality);
            encoder
                .encode(
                    &encoder_state.rgb_buffer,
                    u32::from(rect_width(&encode_rect)),
                    u32::from(rect_height(&encode_rect)),
                    ExtendedColorType::Rgb8,
                )
                .map_err(|e| format!("encode JPEG failed: {e}"))?;

            encoder_state.packet_buffer.push(0x01);
            encoder_state.packet_buffer.extend_from_slice(&encoder_state.jpeg_buffer);
        }
    }

    frame_channel
        .send(Response::new(std::mem::take(&mut encoder_state.packet_buffer)))
        .map_err(|e| format!("send RDP frame via channel failed: {e}"))
}

fn flush_pending_rdp_frame(
    image: &DecodedImage,
    frame_channel: &Channel<Response>,
    encoder_state: &mut RdpFrameEncoderState,
    pending_frame: &mut PendingRdpFrame,
    last_frame_emit_at: &mut Instant,
    has_emitted_frame: &mut bool,
) -> Result<(), String> {
    if !pending_frame.dirty {
        return Ok(());
    }

    let updated_at = match pending_frame.updated_at {
        Some(updated_at) => updated_at,
        None => return Ok(()),
    };

    let now = Instant::now();
    let frame_interval = encoder_state.frame_interval();
    let batch_window = encoder_state.batch_window();
    let should_emit = pending_frame.force
        || (last_frame_emit_at.elapsed() >= frame_interval && now.duration_since(updated_at) >= batch_window);

    if !should_emit {
        return Ok(());
    }

    let prioritize_speed = !*has_emitted_frame || pending_frame.force;
    let encode_mode = encoder_state.encode_mode(prioritize_speed);
    emit_rdp_frame(frame_channel, image, encoder_state, encode_mode)?;
    *last_frame_emit_at = Instant::now();
    *has_emitted_frame = true;
    match encode_mode {
        RdpFrameEncodeMode::RawRgba => encoder_state.mark_degraded_emit(),
        RdpFrameEncodeMode::Jpeg { quality } if quality < RDP_FULL_JPEG_QUALITY => encoder_state.mark_degraded_emit(),
        RdpFrameEncodeMode::Jpeg { .. } => encoder_state.clear_refinement(),
    }
    pending_frame.clear();

    Ok(())
}

fn flush_rdp_refinement_frame(
    image: &DecodedImage,
    frame_channel: &Channel<Response>,
    encoder_state: &mut RdpFrameEncoderState,
    last_frame_emit_at: &mut Instant,
    has_emitted_frame: &mut bool,
) -> Result<(), String> {
    if !encoder_state.should_emit_refinement() || last_frame_emit_at.elapsed() < RDP_FRAME_INTERVAL {
        return Ok(());
    }

    emit_rdp_frame(
        frame_channel,
        image,
        encoder_state,
        RdpFrameEncodeMode::Jpeg {
            quality: RDP_REFINEMENT_JPEG_QUALITY,
        },
    )?;

    *last_frame_emit_at = Instant::now();
    *has_emitted_frame = true;
    encoder_state.clear_refinement();

    Ok(())
}

fn handle_rdp_outputs(
    framed: &mut UpgradedFramed,
    active_stage: &mut ActiveStage,
    image: &mut DecodedImage,
    frame_channel: &Channel<Response>,
    encoder_state: &mut RdpFrameEncoderState,
    outputs: Vec<ActiveStageOutput>,
    pending_frame: &mut PendingRdpFrame,
    last_frame_emit_at: &mut Instant,
    has_emitted_frame: &mut bool,
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
                        *has_emitted_frame = false;
                        break;
                    }
                }
            }
        }
    }

    if should_emit_frame {
        pending_frame.mark_dirty(force_emit_frame);
    }

    flush_pending_rdp_frame(
        image,
        frame_channel,
        encoder_state,
        pending_frame,
        last_frame_emit_at,
        has_emitted_frame,
    )?;

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

fn handle_rdp_control(
    control: RdpControlMsg,
    framed: &mut UpgradedFramed,
    active_stage: &mut ActiveStage,
    image: &mut DecodedImage,
    frame_channel: &Channel<Response>,
    input_db: &mut RdpInputDatabase,
    encoder_state: &mut RdpFrameEncoderState,
    pending_frame: &mut PendingRdpFrame,
    last_frame_emit_at: &mut Instant,
    has_emitted_frame: &mut bool,
) -> Result<bool, String> {
    match control {
        RdpControlMsg::Pointer(payload) => {
            match payload.kind.as_str() {
                "move" => encoder_state.mark_interaction(RdpInteractionKind::PointerMove),
                "wheel" => encoder_state.mark_interaction(RdpInteractionKind::Wheel),
                "down" | "up" => encoder_state.mark_interaction(RdpInteractionKind::Click),
                _ => {}
            }
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

            handle_rdp_outputs(
                framed,
                active_stage,
                image,
                frame_channel,
                encoder_state,
                outputs,
                pending_frame,
                last_frame_emit_at,
                has_emitted_frame,
            )
        }
        RdpControlMsg::Key(payload) => {
            encoder_state.mark_interaction(RdpInteractionKind::Keyboard);
            let operation = if payload.down {
                Operation::KeyPressed(Scancode::from_u16(payload.scancode))
            } else {
                Operation::KeyReleased(Scancode::from_u16(payload.scancode))
            };

            let outputs = active_stage
                .process_fastpath_input(image, &input_db.apply([operation]))
                .map_err(|e| format!("process keyboard input failed: {e}"))?;

            handle_rdp_outputs(
                framed,
                active_stage,
                image,
                frame_channel,
                encoder_state,
                outputs,
                pending_frame,
                last_frame_emit_at,
                has_emitted_frame,
            )
        }
        RdpControlMsg::ReleaseAll => {
            encoder_state.mark_interaction(RdpInteractionKind::Keyboard);
            let outputs = active_stage
                .process_fastpath_input(image, &input_db.release_all())
                .map_err(|e| format!("release keyboard state failed: {e}"))?;

            handle_rdp_outputs(
                framed,
                active_stage,
                image,
                frame_channel,
                encoder_state,
                outputs,
                pending_frame,
                last_frame_emit_at,
                has_emitted_frame,
            )
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
            let _ = handle_rdp_outputs(
                framed,
                active_stage,
                image,
                frame_channel,
                encoder_state,
                outputs,
                pending_frame,
                last_frame_emit_at,
                has_emitted_frame,
            );
            Ok(false)
        }
    }
}

fn run_rdp_session<R: Runtime>(
    _app: AppHandle<R>,
    session_id: String,
    target: String,
    connection_context: RdpConnectionContext,
    mut framed: UpgradedFramed,
    frame_channel: Channel<Response>,
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
    let mut encoder_state = RdpFrameEncoderState::new();
    let mut received_server_frame = false;
    let mut pending_frame = PendingRdpFrame::new();
    let mut last_frame_emit_at = Instant::now() - RDP_FRAME_INTERVAL;
    let mut has_emitted_frame = false;
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
                control,
                &mut framed,
                &mut active_stage,
                &mut image,
                &frame_channel,
                &mut input_db,
                &mut encoder_state,
                &mut pending_frame,
                &mut last_frame_emit_at,
                &mut has_emitted_frame,
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

        flush_pending_rdp_frame(
            &image,
            &frame_channel,
            &mut encoder_state,
            &mut pending_frame,
            &mut last_frame_emit_at,
            &mut has_emitted_frame,
        )?;
        flush_rdp_refinement_frame(
            &image,
            &frame_channel,
            &mut encoder_state,
            &mut last_frame_emit_at,
            &mut has_emitted_frame,
        )?;

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
                    &mut framed,
                    &mut active_stage,
                    &mut image,
                    &frame_channel,
                    &mut encoder_state,
                    outputs,
                    &mut pending_frame,
                    &mut last_frame_emit_at,
                    &mut has_emitted_frame,
                )? {
                    return Ok(());
                }
            }
            Err(error) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("read RDP frame failed: {error}")),
        }
    }
}

fn emit_vnc_frame(
    frame_channel: &Channel<Response>,
    desktop_width: u16,
    desktop_height: u16,
    region_left: u16,
    region_top: u16,
    region_width: u16,
    region_height: u16,
    encoding_rgba: bool,
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

    packet.push(flags);
    packet.extend_from_slice(&image_bytes);

    frame_channel
        .send(Response::new(packet))
        .map_err(|e| format!("send VNC frame via channel failed: {e}"))
}

async fn handle_vnc_control(control: VncControlMsg, client: &VncClient) -> Result<bool, String> {
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
            Ok(true)
        }
        VncControlMsg::Key(payload) => {
            client
                .input(X11Event::KeyEvent(VncClientKeyEvent {
                    keycode: payload.key_sym,
                    down: payload.down,
                }))
                .await
                .map_err(|e| format!("send VNC keyboard input failed: {e}"))?;
            Ok(true)
        }
        VncControlMsg::Refresh(full) => {
            client
                .input(if full { X11Event::FullRefresh } else { X11Event::Refresh })
                .await
                .map_err(|e| format!("request VNC refresh failed: {e}"))?;
            Ok(true)
        }
        VncControlMsg::Close => {
            let _ = client.close().await;
            Ok(false)
        }
    }
}

async fn run_vnc_session<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    target: String,
    client: VncClient,
    frame_channel: Channel<Response>,
    mut control_rx: mpsc::UnboundedReceiver<VncControlMsg>,
) -> Result<(), String> {
    let mut desktop_width = 0u16;
    let mut desktop_height = 0u16;
    let mut cursor_mode_synced = false;
    let mut refresh_interval = tokio::time::interval(VNC_REFRESH_INTERVAL);
    refresh_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    client
        .input(X11Event::FullRefresh)
        .await
        .map_err(|e| format!("request initial VNC refresh failed: {e}"))?;

    loop {
        tokio::select! {
            _ = refresh_interval.tick() => {
                let _ = client.input(X11Event::Refresh).await;
            }
            maybe_control = control_rx.recv() => {
                let Some(control) = maybe_control else {
                    let _ = client.close().await;
                    break;
                };

                if !handle_vnc_control(control, &client).await? {
                    break;
                }
            }
            event = client.recv_event() => {
                match event.map_err(|e| format!("receive VNC event failed: {e}"))? {
                    VncEvent::SetResolution(screen) => {
                        desktop_width = screen.width;
                        desktop_height = screen.height;
                        log_vnc_info(&session_id, &target, "resolution", format!("desktop resized to {}x{}", screen.width, screen.height));
                        let _ = client.input(X11Event::FullRefresh).await;
                    }
                    VncEvent::RawImage(rect, data) => {
                        if desktop_width == 0 {
                            desktop_width = rect.x.saturating_add(rect.width);
                        }
                        if desktop_height == 0 {
                            desktop_height = rect.y.saturating_add(rect.height);
                        }

                        emit_vnc_frame(
                            &frame_channel,
                            desktop_width,
                            desktop_height,
                            rect.x,
                            rect.y,
                            rect.width,
                            rect.height,
                            true,
                            data,
                        )?;
                    }
                    VncEvent::JpegImage(rect, data) => {
                        if desktop_width == 0 {
                            desktop_width = rect.x.saturating_add(rect.width);
                        }
                        if desktop_height == 0 {
                            desktop_height = rect.y.saturating_add(rect.height);
                        }

                        emit_vnc_frame(
                            &frame_channel,
                            desktop_width,
                            desktop_height,
                            rect.x,
                            rect.y,
                            rect.width,
                            rect.height,
                            false,
                            data,
                        )?;
                    }
                    VncEvent::Copy(_, _) => {
                        let _ = client.input(X11Event::FullRefresh).await;
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
                            let _ = client.input(X11Event::FullRefresh).await;
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

// --- Tauri 指令实现已拆分至 commands/mstsc/native_rdp ---

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
            vnc_sessions: Arc::new(StdMutex::new(HashMap::new())),
            native_rdp_sessions: Arc::new(StdMutex::new(HashMap::new())),
            sftp_upload_cancellations: Arc::new(StdMutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_terminal,
            commands::get_available_shells,
            commands::create_ssh_session,
            commands::create_rdp_session,
            commands::create_vnc_session,
            native_rdp::create_native_rdp_session,
            native_rdp::mount_native_rdp_session,
            native_rdp::set_native_rdp_session_visible,
            native_rdp::focus_native_rdp_session,
            native_rdp::close_native_rdp_session,
            mstsc::launch_mstsc_rdp,
            commands::sftp_upload_file,
            commands::sftp_upload_files,
            commands::cancel_sftp_upload,
            commands::write_to_terminal,
            commands::write_to_ssh_session,
            commands::send_rdp_pointer,
            commands::send_rdp_key,
            commands::send_vnc_pointer,
            commands::send_vnc_key,
            commands::request_vnc_refresh,
            commands::release_rdp_inputs,
            commands::resize_terminal,
            commands::resize_ssh_session,
            commands::resize_rdp_session,
            commands::close_terminal,
            commands::close_ssh_session,
            commands::close_rdp_session,
            commands::close_vnc_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

