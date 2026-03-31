//! 协议模块
//! 包含所有协议实现：SSH、RDP、VNC、本地终端等
//!
//! # VNC 实现
//!
//! VNC 协议基于 LibVNCClient FFI 实现，提供完整的 VNC 客户端功能。

// 共享模块
pub mod ssh_auth;
pub mod sftp_utils;
pub mod tls;

// 终端协议
pub mod terminal;
pub mod ssh;
pub mod sftp;

// RDP 协议
pub mod rdp;
pub mod rdp_core;
pub mod mstsc;
pub mod native_rdp;

// VNC 协议 - LibVNCClient FFI 实现
pub mod vnc_ffi;
pub mod vnc_client;
pub mod vnc_core;
pub mod vnc;

// 导出常用命令
pub use terminal::*;
pub use ssh::*;
pub use rdp::*;
pub use sftp::*;
pub use mstsc::*;
pub use native_rdp::*;
pub use vnc::*;

// 导出核心逻辑函数
pub use rdp_core::{
    build_rdp_config, build_rdp_full_address, connect_rdp, run_rdp_session,
};
pub use vnc_core::run_vnc_session;
