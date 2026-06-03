//! SSH 命令模块（从 commands/ssh.rs 迁移）

use crate::logging;
use crate::protocol::ssh_auth;
use crate::{AppState, SshConnectConfig, SshControlMsg, SshTerminalSession};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::mpsc;
use uuid::Uuid;

/// 创建 SSH 会话
#[tauri::command]
pub async fn create_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: SshConnectConfig,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();

    logging::info(
        "SSH/connect",
        format!(
            "连接尝试: {}@{}:{} keep_alive={:?} keep_alive_interval={:?}",
            config.username,
            config.host,
            config.port,
            config.keep_alive,
            config.keep_alive_interval,
        ),
    );

    // 使用 protocol::ssh_auth 中的 connect_and_authenticate 一站式完成连接和认证
    let handle = ssh_auth::connect_and_authenticate(&config)
        .await
        .map_err(|e| {
            logging::error("SSH/connect", format!("连接或认证失败: {e}"));
            e
        })?;

    logging::info("SSH/connect", "认证通过，初始化会话通道");

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    let initial_cols = config.initial_cols.unwrap_or(80).clamp(40, 400);
    let initial_rows = config.initial_rows.unwrap_or(24).clamp(12, 200);
    channel
        .request_pty(
            true,
            "xterm-256color",
            initial_cols,
            initial_rows,
            0,
            0,
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    logging::info(
        "SSH/channel",
        format!("session {session_id} pty ok: {initial_cols}x{initial_rows}"),
    );
    let _ = channel.set_env(false, "TERM_PROGRAM", "LazyTerm").await;
    let _ = channel
        .set_env(false, "TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"))
        .await;
    let _ = channel.set_env(false, "COLORTERM", "truecolor").await;
    channel
        .request_shell(true)
        .await
        .map_err(|e| e.to_string())?;
    logging::info("SSH/channel", format!("session {session_id} shell ok"));

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<SshControlMsg>();
    let session_id_clone = session_id.clone();

    tokio::spawn(async move {
        let event_name = format!("terminal-data-{}", session_id_clone);
        let close_event_name = format!("terminal-close-{}", session_id_clone);

        loop {
            tokio::select! {
                msg = channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { data }) => {
                            let _ = app.emit(&event_name, String::from_utf8_lossy(&data).to_string());
                        }
                        Some(russh::ChannelMsg::ExtendedData { data, ext }) => {
                            logging::warn(
                                "SSH/channel",
                                format!("session {session_id_clone} received extended data: ext={ext} bytes={}", data.len()),
                            );
                            let _ = app.emit(&event_name, String::from_utf8_lossy(&data).to_string());
                        }
                        Some(russh::ChannelMsg::Eof) => {
                            logging::warn("SSH/channel", format!("session {session_id_clone} received EOF"));
                            let _ = app.emit(&close_event_name, "eof");
                            break;
                        }
                        Some(russh::ChannelMsg::Close) => {
                            logging::warn("SSH/channel", format!("session {session_id_clone} received CLOSE"));
                            let _ = app.emit(&close_event_name, "close");
                            break;
                        }
                        Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                            logging::warn(
                                "SSH/channel",
                                format!("session {session_id_clone} received exit-status={exit_status}"),
                            );
                        }
                        Some(russh::ChannelMsg::ExitSignal {
                            signal_name,
                            core_dumped,
                            error_message,
                            lang_tag,
                        }) => {
                            logging::warn(
                                "SSH/channel",
                                format!(
                                    "session {session_id_clone} received exit-signal={signal_name:?} core_dumped={core_dumped} lang={lang_tag} message={error_message}"
                                ),
                            );
                        }
                        Some(other) => {
                            logging::info(
                                "SSH/channel",
                                format!("session {session_id_clone} received channel message: {other:?}"),
                            );
                        }
                        None => {
                            logging::warn("SSH/channel", format!("session {session_id_clone} channel wait returned None"));
                            let _ = app.emit(&close_event_name, "channel-none");
                            break;
                        }
                    }
                }
                Some(ctrl) = control_rx.recv() => {
                    match ctrl {
                        SshControlMsg::SendData(data) => {
                            if let Err(error) = channel.data(&data[..]).await {
                                logging::error(
                                    "SSH/channel",
                                    format!("session {session_id_clone} failed to send data: {error}"),
                                );
                            }
                        }
                        SshControlMsg::Resize(cols, rows) => {
                            if let Err(error) = channel.window_change(cols, rows, 0, 0).await {
                                logging::error(
                                    "SSH/channel",
                                    format!("session {session_id_clone} failed to resize to {cols}x{rows}: {error}"),
                                );
                            }
                        }
                        SshControlMsg::Close => {
                            logging::info("SSH/channel", format!("session {session_id_clone} closed by local request"));
                            let _ = app.emit(&close_event_name, "local-close");
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
                else => {
                    logging::warn("SSH/channel", format!("session {session_id_clone} control channel closed"));
                    let _ = app.emit(&close_event_name, "control-closed");
                    break;
                }
            }
        }
    });

    state.ssh_sessions.lock().await.insert(
        session_id.clone(),
        SshTerminalSession { control_tx, handle },
    );

    Ok(session_id)
}

/// 向 SSH 会话写入数据
#[tauri::command]
pub async fn write_to_ssh_session(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(SshControlMsg::SendData(data.into_bytes()))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("SSH会话不存在".to_string())
    }
}

/// 调整 SSH 会话终端大小
#[tauri::command]
pub async fn resize_ssh_session(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(SshControlMsg::Resize(cols as u32, rows as u32))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 关闭 SSH 会话
#[tauri::command]
pub async fn close_ssh_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    if let Some(session) = state.ssh_sessions.lock().await.remove(&session_id) {
        let _ = session.control_tx.send(SshControlMsg::Close);
    }
    Ok(())
}
