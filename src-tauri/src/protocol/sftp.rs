//! SFTP 文件传输命令模块（从 commands/sftp.rs 迁移）

use crate::error::safe_lock;
use crate::protocol::sftp_utils;
use crate::protocol::ssh_auth;
use crate::utils::map_sftp_error;
use crate::SftpFileEntry;
use crate::{
    AppState, SftpDownloadCancelGuard, SftpDownloadProgress, SftpUploadCancelGuard, SftpUploadItem,
    SftpUploadProgress, SshConnectConfig,
};
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

struct DownloadFile {
    remote_path: String,
    relative_path: String,
    size: u64,
}

fn join_remote_path(parent: &str, child: &str) -> String {
    format!("{}/{}", parent.trim_end_matches('/'), child)
}

fn download_cancelled(state: &State<'_, AppState>, download_id: &str) -> bool {
    safe_lock(&state.sftp_download_cancellations, |cancellations| {
        cancellations.get(download_id).copied().unwrap_or(false)
    })
    .unwrap_or(false)
}

async fn collect_download_files(
    sftp: &SftpSession,
    remote_path: String,
    relative_path: String,
    files: &mut Vec<DownloadFile>,
) -> Result<(), String> {
    let metadata = sftp
        .metadata(&remote_path)
        .await
        .map_err(|e| map_sftp_error("读取远程文件信息失败", &e, Some(&remote_path)))?;

    if !metadata.is_dir() {
        files.push(DownloadFile {
            remote_path,
            relative_path,
            size: metadata.size.unwrap_or(0),
        });
        return Ok(());
    }

    let mut entries = sftp
        .read_dir(&remote_path)
        .await
        .map_err(|e| map_sftp_error("读取远程目录失败", &e, Some(&remote_path)))?;
    while let Some(entry) = entries.next() {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        Box::pin(collect_download_files(
            sftp,
            join_remote_path(&remote_path, &name),
            format!("{}/{}", relative_path.trim_end_matches('/'), name),
            files,
        ))
        .await?;
    }
    Ok(())
}

