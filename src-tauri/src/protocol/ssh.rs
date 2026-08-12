//! SSH 命令模块（从 commands/ssh.rs 迁移）

use crate::logging;
use crate::protocol::ssh_auth;
use crate::{AppState, SshConnectConfig, SshControlMsg, SshTerminalSession};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::{mpsc, oneshot};

/// 创建 SSH 会话
#[tauri::command]
pub async fn create_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: String,
    config: SshConnectConfig,
) -> Result<String, String> {
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

    let ready_timeout =
        Duration::from_millis(config.ready_timeout.unwrap_or(30_000).clamp(1_000, 120_000));
    let readiness_result = tokio::time::timeout(ready_timeout, async {
        // 使用 protocol::ssh_auth 中的 connect_and_authenticate 一站式完成连接和认证
        let handle = ssh_auth::connect_and_authenticate(&config)
            .await
            .map_err(|e| {
                logging::error("SSH/connect", format!("连接或认证失败: {e}"));
                e
            })?;

        logging::info("SSH/connect", "认证通过，初始化会话通道");

        let channel = handle
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

        Ok::<_, String>((handle, channel))
    })
    .await
    .map_err(|_| format!("SSH 会话就绪超时（{} ms）", ready_timeout.as_millis()))?;
    let (handle, channel) = readiness_result?;

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<SshControlMsg>();
    let (mut channel_reader, channel_writer) = channel.split();
    let (channel_closed_tx, mut channel_closed_rx) = oneshot::channel::<()>();
    let close_emitted = Arc::new(AtomicBool::new(false));

    state.ssh_sessions.lock().await.insert(
        session_id.clone(),
        SshTerminalSession { control_tx, handle },
    );

    let reader_app = app.clone();
    let reader_session_id = session_id.clone();
    let reader_close_emitted = Arc::clone(&close_emitted);
    let reader_sessions = Arc::clone(&state.ssh_sessions);
    tokio::spawn(async move {
        let event_name = format!("terminal-data-{reader_session_id}");
        let close_event_name = format!("terminal-close-{reader_session_id}");

        let close_reason = loop {
            match channel_reader.wait().await {
                Some(russh::ChannelMsg::Data { data }) => {
                    let _ =
                        reader_app.emit(&event_name, String::from_utf8_lossy(&data).to_string());
                }
                Some(russh::ChannelMsg::ExtendedData { data, ext }) => {
                    logging::warn(
                        "SSH/channel",
                        format!(
                            "session {reader_session_id} received extended data: ext={ext} bytes={}",
                            data.len()
                        ),
                    );
                    let _ =
                        reader_app.emit(&event_name, String::from_utf8_lossy(&data).to_string());
                }
                Some(russh::ChannelMsg::Eof) => {
                    logging::warn(
                        "SSH/channel",
                        format!("session {reader_session_id} received EOF"),
                    );
                    break "eof";
                }
                Some(russh::ChannelMsg::Close) => {
                    logging::warn(
                        "SSH/channel",
                        format!("session {reader_session_id} received CLOSE"),
                    );
                    break "close";
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                    logging::warn(
                        "SSH/channel",
                        format!("session {reader_session_id} received exit-status={exit_status}"),
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
                            "session {reader_session_id} received exit-signal={signal_name:?} core_dumped={core_dumped} lang={lang_tag} message={error_message}"
                        ),
                    );
                }
                Some(other) => {
                    logging::info(
                        "SSH/channel",
                        format!("session {reader_session_id} received channel message: {other:?}"),
                    );
                }
                None => {
                    logging::warn(
                        "SSH/channel",
                        format!("session {reader_session_id} channel wait returned None"),
                    );
                    break "channel-none";
                }
            }
        };

        if !reader_close_emitted.swap(true, Ordering::Relaxed) {
            let _ = reader_app.emit(&close_event_name, close_reason);
        }
        reader_sessions.lock().await.remove(&reader_session_id);
        let _ = channel_closed_tx.send(());
    });

    let writer_session_id = session_id.clone();
    let writer_close_emitted = Arc::clone(&close_emitted);
    let writer_sessions = Arc::clone(&state.ssh_sessions);
    tokio::spawn(async move {
        let close_event_name = format!("terminal-close-{writer_session_id}");

        loop {
            tokio::select! {
                _ = &mut channel_closed_rx => {
                    break;
                }
                ctrl = control_rx.recv() => {
                    match ctrl {
                        Some(SshControlMsg::SendData(data)) => {
                            let send_result = tokio::select! {
                                result = channel_writer.data_bytes(data) => result,
                                _ = &mut channel_closed_rx => break,
                            };
                            if let Err(error) = send_result {
                                logging::error(
                                    "SSH/channel",
                                    format!("session {writer_session_id} failed to send data: {error}"),
                                );
                                if !writer_close_emitted.swap(true, Ordering::Relaxed) {
                                    let _ = app.emit(&close_event_name, error.to_string());
                                }
                                writer_sessions.lock().await.remove(&writer_session_id);
                                break;
                            }
                        }
                        Some(SshControlMsg::Resize(cols, rows)) => {
                            if let Err(error) = channel_writer.window_change(cols, rows, 0, 0).await {
                                logging::error(
                                    "SSH/channel",
                                    format!("session {writer_session_id} failed to resize to {cols}x{rows}: {error}"),
                                );
                                if !writer_close_emitted.swap(true, Ordering::Relaxed) {
                                    let _ = app.emit(&close_event_name, error.to_string());
                                }
                                writer_sessions.lock().await.remove(&writer_session_id);
                                break;
                            }
                        }
                        Some(SshControlMsg::Close) => {
                            logging::info(
                                "SSH/channel",
                                format!("session {writer_session_id} closed by local request"),
                            );
                            if !writer_close_emitted.swap(true, Ordering::Relaxed) {
                                let _ = app.emit(&close_event_name, "local-close");
                            }
                            let _ = channel_writer.close().await;
                            break;
                        }
                        None => {
                            logging::warn(
                                "SSH/channel",
                                format!("session {writer_session_id} control channel closed"),
                            );
                            if !writer_close_emitted.swap(true, Ordering::Relaxed) {
                                let _ = app.emit(&close_event_name, "control-closed");
                            }
                            let _ = channel_writer.close().await;
                            break;
                        }
                    }
                }
            }
        }
    });

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
