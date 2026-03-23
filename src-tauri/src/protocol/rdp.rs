//! RDP 命令模块（从 commands/rdp.rs 迁移）

use crate::{
    AppState, RdpConnectConfig, RdpControlMsg, RdpSession,
    RdpPointerEventPayload, RdpKeyboardEventPayload,
};
use crate::utils::{log_rdp_error, log_rdp_info, rdp_target_label};
use crate::{build_rdp_config, connect_rdp, run_rdp_session};
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
    log_rdp_info(&session_id, &target, "connect", "received open request from frontend");

    let connector_config = build_rdp_config(&config).map_err(|error| {
        log_rdp_error(&session_id, &target, "config", &error);
        error
    })?;
    let (connection_context, framed) =
        connect_rdp(&session_id, &target, connector_config, config.host.clone(), config.port).map_err(|error| {
            log_rdp_error(&session_id, &target, "connect", &error);
            error
        })?;

    let (control_tx, control_rx) = std_mpsc::channel::<RdpControlMsg>();
    state
        .rdp_sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), RdpSession { control_tx });

    log_rdp_info(&session_id, &target, "connect", "session registered in backend state");

    let session_id_clone = session_id.clone();
    let target_clone = target.clone();
    let app_clone = app.clone();
    let rdp_sessions = Arc::clone(&state.rdp_sessions);
    std::thread::spawn(move || {
        match run_rdp_session(
            app_clone.clone(),
            session_id_clone.clone(),
            target_clone.clone(),
            connection_context,
            framed,
            frame_channel,
            control_rx,
        ) {
            Ok(()) => log_rdp_info(&session_id_clone, &target_clone, "close", "session loop ended"),
            Err(error) => log_rdp_error(&session_id_clone, &target_clone, "runtime", &error),
        }
        rdp_sessions.lock().unwrap().remove(&session_id_clone);
        let _ = app_clone.emit(&format!("rdp-close-{}", session_id_clone), ());
    });

    Ok(session_id)
}

/// 发送 RDP 鼠标事件
#[tauri::command]
pub fn send_rdp_pointer(state: State<'_, AppState>, session_id: String, payload: RdpPointerEventPayload) -> Result<(), String> {
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
pub fn send_rdp_key(state: State<'_, AppState>, session_id: String, payload: RdpKeyboardEventPayload) -> Result<(), String> {
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
pub fn resize_rdp_session(state: State<'_, AppState>, session_id: String, width: u16, height: u16) -> Result<(), String> {
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