/// 单文件 SFTP 上传
#[tauri::command]
pub async fn sftp_upload_file(
    config: SshConnectConfig,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    // 使用 protocol::ssh_auth 中的 connect_and_authenticate 一站式完成连接和认证
    let handle = ssh_auth::connect_and_authenticate(&config)
        .await
        .map_err(|e| e)?;

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
    let home_dir = sftp
        .canonicalize(".")
        .await
        .unwrap_or_else(|_| "/".to_string());
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
            Err(e) => Err(map_sftp_error(
                "写入远程文件失败",
                &e,
                Some(&remote_path_resolved),
            )),
        },
        Err(e) => Err(map_sftp_error(
            "创建远程文件失败",
            &e,
            Some(&remote_path_resolved),
        )),
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
    })
    .map_err(|e| e.to_string())?;

    let _cancel_guard = SftpUploadCancelGuard {
        upload_id: upload_id.clone(),
        cancellations: Arc::clone(&state.sftp_upload_cancellations),
    };

    // 使用 protocol::ssh_auth 中的 connect_and_authenticate 一站式完成连接和认证
    let handle = ssh_auth::connect_and_authenticate(&config)
        .await
        .map_err(|e| e)?;

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
    let home_dir = sftp
        .canonicalize(".")
        .await
        .unwrap_or_else(|_| "/".to_string());

    let mut file_infos: Vec<(usize, SftpUploadItem, bool, u64, String)> = Vec::new();
    let mut overall_total = 0u64;
    for (index, item) in files.into_iter().enumerate() {
        let meta = tokio::fs::metadata(&item.local_path)
            .await
            .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;
        let is_dir = item.is_dir.unwrap_or(false) || meta.is_dir();
        if is_dir {
            let file_name = sftp_utils::extract_filename(&item.local_path)
                .unwrap_or(&item.local_path)
                .to_string();
            file_infos.push((index, item, true, 0, file_name));
            continue;
        }
        if !meta.is_file() {
            return Err(format!(
                "读取本地文件失败: 不是文件 (path={})",
                item.local_path
            ));
        }
        let size = meta.len();
        overall_total += size;
        let file_name = sftp_utils::extract_filename(&item.local_path)
            .unwrap_or(&item.local_path)
            .to_string();
        file_infos.push((index, item, false, size, file_name));
    }

    let mut overall_sent = 0u64;
    let mut last_progress_emit: Option<Instant> = None;
    for (index, item, is_dir, file_size, file_name) in file_infos.into_iter() {
        let cancelled = safe_lock(&state.sftp_upload_cancellations, |cancellations| {
            cancellations.get(&upload_id).copied().unwrap_or(false)
        })
        .unwrap_or(false);
        if cancelled {
            return Err("上传已停止".to_string());
        }

        // 使用 sftp_utils 解析远程路径（处理 ~/ 前缀）
        let remote_path_resolved = sftp_utils::resolve_remote_path(&item.remote_path, &home_dir);

        if remote_path_resolved.is_empty() {
            return Err("远程路径不能为空。".to_string());
        }

        if is_dir {
            sftp_utils::ensure_remote_dir_path(&sftp, &remote_path_resolved)
                .await
                .map_err(|e| map_sftp_error("创建远程目录失败", &e, None))?;
            continue;
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
            Err(e) => {
                return Err(map_sftp_error(
                    "创建远程文件失败",
                    &e,
                    Some(&remote_path_resolved),
                ))
            }
        };

        let mut sent = 0u64;
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            let cancelled = safe_lock(&state.sftp_upload_cancellations, |cancellations| {
                cancellations.get(&upload_id).copied().unwrap_or(false)
            })
            .unwrap_or(false);
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
            let is_file_complete = sent >= file_size;
            let is_overall_complete = overall_total > 0 && overall_sent >= overall_total;
            let should_emit_progress = is_file_complete
                || is_overall_complete
                || last_progress_emit
                    .map(|last| last.elapsed() >= Duration::from_millis(500))
                    .unwrap_or(true);

            if should_emit_progress {
                last_progress_emit = Some(Instant::now());
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
    })
    .map_err(|e| e.to_string())?
}

