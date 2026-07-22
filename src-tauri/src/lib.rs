//! Lazy Term 核心库
//! 包含应用状态定义和 Tauri 入口
//!
//! # VNC 实现说明
//!
//! VNC 协议基于 LibVNCClient C 库实现，通过 FFI 与 Rust 集成。
//! 需要系统安装 libvncclient 开发库才能构建。

mod error;
mod logging;
mod protocol;
mod state;
mod types;
mod utils;

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex as TokioMutex;

pub use error::into_tauri_result;
pub use error::AppError;
pub use error::AppResult;
pub use state::AppState;
pub use utils::{
    log_rdp_error, log_rdp_info, log_vnc_error, log_vnc_info, map_sftp_error, rdp_target_label,
    vnc_target_label,
};

// 从 types 模块导入并重新导出纯数据类型
pub use crate::types::{
    LocalTerminalSession, NativeHostRect, NativeRdpStateEventPayload, NativeRdpTraceEventPayload,
    RdpConnectConfig, RdpControlMsg, RdpKeyboardEventPayload, RdpPointerEventPayload, RdpSession,
    SftpDownloadCancelGuard, SftpDownloadProgress, SftpFileEntry, SftpUploadCancelGuard,
    SftpUploadItem, SftpUploadProgress, ShellInfo, SshConnectConfig, SshControlMsg,
    SshTerminalSession, TelnetConnectConfig, TelnetSession, VncClipboardPastePayload,
    VncConnectConfig, VncControlMsg, VncControlOutcome, VncCursorEventPayload,
    VncKeyboardEventPayload, VncPointerEventPayload, VncSession, VncTextInputPayload,
};

// --- 程序入口 ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(protocol::UpdateDownloadState::default())
        .manage(AppState {
            local_sessions: Arc::new(StdMutex::new(HashMap::new())),
            ssh_sessions: Arc::new(TokioMutex::new(HashMap::new())),
            rdp_sessions: Arc::new(StdMutex::new(HashMap::new())),
            vnc_sessions: Arc::new(StdMutex::new(HashMap::new())),
            native_rdp_sessions: Arc::new(StdMutex::new(HashMap::new())),
            telnet_sessions: Arc::new(TokioMutex::new(HashMap::new())),
            sftp_upload_cancellations: Arc::new(StdMutex::new(HashMap::new())),
            sftp_download_cancellations: Arc::new(StdMutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            protocol::create_terminal,
            protocol::get_available_shells,
            protocol::list_serial_ports,
            protocol::open_serial_session,
            protocol::write_serial,
            protocol::resize_serial,
            protocol::close_serial,
            protocol::open_telnet_session,
            protocol::write_telnet,
            protocol::resize_telnet,
            protocol::close_telnet,
            protocol::create_ssh_session,
            protocol::create_rdp_session,
            protocol::create_vnc_session,
            protocol::create_native_rdp_session,
            protocol::mount_native_rdp_session,
            protocol::set_native_rdp_session_visible,
            protocol::focus_native_rdp_session,
            protocol::close_native_rdp_session,
            protocol::sftp_upload_file,
            protocol::sftp_upload_files,
            protocol::cancel_sftp_upload,
            protocol::sftp_download,
            protocol::cancel_sftp_download,
            protocol::sftp_list_dir,
            protocol::write_to_terminal,
            protocol::write_to_ssh_session,
            protocol::send_rdp_pointer,
            protocol::send_rdp_key,
            protocol::send_vnc_pointer,
            protocol::send_vnc_key,
            protocol::paste_vnc_clipboard,
            protocol::type_vnc_text,
            protocol::request_vnc_refresh,
            protocol::release_rdp_inputs,
            protocol::resize_terminal,
            protocol::resize_ssh_session,
            protocol::resize_rdp_session,
            protocol::request_rdp_refresh,
            protocol::close_terminal,
            protocol::close_ssh_session,
            protocol::close_rdp_session,
            protocol::close_vnc_session,
            protocol::get_update_download_status,
            protocol::download_update,
            protocol::install_update,
            protocol::git_check_repo,
            protocol::git_commit_and_push,
            protocol::git_pull
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
