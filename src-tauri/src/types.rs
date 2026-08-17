//! 类型定义模块
//! 包含所有 DTO 和内部数据结构定义

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{mpsc as std_mpsc, Arc, Mutex as StdMutex};
use tokio::sync::{mpsc, watch};

// 前向声明，避免循环依赖
// NativeRdpSession 在 native_rdp 模块中定义，这里只存储在 AppState 中

// ==================== SSH 相关类型 ====================

/// SSH 连接配置
#[derive(Debug, Clone, Deserialize)]
pub struct SshConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub keep_alive: Option<bool>,
    pub keep_alive_interval: Option<u64>,
    pub ready_timeout: Option<u64>,
    #[serde(default)]
    pub auto_update_changed_host_keys: bool,
    pub initial_cols: Option<u32>,
    pub initial_rows: Option<u32>,
}

/// SSH 控制消息
pub enum SshControlMsg {
    SendData(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// SSH 终端会话
pub struct SshTerminalSession {
    pub control_tx: mpsc::UnboundedSender<SshControlMsg>,
    pub handle: russh::client::Handle<crate::protocol::ssh_auth::SshClientHandler>,
}

// ==================== RDP 相关类型 ====================

/// RDP 连接配置
#[derive(Debug, Clone, Deserialize)]
pub struct RdpConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub domain: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// RDP 指针事件载荷
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpPointerEventPayload {
    pub kind: String,
    pub x: u16,
    pub y: u16,
    pub button: Option<u8>,
    pub delta_x: Option<i16>,
    pub delta_y: Option<i16>,
}

/// RDP 键盘事件载荷
#[derive(Debug, Clone, Deserialize)]
pub struct RdpKeyboardEventPayload {
    pub scancode: u16,
    pub down: bool,
}

/// 图形远端会话的统一质量预算
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionQualityPolicyPayload {
    pub mode: String,
    pub priority: u8,
    pub target_frame_rate: u16,
    pub jpeg_quality_cap: u8,
    pub suspend_visuals: bool,
}

/// RDP 控制消息
pub enum RdpControlMsg {
    Pointer(RdpPointerEventPayload),
    Key(RdpKeyboardEventPayload),
    Refresh,
    ReleaseAll,
    SetQuality(ConnectionQualityPolicyPayload),
    Close,
}

/// RDP 会话
pub struct RdpSession {
    pub control_tx: std_mpsc::Sender<RdpControlMsg>,
}

// ==================== VNC 相关类型 ====================

/// VNC 连接配置
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncConnectConfig {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub shared: Option<bool>,
    pub view_only: Option<bool>,
    pub allow_jpeg: Option<bool>,
    pub quality: Option<u8>,
}

/// VNC 指针事件载荷
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncPointerEventPayload {
    pub x: u16,
    pub y: u16,
    pub button_mask: u8,
}

/// VNC 键盘事件载荷
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncKeyboardEventPayload {
    pub key_sym: u32,
    pub down: bool,
}

/// VNC 组合键载荷
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncKeySequencePayload {
    pub key_syms: Vec<u32>,
}

/// VNC 剪贴板粘贴事件载荷
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncClipboardPastePayload {
    pub text: String,
    pub key_sym: u32,
    pub modifier_key_syms: Vec<u32>,
}

/// VNC 文本按键输入载荷
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncTextInputPayload {
    pub text: String,
    pub modifier_key_syms: Vec<u32>,
}

/// VNC 控制消息
pub enum VncControlMsg {
    Pointer(VncPointerEventPayload),
    Key(VncKeyboardEventPayload),
    KeySequence(VncKeySequencePayload),
    PasteClipboard(VncClipboardPastePayload),
    TypeText(VncTextInputPayload),
    Refresh { full: bool },
    Resize(u16, u16),
    SetQuality(ConnectionQualityPolicyPayload),
    Close,
}

/// VNC 控制结果
pub enum VncControlOutcome {
    Continue(Option<bool>),
    Close,
}

/// VNC 会话
pub struct VncSession {
    pub control_tx: mpsc::Sender<VncControlMsg>,
}

// ==================== 本地终端类型 ====================

/// 本地终端会话
pub struct LocalTerminalSession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub integration_script_path: Option<std::path::PathBuf>,
}

impl Drop for LocalTerminalSession {
    fn drop(&mut self) {
        if let Some(path) = &self.integration_script_path {
            let _ = std::fs::remove_file(path);
        }
    }
}

// ==================== Telnet 相关类型 ====================

/// Telnet 连接配置
#[derive(Debug, Clone, Deserialize)]
pub struct TelnetConnectConfig {
    pub host: String,
    pub port: u16,
    pub nickname: Option<String>,
}

/// Telnet 终端会话
pub struct TelnetSession {
    pub control_tx: mpsc::UnboundedSender<String>,
    pub close_tx: watch::Sender<bool>,
}

// ==================== SFTP 相关类型 ====================

/// SFTP 上传进度
#[derive(Debug, Clone, Serialize)]
pub struct SftpUploadProgress {
    pub file_index: usize,
    pub file_name: String,
    pub local_path: String,
    pub file_size: u64,
    pub file_sent: u64,
    pub overall_total: u64,
    pub overall_sent: u64,
}

/// SFTP 文件项
#[derive(Debug, Clone, Serialize)]
pub struct SftpFileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

/// SFTP 上传项
#[derive(Debug, Clone, Deserialize)]
pub struct SftpUploadItem {
    pub local_path: String,
    pub remote_path: String,
    pub is_dir: Option<bool>,
}

/// SFTP 上传取消守卫
pub struct SftpUploadCancelGuard {
    pub upload_id: String,
    pub cancellations: Arc<StdMutex<HashMap<String, bool>>>,
}

impl Drop for SftpUploadCancelGuard {
    fn drop(&mut self) {
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(&self.upload_id);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpDownloadProgress {
    pub file_name: String,
    pub remote_path: String,
    pub local_path: String,
    pub file_size: u64,
    pub file_received: u64,
    pub overall_total: u64,
    pub overall_received: u64,
}

pub struct SftpDownloadCancelGuard {
    pub download_id: String,
    pub cancellations: Arc<StdMutex<HashMap<String, bool>>>,
}

impl Drop for SftpDownloadCancelGuard {
    fn drop(&mut self) {
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(&self.download_id);
        }
    }
}

// ==================== Shell 相关类型 ====================

/// Shell 信息
#[derive(Debug, Clone, Serialize)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub icon_type: String, // 'cmd', 'powershell', 'bash', 'ssh'
}

// ==================== 原生 RDP 相关类型 ====================

/// 原生 RDP 窗口矩形
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub scale_factor: f64,
    pub generation: Option<u64>,
}

/// 原生 RDP 状态事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRdpStateEventPayload {
    pub state: String,
    pub detail: Option<String>,
    pub rect: Option<NativeHostRect>,
}

/// 原生 RDP 追踪事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRdpTraceEventPayload {
    pub timestamp_ms: u64,
    pub level: String,
    pub stage: String,
    pub message: String,
    pub extra: Option<String>,
}

/// VNC 光标事件载荷
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncCursorEventPayload {
    pub hotspot_x: u16,
    pub hotspot_y: u16,
    pub width: u16,
    pub height: u16,
    pub rgba_bytes: Vec<u8>,
}

// ==================== 应用状态 ====================

// 应用全局状态定义在 lib.rs 中，因为需要引用 protocol::NativeRdpSession
// 其他模块通过 crate::AppState 引用

// 注意：RDP 相关常量定义在 lib.rs 中，因为它们是内部实现细节
