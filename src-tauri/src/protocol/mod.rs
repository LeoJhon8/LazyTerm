//! 协议模块
//! 包含所有协议实现：SSH、RDP、VNC、本地终端等
//!
//! # VNC 实现
//!
//! VNC 协议基于 LibVNCClient FFI 实现，提供完整的 VNC 客户端功能。

// SSH 是移动端首版唯一启用的协议。
pub mod ssh;
pub mod ssh_auth;
pub use ssh::*;

// 其余协议仅在桌面端编译和注册。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod sftp_utils;

// 终端协议
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod serial;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod sftp;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod telnet;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod terminal;

// RDP 协议
#[cfg(all(not(any(target_os = "android", target_os = "ios")), freerdp_available))]
pub mod freerdp_client;
#[cfg(all(not(any(target_os = "android", target_os = "ios")), freerdp_available))]
pub mod freerdp_ffi;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod native_rdp;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod rdp;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod rdp_core;

// VNC 协议 - LibVNCClient FFI 实现
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod vnc;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod vnc_client;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod vnc_core;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod vnc_ffi;

// 导出常用命令
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use native_rdp::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use rdp::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use serial::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use sftp::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use telnet::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use terminal::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use vnc::*;
#[cfg(not(target_os = "ios"))]
pub mod updater;
#[cfg(not(target_os = "ios"))]
pub use updater::*;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod git_sync;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use git_sync::*;

// 导出核心逻辑函数
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use rdp_core::{build_rdp_config, connect_rdp, run_rdp_session};
