//! SFTP 文件传输命令模块（从 commands/sftp.rs 迁移）

use crate::{
    AppState, SftpUploadCancelGuard, SftpUploadItem, SftpUploadProgress, SshConnectConfig,
};
use crate::utils::map_sftp_error;
use crate::protocol::ssh_auth;
use crate::protocol::sftp_utils;
use crate::error::safe_lock;
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// 单文件 SFTP 上传
#[tauri::command]
pub async fn sftp_upload_file(
    config: SshConnectConfig,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    // 使用 protocol::ssh_auth 中的 connect_and_authenticate 一站式完成连接和认证
    let handle = ssh_auth::connect_and_authenticate(&config).await.map_err(|e| {
        format!("{}，请检查账号、私钥或密码。", e)
    })?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开会话失败：{}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("请求 SFTP 子系统失败：{}", e))?;

    let stream = channel.into_stream();
    let sftp = SftpSession::new(stream)
        .await
        .map_err(|e| format!("SFTP 初始化失败：{}", e))?;

    let meta = tokio::fs::metadata(&local_path)
        .await
        .map_err(|e| format!("读取本地文件失败：{} (path={})", e, local_path))?;
    if !meta.is_file() {
        return Err(format!("读取本地文件失败：不是文件 (path={})", local_path));
    }
    let data = tokio::fs::read(&local_path)
        .await
        .map_err(|e| format!("读取本地文件失败：{} (path={})", e, local_path))?;
    
    // 获取远程主目录并解析路径
    let home_dir = sftp.canonicalize(".").await.unwrap_or_else(|_| "/".to_string());
    let remote_path_resolved = sftp_utils::resolve_remote_path(&remote_path, &home_dir);

    // 使用 sftp_utils 确保远程目录存在
    sftp_utils::ensure_remote_dirs(&sftp, &remote_path_resolved)
        .await
        .map_err(|e| map_sftp_error("创建远程目录失败", &e, None))?;

    match sftp.create(&remote_path_resolved).await {
        Ok(mut file) => match file.write_all(&data).await {
            Ok(_) => {
                let _ = sftp.close().await;
                Ok(())
            }
            Err(e) => Err(map_sftp_error("写入远程文件失败", &e, Some(&remote_path_resolved))),
        },
        Err(e) => Err(map_sftp_error("创建远程文件失败", &e, Some(&remote_path_resolved))),
    }
}

/// 多文件 SFTP 上传（带进度）
#[tauri::command]
pub async fn sftp_upload_files(
    app: AppHandle,
    state: State<'_, AppState>,
    config: SshConnectConfig,
    files: Vec<SftpUploadItem>,
    progress_event: String,
    upload_id: String,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    // 使用 safe_lock 安全获取锁
    safe_lock(&state.sftp_upload_cancellations, |cancellations| {
        cancellations.insert(upload_id.clone(), false);
    }).map_err(|e| e.to_string())?;
    
    let _cancel_guard = SftpUploadCancelGuard {
        upload_id: upload_id.clone(),
        cancellations: Arc::clone(&state.sftp_upload_cancellations),
    };

    // 使用 protocol::ssh_auth 中的 connect_and_authenticate 一站式完成连接和认证
    let handle = ssh_auth::connect_and_authenticate(&config).await.map_err(|e| {
        format!("{}，请检查账号、私钥或密码。", e)
    })?;

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开会话失败: {}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("请求 SFTP 子系统失败: {}", e))?;

    let stream = channel.into_stream();
    let sftp = SftpSession::new(stream)
        .await
        .map_err(|e| format!("SFTP 初始化失败: {}", e))?;

    // 获取远程主目录（用于解析 ~/ 路径）
    let home_dir = sftp.canonicalize(".").await.unwrap_or_else(|_| "/".to_string());

    let mut file_infos: Vec<(usize, SftpUploadItem, u64, String)> = Vec::new();
    let mut overall_total = 0u64;
    for (index, item) in files.into_iter().enumerate() {
        let meta = tokio::fs::metadata(&item.local_path)
            .await
            .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;
        if !meta.is_file() {
            return Err(format!("读取本地文件失败: 不是文件 (path={})", item.local_path));
        }
        let size = meta.len();
        overall_total += size;
        let file_name = sftp_utils::extract_filename(&item.local_path)
            .unwrap_or(&item.local_path)
            .to_string();
        file_infos.push((index, item, size, file_name));
    }

    let mut overall_sent = 0u64;
    for (index, item, file_size, file_name) in file_infos.into_iter() {
        let cancelled = safe_lock(&state.sftp_upload_cancellations, |cancellations| {
            cancellations.get(&upload_id).copied().unwrap_or(false)
        }).unwrap_or(false);
        if cancelled {
            return Err("上传已停止".to_string());
        }

        // 使用 sftp_utils 解析远程路径（处理 ~/ 前缀）
        let remote_path_resolved = sftp_utils::resolve_remote_path(&item.remote_path, &home_dir);

        if remote_path_resolved.is_empty() {
            return Err("远程路径不能为空。".to_string());
        }

        // 使用 sftp_utils 确保远程目录存在
        sftp_utils::ensure_remote_dirs(&sftp, &remote_path_resolved)
            .await
            .map_err(|e| map_sftp_error("创建远程目录失败", &e, None))?;

        let mut local_file = tokio::fs::File::open(&item.local_path)
            .await
            .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;

        let mut remote_file = match sftp.create(&remote_path_resolved).await {
            Ok(file) => file,
            Err(e) => return Err(map_sftp_error("创建远程文件失败", &e, Some(&remote_path_resolved))),
        };

        let mut sent = 0u64;
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let cancelled = safe_lock(&state.sftp_upload_cancellations, |cancellations| {
                cancellations.get(&upload_id).copied().unwrap_or(false)
            }).unwrap_or(false);
            if cancelled {
                return Err("上传已停止".to_string());
            }

            let n = local_file
                .read(&mut buffer)
                .await
                .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buffer[..n])
                .await
                .map_err(|e| map_sftp_error("写入远程文件失败", &e, Some(&remote_path_resolved)))?;
            sent += n as u64;
            overall_sent += n as u64;
            let progress = SftpUploadProgress {
                file_index: index,
                file_name: file_name.clone(),
                local_path: item.local_path.clone(),
                file_size,
                file_sent: sent.min(file_size),
                overall_total,
                overall_sent: overall_sent.min(overall_total),
            };
            let _ = app.emit(&progress_event, &progress);
        }

        if file_size == 0 {
            let progress = SftpUploadProgress {
                file_index: index,
                file_name: file_name.clone(),
                local_path: item.local_path.clone(),
                file_size,
                file_sent: 0,
                overall_total,
                overall_sent,
            };
            let _ = app.emit(&progress_event, &progress);
        }
    }

    let _ = sftp.close().await;
    Ok(())
}

/// 取消 SFTP 上传
#[tauri::command]
pub fn cancel_sftp_upload(state: State<'_, AppState>, upload_id: String) -> Result<(), String> {
    safe_lock(&state.sftp_upload_cancellations, |cancellations| {
        if let Some(cancelled) = cancellations.get_mut(&upload_id) {
            *cancelled = true;
            Ok(())
        } else {
            Err("上传任务不存在或已结束".to_string())
        }
    }).map_err(|e| e.to_string())?
}
