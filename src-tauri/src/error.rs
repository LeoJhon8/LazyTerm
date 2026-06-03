//! 错误类型模块
//! 提供统一的错误类型和转换实现

use thiserror::Error;

/// 应用错误类型
#[derive(Error, Debug)]
pub enum AppError {
    /// 连接错误
    #[error("连接失败: {0}")]
    Connection(String),

    /// 认证错误
    #[error("认证失败: {0}")]
    Auth(String),

    /// 会话未找到
    #[error("会话不存在: {session_type}/{session_id}")]
    SessionNotFound {
        session_type: String,
        session_id: String,
    },

    /// SSH 协议错误
    #[error("SSH 错误: {0}")]
    Ssh(String),

    /// RDP 协议错误
    #[error("RDP 错误: {0}")]
    Rdp(String),

    /// VNC 协议错误
    #[error("VNC 错误: {0}")]
    Vnc(String),

    /// SFTP 错误
    #[error("SFTP 错误: {0}")]
    Sftp(String),

    /// IO 错误
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    /// 参数错误
    #[error("参数错误: {0}")]
    InvalidInput(String),

    /// 其他错误
    #[error("{0}")]
    Other(String),
}

impl AppError {
    /// 创建连接错误
    pub fn connection(msg: impl Into<String>) -> Self {
        Self::Connection(msg.into())
    }

    /// 创建认证错误
    pub fn auth(msg: impl Into<String>) -> Self {
        Self::Auth(msg.into())
    }

    /// 创建 SSH 错误
    pub fn ssh(msg: impl Into<String>) -> Self {
        Self::Ssh(msg.into())
    }

    /// 创建 RDP 错误
    pub fn rdp(msg: impl Into<String>) -> Self {
        Self::Rdp(msg.into())
    }

    /// 创建 VNC 错误
    pub fn vnc(msg: impl Into<String>) -> Self {
        Self::Vnc(msg.into())
    }

    /// 创建 SFTP 错误
    pub fn sftp(msg: impl Into<String>) -> Self {
        Self::Sftp(msg.into())
    }

    /// 创建会话未找到错误
    pub fn session_not_found(
        session_type: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Self {
        Self::SessionNotFound {
            session_type: session_type.into(),
            session_id: session_id.into(),
        }
    }

    /// 创建参数错误
    pub fn invalid_input(msg: impl Into<String>) -> Self {
        Self::InvalidInput(msg.into())
    }

    /// 创建其他错误
    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }

    /// 转换为前端友好的错误消息
    pub fn to_user_message(&self) -> String {
        match self {
            Self::Connection(msg) => format!("无法建立连接: {}", msg),
            Self::Auth(msg) => format!("认证失败: {}", msg),
            Self::SessionNotFound {
                session_type,
                session_id,
            } => {
                format!("{} 会话 '{}' 不存在或已关闭", session_type, session_id)
            }
            Self::Ssh(msg) => format!("SSH 错误: {}", msg),
            Self::Rdp(msg) => format!("远程桌面错误: {}", msg),
            Self::Vnc(msg) => format!("VNC 错误: {}", msg),
            Self::Sftp(msg) => format!("文件传输错误: {}", msg),
            Self::Io(err) => format!("系统错误: {}", err),
            Self::InvalidInput(msg) => format!("输入错误: {}", msg),
            Self::Other(msg) => msg.clone(),
        }
    }
}

// 从 russh 错误转换
impl From<russh::Error> for AppError {
    fn from(err: russh::Error) -> Self {
        Self::Ssh(err.to_string())
    }
}

// 从 russh keys 错误转换
impl From<russh::keys::Error> for AppError {
    fn from(err: russh::keys::Error) -> Self {
        Self::Auth(format!("密钥错误: {}", err))
    }
}

// 从 SFTP 错误转换
impl From<russh_sftp::client::error::Error> for AppError {
    fn from(err: russh_sftp::client::error::Error) -> Self {
        Self::Sftp(err.to_string())
    }
}

/// 结果类型别名（使用 AppResult 避免与 std::result::Result 冲突）
pub type AppResult<T> = std::result::Result<T, AppError>;

/// 将错误转换为 Tauri 命令返回的字符串
///
/// 用于在 Tauri 命令中统一处理错误返回
pub fn into_tauri_result<T>(result: AppResult<T>) -> std::result::Result<T, String> {
    result.map_err(|e| e.to_string())
}

/// 安全的锁获取辅助函数
///
/// 处理 poisoned lock，返回错误而不是 panic
#[allow(dead_code)]
pub fn safe_lock<T, R>(lock: &std::sync::Mutex<T>, f: impl FnOnce(&mut T) -> R) -> AppResult<R> {
    let mut guard = lock
        .lock()
        .map_err(|e| AppError::Other(format!("锁被污染: {}", e)))?;
    Ok(f(&mut guard))
}

/// 安全的异步锁获取辅助函数
#[allow(dead_code)]
pub async fn safe_async_lock<T, R>(
    lock: &tokio::sync::Mutex<T>,
    f: impl FnOnce(&mut T) -> R,
) -> AppResult<R> {
    let mut guard = lock.lock().await;
    Ok(f(&mut guard))
}
