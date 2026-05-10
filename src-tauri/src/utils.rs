//! 通用工具函数模块

use crate::logging;
use crate::types::{RdpConnectConfig, VncConnectConfig};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 创建一个隐藏窗口的命令（仅 Windows 有效）
pub fn create_hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

/// 生成 RDP 目标标签
pub fn rdp_target_label(config: &RdpConnectConfig) -> String {
    format!("{}:{}", config.host, config.port)
}

/// 记录 RDP 信息日志
pub fn log_rdp_info(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    let scope = format!("RDP/{session_id}/{target}/{stage}");
    logging::info(&scope, message);
}

/// 记录 RDP 错误日志
pub fn log_rdp_error(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    let scope = format!("RDP/{session_id}/{target}/{stage}");
    logging::error(&scope, message);
}

/// 生成 VNC 目标标签
pub fn vnc_target_label(config: &VncConnectConfig) -> String {
    format!("{}:{}", config.host, config.port)
}

/// 记录 VNC 信息日志
pub fn log_vnc_info(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    let scope = format!("VNC/{session_id}/{target}/{stage}");
    logging::info(&scope, message);
}

/// 记录 VNC 错误日志
pub fn log_vnc_error(session_id: &str, target: &str, stage: &str, message: impl AsRef<str>) {
    let scope = format!("VNC/{session_id}/{target}/{stage}");
    logging::error(&scope, message);
}

/// 映射 SFTP 错误为友好提示
pub fn map_sftp_error(context: &str, err: &impl std::fmt::Display, path: Option<&str>) -> String {
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
