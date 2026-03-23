//! 协议共享模块
//! 包含 SSH 认证、SFTP 工具等共享逻辑

pub mod ssh_auth;
pub mod sftp_utils;
pub mod rdp;
pub mod vnc;
pub mod terminal;
pub mod ssh;
pub mod sftp;
pub mod mstsc;
pub mod native_rdp;

// 将常用命令直接导出到 `protocol::` 方便调用（迁移自 commands 模块）
pub use terminal::*;
pub use ssh::*;
pub use rdp::*;
pub use vnc::*;
pub use sftp::*;
pub use mstsc::*;
pub use native_rdp::*;
