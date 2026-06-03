//! RDP 命令模块（从 commands/rdp.rs 迁移）

use super::{build_rdp_config, connect_rdp, run_rdp_session};
use crate::utils::{log_rdp_error, log_rdp_info, rdp_target_label};
use crate::{
    AppState, RdpConnectConfig, RdpControlMsg, RdpKeyboardEventPayload, RdpPointerEventPayload,
    RdpSession,
};
use std::sync::{mpsc as std_mpsc, Arc};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

/// 创建 RDP 会话
#[tauri::command]
pub async fn create_rdp_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: RdpConnectConfig,
    frame_channel: Channel<Response>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let target = rdp_target_label(&config);
    log_rdp_info(
        &session_id,
        &target,
        "connect",
        "received open request from frontend",
    );

    let connector_config = build_rdp_config(&config).map_err(|error| {
        log_rdp_error(&session_id, &target, "config", &error);
        error
    })?;
    let (control_tx, control_rx) = std_mpsc::channel::<RdpControlMsg>();
    let (start_tx, start_rx) = std_mpsc::channel::<Result<(), String>>();
    state
        .rdp_sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), RdpSession { control_tx });

    log_rdp_info(
        &session_id,
        &target,
        "connect",
        "session registered in backend state",
    );

    let session_id_clone = session_id.clone();
    let target_clone = target.clone();
    let host = config.host.clone();
    let port = config.port;
    let app_clone = app.clone();
    let rdp_sessions = Arc::clone(&state.rdp_sessions);
    std::thread::spawn(move || {
        let run_result = match connect_rdp(
            &session_id_clone,
            &target_clone,
            connector_config,
            host,
            port,
        ) {
            Ok(client) => {
                let _ = start_tx.send(Ok(()));
                run_rdp_session(
                    app_clone.clone(),
                    session_id_clone.clone(),
                    target_clone.clone(),
                    client,
                    frame_channel,
                    control_rx,
                )
            }
            Err(error) => {
                let _ = start_tx.send(Err(error.clone()));
                Err(error)
            }
        };

        match run_result {
            Ok(()) => log_rdp_info(
                &session_id_clone,
                &target_clone,
                "close",
                "session loop ended",
            ),
            Err(error) => log_rdp_error(&session_id_clone, &target_clone, "runtime", &error),
        }
        rdp_sessions.lock().unwrap().remove(&session_id_clone);
        let _ = app_clone.emit(&format!("rdp-close-{}", session_id_clone), ());
    });

    match start_rx.recv() {
        Ok(Ok(())) => Ok(session_id),
        Ok(Err(error)) => {
            log_rdp_error(&session_id, &target, "connect", &error);
            Err(error)
        }
        Err(error) => {
            let message = format!("RDP session thread exited before connect result: {error}");
            log_rdp_error(&session_id, &target, "connect", &message);
            Err(message)
        }
    }
}

/// 发送 RDP 鼠标事件
#[tauri::command]
pub fn send_rdp_pointer(
    state: State<'_, AppState>,
    session_id: String,
    payload: RdpPointerEventPayload,
) -> Result<(), String> {
    let sessions = state.rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(RdpControlMsg::Pointer(payload))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RDP 会话不存在".to_string())
    }
}

/// 发送 RDP 键盘事件
#[tauri::command]
pub fn send_rdp_key(
    state: State<'_, AppState>,
    session_id: String,
    payload: RdpKeyboardEventPayload,
) -> Result<(), String> {
    let sessions = state.rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(RdpControlMsg::Key(payload))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RDP 会话不存在".to_string())
    }
}

/// 释放所有 RDP 输入
#[tauri::command]
pub fn release_rdp_inputs(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let sessions = state.rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(RdpControlMsg::ReleaseAll)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RDP 会话不存在".to_string())
    }
}

/// 调整 RDP 会话分辨率
#[tauri::command]
pub fn resize_rdp_session(
    state: State<'_, AppState>,
    session_id: String,
    width: u16,
    height: u16,
) -> Result<(), String> {
    let sessions = state.rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(RdpControlMsg::Resize(width, height))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("RDP 会话不存在".to_string())
    }
}

/// 关闭 RDP 会话
#[tauri::command]
pub fn close_rdp_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.rdp_sessions.lock().unwrap().remove(&session_id) {
        let _ = session.control_tx.send(RdpControlMsg::Close);
    }
    Ok(())
}
