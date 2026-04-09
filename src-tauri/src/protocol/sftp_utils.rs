//! SFTP 工具模块
//! 提供 SFTP 相关的共享工具函数

use russh_sftp::client::SftpSession;
use std::path::Path;

/// 确保远程目录存在，不存在则逐级创建
///
/// # 参数
/// - `sftp`: SFTP 会话
/// - `remote_path`: 远程文件完整路径
///
/// # 返回
/// 成功返回 Ok(()), 失败返回错误信息
pub async fn ensure_remote_dirs(sftp: &SftpSession, remote_path: &str) -> Result<(), String> {
    if let Some(parent) = remote_path.rsplit_once('/') {
        let dir = parent.0;
        if !dir.is_empty() {
            let mut cur = String::new();
            let mut first = true;
            for part in dir.split('/') {
                if part.is_empty() {
                    if first {
                        cur.push('/');
                    }
                    first = false;
                    continue;
                }
                if !cur.ends_with('/') && !cur.is_empty() {
                    cur.push('/');
                }
                cur.push_str(part);
                let exists = sftp.try_exists(cur.clone()).await.unwrap_or(false);
                if !exists {
                    if let Err(_e) = sftp.create_dir(cur.clone()).await {
                        let exists_after = sftp.try_exists(cur.clone()).await.unwrap_or(false);
                        if !exists_after {
                            return Err(format!("创建远程目录失败: {}", cur));
                        }
                    }
                }
                first = false;
            }
        }
    }
    Ok(())
}

/// 标准化远程路径（处理 . 和 ..）
pub fn normalize_remote_path(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').collect();
    let mut result = Vec::new();

    for part in parts {
        match part {
            "" | "." => continue,
            ".." => {
                result.pop();
            }
            _ => result.push(part),
        }
    }

    format!("/{}", result.join("/"))
}

/// 解析远程路径，处理 ~/ 前缀
///
/// # 参数
/// - `path`: 原始路径（可能以 ~/ 开头）
/// - `home_dir`: 远程主目录路径（用于替换 ~）
///
/// # 返回
/// 解析后的绝对路径
pub fn resolve_remote_path(path: &str, home_dir: &str) -> String {
    if path.starts_with("~/") {
        let home = home_dir.trim_end_matches('/');
        normalize_remote_path(&format!("{}/{}", home, &path[2..]))
    } else {
        normalize_remote_path(path)
    }
}

/// 从完整路径中提取文件名
pub fn extract_filename(path: &str) -> Option<&str> {
    Path::new(path).file_name().and_then(|n| n.to_str())
}
