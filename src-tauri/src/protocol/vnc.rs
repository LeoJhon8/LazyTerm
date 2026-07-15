//! VNC 命令模块
//!
//! 本模块基于 LibVNCClient FFI 实现 VNC 协议支持。

use super::vnc_client::VncClient;
use super::vnc_core::{convert_config, run_vnc_session};
use crate::utils::{log_vnc_error, log_vnc_info, vnc_target_label};
use crate::{
    AppState, VncClipboardPastePayload, VncConnectConfig, VncControlMsg, VncKeyboardEventPayload,
    VncPointerEventPayload, VncSession,
};

use std::sync::Arc;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::mpsc;
use uuid::Uuid;

/// 创建 VNC 会话
#[tauri::command]
pub async fn create_vnc_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: VncConnectConfig,
    frame_channel: Channel<Response>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let target = vnc_target_label(&config);
    log_vnc_info(
        &session_id,
        &target,
        "connect",
        "received open request from frontend",
    );

    // 转换为 LibVNCClient 配置
    let client_config = convert_config(&config);

    // 创建 VNC 客户端
    let client = VncClient::new(client_config);

    // 建立连接
    let event_receiver = client.connect().await.map_err(|e| {
        let message = format!("VNC connection failed: {e}");
        log_vnc_error(&session_id, &target, "connect", &message);
        message
    })?;

    // 创建控制通道
    let (control_tx, control_rx) = mpsc::unbounded_channel::<VncControlMsg>();

    // 存储会话
    state
        .vnc_sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), VncSession { control_tx });

    // 启动会话循环
    let session_id_clone = session_id.clone();
    let target_clone = target.clone();
    let app_clone = app.clone();
    let vnc_sessions = Arc::clone(&state.vnc_sessions);
    let jpeg_quality = config.quality.unwrap_or(super::vnc_core::VNC_JPEG_QUALITY);
    let view_only = config.view_only.unwrap_or(false);

    tokio::spawn(async move {
        match run_vnc_session(
            app_clone.clone(),
            session_id_clone.clone(),
            target_clone.clone(),
            client,
            event_receiver,
            frame_channel,
            control_rx,
            jpeg_quality,
            view_only,
        )
        .await
        {
            Ok(()) => log_vnc_info(
                &session_id_clone,
                &target_clone,
                "close",
                "session loop ended",
            ),
            Err(error) => log_vnc_error(&session_id_clone, &target_clone, "runtime", &error),
        }

        // 清理会话
        vnc_sessions.lock().unwrap().remove(&session_id_clone);
        let _ = app_clone.emit(&format!("vnc-close-{}", session_id_clone), ());
    });

    Ok(session_id)
}

/// 发送 VNC 鼠标事件
#[tauri::command]
pub fn send_vnc_pointer(
    state: State<'_, AppState>,
    session_id: String,
    payload: VncPointerEventPayload,
) -> Result<(), String> {
    let sessions = state.vnc_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(VncControlMsg::Pointer(payload))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("VNC 会话不存在".to_string())
    }
}

/// 发送 VNC 键盘事件
#[tauri::command]
pub fn send_vnc_key(
    state: State<'_, AppState>,
    session_id: String,
    payload: VncKeyboardEventPayload,
) -> Result<(), String> {
    let sessions = state.vnc_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(VncControlMsg::Key(payload))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("VNC 会话不存在".to_string())
    }
}

/// 将本机剪贴板文本同步到远端并执行粘贴快捷键
#[tauri::command]
pub fn paste_vnc_clipboard(
    state: State<'_, AppState>,
    session_id: String,
    payload: VncClipboardPastePayload,
) -> Result<(), String> {
    let sessions = state.vnc_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(VncControlMsg::PasteClipboard(payload))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("VNC 会话不存在".to_string())
    }
}

/// 请求 VNC 刷新
#[tauri::command]
pub fn request_vnc_refresh(
    state: State<'_, AppState>,
    session_id: String,
    _full: bool,
) -> Result<(), String> {
    let sessions = state.vnc_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(VncControlMsg::Refresh)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("VNC 会话不存在".to_string())
    }
}

/// 关闭 VNC 会话
#[tauri::command]
pub fn close_vnc_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.vnc_sessions.lock().unwrap().remove(&session_id) {
        let _ = session.control_tx.send(VncControlMsg::Close);
    }
    Ok(())
}
