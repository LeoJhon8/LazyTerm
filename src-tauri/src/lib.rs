//! Lazy Term 核心库
//! 包含应用状态定义和 Tauri 入口
//!
//! # VNC 实现说明
//!
//! VNC 协议基于 LibVNCClient C 库实现，通过 FFI 与 Rust 集成。
//! 需要系统安装 libvncclient 开发库才能构建。

#[cfg(not(feature = "demo"))]
mod error;
#[cfg(not(feature = "demo"))]
mod logging;
#[cfg(not(feature = "demo"))]
mod protocol;
#[cfg(not(feature = "demo"))]
mod state;
#[cfg(not(feature = "demo"))]
mod types;
#[cfg(not(feature = "demo"))]
mod utils;

#[cfg(target_os = "android")]
#[cfg(not(feature = "demo"))]
mod android_ssh_background;
#[cfg(target_os = "android")]
#[cfg(not(feature = "demo"))]
mod android_updater;

#[cfg(not(feature = "demo"))]
use std::collections::{HashMap, HashSet};
#[cfg(not(feature = "demo"))]
use std::sync::{Arc, Mutex as StdMutex};
#[cfg(not(feature = "demo"))]
use tokio::sync::Mutex as TokioMutex;

#[cfg(not(feature = "demo"))]
pub use error::into_tauri_result;
#[cfg(not(feature = "demo"))]
pub use error::AppError;
#[cfg(not(feature = "demo"))]
pub use error::AppResult;
#[cfg(not(feature = "demo"))]
pub use state::AppState;
#[cfg(not(feature = "demo"))]
pub use utils::{
    log_rdp_error, log_rdp_info, log_vnc_error, log_vnc_info, map_sftp_error, rdp_target_label,
    vnc_target_label,
};

// 从 types 模块导入并重新导出纯数据类型
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[cfg(not(feature = "demo"))]
pub use crate::types::LocalTerminalSession;
#[cfg(not(feature = "demo"))]
pub use crate::types::{
    NativeHostRect, NativeRdpStateEventPayload, NativeRdpTraceEventPayload, RdpConnectConfig,
    RdpControlMsg, RdpKeyboardEventPayload, RdpPointerEventPayload, RdpSession,
    SftpDownloadCancelGuard, SftpDownloadProgress, SftpFileEntry, SftpUploadCancelGuard,
    SftpUploadItem, SftpUploadProgress, ShellInfo, SshConnectConfig, SshControlMsg,
    SshSessionOpenResult, SshTerminalSession, SshTmuxCapability, SshTmuxSessionInfo,
    TelnetConnectConfig, TelnetSession, VncClipboardPastePayload, VncConnectConfig, VncControlMsg,
    VncControlOutcome, VncCursorEventPayload, VncKeySequencePayload, VncKeyboardEventPayload,
    VncPointerEventPayload, VncSession, VncTextInputPayload,
};

// --- 程序入口 ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(feature = "demo"))]
pub fn run() {
    logging::init();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(not(target_os = "ios"))]
    let builder = builder.manage(protocol::UpdateDownloadState::default());

    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(android_updater::init())
        .plugin(android_ssh_background::init());

    let builder = builder.manage(AppState {
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        local_sessions: Arc::new(StdMutex::new(HashMap::new())),
        ssh_sessions: Arc::new(TokioMutex::new(HashMap::new())),
        ssh_client_session_keys: Arc::new(TokioMutex::new(HashSet::new())),
        ssh_tmux_session_keys: Arc::new(TokioMutex::new(HashSet::new())),
        rdp_sessions: Arc::new(StdMutex::new(HashMap::new())),
        vnc_sessions: Arc::new(StdMutex::new(HashMap::new())),
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        native_rdp_sessions: Arc::new(StdMutex::new(HashMap::new())),
        telnet_sessions: Arc::new(TokioMutex::new(HashMap::new())),
        sftp_upload_cancellations: Arc::new(StdMutex::new(HashMap::new())),
        sftp_download_cancellations: Arc::new(StdMutex::new(HashMap::new())),
    });

    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        protocol::create_ssh_session,
        protocol::write_to_ssh_session,
        protocol::resize_ssh_session,
        protocol::check_ssh_tmux_capability,
        protocol::exit_ssh_tmux_copy_mode,
        protocol::ai_ssh_tmux_pane,
        protocol::kill_ssh_tmux_session,
        protocol::set_ssh_background_mode,
        protocol::close_ssh_session,
        protocol::get_update_download_status,
        protocol::download_update,
        android_updater::get_android_arch,
        android_updater::install_android_update,
        android_ssh_background::set_android_ssh_session_count,
        android_ssh_background::open_android_app_settings,
    ]);

    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        protocol::create_ssh_session,
        protocol::write_to_ssh_session,
        protocol::resize_ssh_session,
        protocol::close_ssh_session,
    ]);

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
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
        protocol::set_native_rdp_session_overlay_rect,
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
        protocol::send_rdp_action,
        protocol::send_vnc_pointer,
        protocol::send_vnc_key,
        protocol::send_vnc_key_sequence,
        protocol::paste_vnc_clipboard,
        protocol::type_vnc_text,
        protocol::request_vnc_refresh,
        protocol::resize_vnc_session,
        protocol::set_vnc_quality_policy,
        protocol::release_rdp_inputs,
        protocol::resize_terminal,
        protocol::resize_ssh_session,
        protocol::check_ssh_tmux_capability,
        protocol::exit_ssh_tmux_copy_mode,
        protocol::ai_ssh_tmux_pane,
        protocol::kill_ssh_tmux_session,
        protocol::set_ssh_background_mode,
        protocol::request_rdp_refresh,
        protocol::set_rdp_quality_policy,
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
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// A Demo executable has no protocol command handlers or filesystem/HTTP/updater plugins.
#[cfg(feature = "demo")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init());
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    builder
        .run(tauri::generate_context!())
        .expect("error while running LazyTerm Demo");
}