/// 列出远程目录
#[tauri::command]
pub async fn sftp_download(
    app: AppHandle,
    state: State<'_, AppState>,
    config: SshConnectConfig,
    remote_paths: Vec<String>,
    local_dir: String,
    progress_event: String,
    download_id: String,
) -> Result<(), String> {
    if remote_paths.is_empty() {
        return Ok(());
    }
    safe_lock(&state.sftp_download_cancellations, |cancellations| {
        cancellations.insert(download_id.clone(), false);
    })
    .map_err(|e| e.to_string())?;
    let _cancel_guard = SftpDownloadCancelGuard {
        download_id: download_id.clone(),
        cancellations: Arc::clone(&state.sftp_download_cancellations),
    };

    let handle = ssh_auth::connect_and_authenticate(&config).await?;
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开会话失败: {}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("请求 SFTP 子系统失败: {}", e))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("SFTP 初始化失败: {}", e))?;
    let home_dir = sftp
        .canonicalize(".")
        .await
        .unwrap_or_else(|_| "/".to_string());
    tokio::fs::create_dir_all(&local_dir)
        .await
        .map_err(|e| format!("创建本地目录失败: {} (path={})", e, local_dir))?;

    let mut files = Vec::new();
    for remote_path in remote_paths {
        let resolved = sftp_utils::resolve_remote_path(&remote_path, &home_dir);
        let name = resolved
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .ok_or_else(|| format!("无法下载远程根目录: {}", remote_path))?
            .to_string();
        collect_download_files(&sftp, resolved, name, &mut files).await?;
    }

    let overall_total = files.iter().map(|file| file.size).sum();
    let mut overall_received = 0u64;
    let mut last_progress_emit: Option<Instant> = None;
    for item in files {
        if download_cancelled(&state, &download_id) {
            return Err("下载已停止".to_string());
        }
        let relative_local_path = item
            .relative_path
            .split('/')
            .filter(|part| !part.is_empty() && *part != "." && *part != "..")
            .fold(std::path::PathBuf::new(), |path, part| path.join(part));
        let local_path = std::path::Path::new(&local_dir).join(relative_local_path);
        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("创建本地目录失败: {} (path={})", e, parent.display()))?;
        }
        let mut remote_file = sftp
            .open(&item.remote_path)
            .await
            .map_err(|e| map_sftp_error("打开远程文件失败", &e, Some(&item.remote_path)))?;
        let mut local_file = tokio::fs::File::create(&local_path)
            .await
            .map_err(|e| format!("创建本地文件失败: {} (path={})", e, local_path.display()))?;
        let file_name = local_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&item.relative_path)
            .to_string();
        let local_path_text = local_path.to_string_lossy().to_string();
        let mut file_received = 0u64;
        let mut buffer = vec![0u8; 256 * 1024];
        loop {
            if download_cancelled(&state, &download_id) {
                return Err("下载已停止".to_string());
            }
            let read = remote_file
                .read(&mut buffer)
                .await
                .map_err(|e| map_sftp_error("读取远程文件失败", &e, Some(&item.remote_path)))?;
            if read == 0 {
                break;
            }
            local_file
                .write_all(&buffer[..read])
                .await
                .map_err(|e| format!("写入本地文件失败: {} (path={})", e, local_path.display()))?;
            file_received += read as u64;
            overall_received += read as u64;
            let should_emit = file_received >= item.size
                || (overall_total > 0 && overall_received >= overall_total)
                || last_progress_emit
                    .map(|last| last.elapsed() >= Duration::from_millis(500))
                    .unwrap_or(true);
            if should_emit {
                last_progress_emit = Some(Instant::now());
                let _ = app.emit(
                    &progress_event,
                    SftpDownloadProgress {
                        file_name: file_name.clone(),
                        remote_path: item.remote_path.clone(),
                        local_path: local_path_text.clone(),
                        file_size: item.size,
                        file_received: file_received.min(item.size),
                        overall_total,
                        overall_received: overall_received.min(overall_total),
                    },
                );
            }
        }
    }
    let _ = sftp.close().await;
    Ok(())
}

#[tauri::command]
pub fn cancel_sftp_download(state: State<'_, AppState>, download_id: String) -> Result<(), String> {
    safe_lock(&state.sftp_download_cancellations, |cancellations| {
        if let Some(cancelled) = cancellations.get_mut(&download_id) {
            *cancelled = true;
            Ok(())
        } else {
            Err("下载任务不存在或已结束".to_string())
        }
    })
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sftp_list_dir(
    config: SshConnectConfig,
    path: String,
) -> Result<Vec<SftpFileEntry>, String> {
    let handle = ssh_auth::connect_and_authenticate(&config)
        .await
        .map_err(|e| e)?;

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

    // 获取工作目录
    let actual_path = if path.is_empty() || path == "~" || path == "~/" {
        sftp.canonicalize(".")
            .await
            .unwrap_or_else(|_| "/".to_string())
    } else if path.starts_with("~/") {
        let home = sftp
            .canonicalize(".")
            .await
            .unwrap_or_else(|_| "/".to_string());
        format!("{}/{}", home.trim_end_matches('/'), &path[2..])
    } else {
        path
    };

    let mut dir_stream = sftp
        .read_dir(&actual_path)
        .await
        .map_err(|e| format!("获取目录失败: {}", e))?;

    let mut entries = Vec::new();
    while let Some(entry) = dir_stream.next() {
        let name = entry.file_name();

        let stat = entry.metadata();
        entries.push(SftpFileEntry {
            name,
            is_dir: stat.is_dir(),
            size: stat.size.unwrap_or(0),
            modified: stat.mtime.unwrap_or(0) as u64,
        });
    }

    entries.sort_by(|a, b| match (b.is_dir, a.is_dir) {
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        _ => a.name.cmp(&b.name),
    });

    Ok(entries)
}
