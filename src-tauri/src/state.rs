//! 应用状态模块
//! 包含全局状态 AppState 的定义

use crate::protocol::NativeRdpSession;
use crate::types::{
    LocalTerminalSession, RdpSession, SshTerminalSession, TelnetSession, VncSession,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex as TokioMutex;

/// 应用全局状态
///
/// 存储所有活跃会话的管理句柄
#[derive(Default)]
pub struct AppState {
    pub local_sessions: Arc<StdMutex<HashMap<String, LocalTerminalSession>>>,
    pub ssh_sessions: Arc<TokioMutex<HashMap<String, SshTerminalSession>>>,
    pub rdp_sessions: Arc<StdMutex<HashMap<String, RdpSession>>>,
    pub vnc_sessions: Arc<StdMutex<HashMap<String, VncSession>>>,
    pub native_rdp_sessions: Arc<StdMutex<HashMap<String, NativeRdpSession>>>,
    pub telnet_sessions: Arc<TokioMutex<HashMap<String, TelnetSession>>>,
    pub sftp_upload_cancellations: Arc<StdMutex<HashMap<String, bool>>>,
    pub sftp_download_cancellations: Arc<StdMutex<HashMap<String, bool>>>,
}

impl AppState {
    /// 创建新的应用状态实例
    pub fn new() -> Self {
        Self::default()
    }
}
