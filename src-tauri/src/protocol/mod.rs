//! 协议模块
//! 包含所有协议实现：SSH、RDP、VNC、本地终端等
//!
//! # VNC 实现
//!
//! VNC 协议基于 LibVNCClient FFI 实现，提供完整的 VNC 客户端功能。

// 共享模块
pub mod sftp_utils;
pub mod ssh_auth;
pub mod tls;

// 终端协议
pub mod sftp;
pub mod ssh;
pub mod terminal;
pub mod serial;
pub mod telnet;

// RDP 协议
pub mod mstsc;
pub mod native_rdp;
pub mod rdp;
pub mod rdp_core;

// VNC 协议 - LibVNCClient FFI 实现
pub mod vnc;
pub mod vnc_client;
pub mod vnc_core;
pub mod vnc_ffi;

// 导出常用命令
pub use mstsc::*;
pub use native_rdp::*;
pub use rdp::*;
pub use sftp::*;
pub use ssh::*;
pub use terminal::*;
pub use serial::*;
pub use telnet::*;
pub use vnc::*;
pub mod updater;
pub use updater::*;

// 导出核心逻辑函数
pub use rdp_core::{build_rdp_config, connect_rdp, run_rdp_session};
