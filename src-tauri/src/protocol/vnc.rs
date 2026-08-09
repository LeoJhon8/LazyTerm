//! VNC 命令模块
//!
//! 本模块基于 LibVNCClient FFI 实现 VNC 协议支持。

use super::vnc_client::VncClient;
use super::vnc_core::{convert_config, run_vnc_session};
use crate::utils::{log_vnc_error, log_vnc_info, vnc_target_label};
use crate::{
    AppState, VncClipboardPastePayload, VncConnectConfig, VncControlMsg, VncKeySequencePayload,
    VncKeyboardEventPayload, VncPointerEventPayload, VncSession, VncTextInputPayload,
};

use std::sync::Arc;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::mpsc;

const VNC_CONTROL_QUEUE_CAPACITY: usize = 256;

/// 创建 VNC 会话
#[tauri::command]
pub async fn create_vnc_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: String,
    config: VncConnectConfig,
    frame_channel: Channel<Response>,
) -> Result<String, String> {
    if session_id.is_empty()
        || session_id.len() > 64
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("VNC session ID is invalid".to_string());
    }
    if state.vnc_sessions.lock().unwrap().contains_key(&session_id) {
        return Err("VNC session ID already exists".to_string());
    }
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
    let client = VncClient::new(client_config.clone());

    // 建立连接
    let event_receiver = client.connect().await.map_err(|e| {
        let message = format!("VNC connection failed: {e}");
        log_vnc_error(&session_id, &target, "connect", &message);
        message
    })?;

    // 创建控制通道
    let (control_tx, control_rx) = mpsc::channel::<VncControlMsg>(VNC_CONTROL_QUEUE_CAPACITY);

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
            client_config,
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

async fn send_vnc_control(
    state: &AppState,
    session_id: &str,
    control: VncControlMsg,
) -> Result<(), String> {
    let control_tx = {
        let sessions = state.vnc_sessions.lock().unwrap();
        sessions
            .get(session_id)
            .map(|session| session.control_tx.clone())
            .ok_or_else(|| "VNC 会话不存在".to_string())?
    };

    control_tx
        .send(control)
        .await
        .map_err(|error| error.to_string())
}

/// 发送 VNC 鼠标事件
#[tauri::command]
pub async fn send_vnc_pointer(
    state: State<'_, AppState>,
    session_id: String,
    payload: VncPointerEventPayload,
) -> Result<(), String> {
    send_vnc_control(&state, &session_id, VncControlMsg::Pointer(payload)).await
}

/// 发送 VNC 键盘事件
#[tauri::command]
pub async fn send_vnc_key(
    state: State<'_, AppState>,
    session_id: String,
    payload: VncKeyboardEventPayload,
) -> Result<(), String> {
    send_vnc_control(&state, &session_id, VncControlMsg::Key(payload)).await
}

/// 原子发送一组 VNC 组合键，按顺序按下并按相反顺序释放
#[tauri::command]
pub async fn send_vnc_key_sequence(
    state: State<'_, AppState>,
    session_id: String,
    payload: VncKeySequencePayload,
) -> Result<(), String> {
    send_vnc_control(&state, &session_id, VncControlMsg::KeySequence(payload)).await
}

/// 将本机剪贴板文本同步到远端并执行粘贴快捷键
#[tauri::command]
pub async fn paste_vnc_clipboard(
    state: State<'_, AppState>,
    session_id: String,
    payload: VncClipboardPastePayload,
) -> Result<(), String> {
    send_vnc_control(&state, &session_id, VncControlMsg::PasteClipboard(payload)).await
}

/// Types text as VNC key events.
#[tauri::command]
pub async fn type_vnc_text(
    state: State<'_, AppState>,
    session_id: String,
    payload: VncTextInputPayload,
) -> Result<(), String> {
    send_vnc_control(&state, &session_id, VncControlMsg::TypeText(payload)).await
}

/// Requests a VNC refresh.
#[tauri::command]
pub async fn request_vnc_refresh(
    state: State<'_, AppState>,
    session_id: String,
    full: bool,
) -> Result<(), String> {
    send_vnc_control(&state, &session_id, VncControlMsg::Refresh { full }).await
}

/// Requests an ExtendedDesktopSize change when the server advertises support.
#[tauri::command]
pub async fn resize_vnc_session(
    state: State<'_, AppState>,
    session_id: String,
    width: u16,
    height: u16,
) -> Result<(), String> {
    send_vnc_control(&state, &session_id, VncControlMsg::Resize(width, height)).await
}

/// 关闭 VNC 会话
#[tauri::command]
pub async fn close_vnc_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let session = state.vnc_sessions.lock().unwrap().remove(&session_id);
    if let Some(session) = session {
        let _ = session.control_tx.send(VncControlMsg::Close).await;
    }
    Ok(())
}
