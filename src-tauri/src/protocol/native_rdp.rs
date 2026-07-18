use crate::{AppState, NativeHostRect, RdpConnectConfig};
use std::sync::mpsc as std_mpsc;
use tauri::{AppHandle, Emitter, Runtime, State};

#[cfg(windows)]
use crate::utils::create_hidden_command;
#[cfg(windows)]
use crate::{rdp_target_label, NativeRdpTraceEventPayload};
#[cfg(windows)]
use std::io::Write;
#[cfg(windows)]
use std::process::Stdio;
#[cfg(windows)]
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(windows)]
use tauri::Manager;
#[cfg(windows)]
use uuid::Uuid;

#[cfg(windows)]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

#[derive(Debug, Clone)]
pub struct NativeRdpSession {
    pub(crate) mounted_rect: Option<NativeHostRect>,
    pub(crate) visible: bool,
    pub(crate) control_tx: std_mpsc::Sender<NativeRdpSidecarCommand>,
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
struct NativeRdpSidecarInitPayload {
    session_id: String,
    parent_hwnd: i64,
    title: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    domain: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
struct NativeRdpSidecarInboundMessage {
    r#type: String,
    init: Option<NativeRdpSidecarInitPayload>,
    rect: Option<NativeHostRect>,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
struct NativeRdpSidecarOutboundMessage {
    r#type: String,
    detail: Option<String>,
    rect: Option<NativeHostRect>,
}

#[derive(Debug, Clone)]
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) enum NativeRdpSidecarCommand {
    Mount(NativeHostRect),
    Show,
    Hide,
    Focus,
    Close,
}

#[cfg(windows)]
fn native_rdp_sidecar_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("msrdpax-host/msrdpax-host.exe"));
    }

    candidates.extend([
        manifest_dir.join("native/msrdpax-host/publish/win-x64/msrdpax-host.exe"),
        manifest_dir.join("native/msrdpax-host/bin/Release/net8.0-windows/msrdpax-host.exe"),
        manifest_dir.join("native/msrdpax-host/bin/Debug/net8.0-windows/msrdpax-host.exe"),
        manifest_dir.join("native/msrdpax-host/bin/Release/net9.0-windows/msrdpax-host.exe"),
        manifest_dir.join("native/msrdpax-host/bin/Debug/net9.0-windows/msrdpax-host.exe"),
    ]);

    candidates.into_iter().find(|path| path.exists())
}

#[cfg(windows)]
fn emit_native_rdp_state<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    state: &str,
    detail: Option<String>,
    rect: Option<NativeHostRect>,
) {
    let _ = app.emit(
        &format!("native-rdp-state-{}", session_id),
        crate::NativeRdpStateEventPayload {
            state: state.to_string(),
            detail,
            rect,
        },
    );
}

#[cfg(not(windows))]
fn emit_native_rdp_state<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    state: &str,
    detail: Option<String>,
    rect: Option<NativeHostRect>,
) {
    let _ = app;
    let _ = session_id;
    let _ = state;
    let _ = detail;
    let _ = rect;
}

#[cfg(windows)]
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn emit_native_rdp_trace<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    level: &str,
    stage: &str,
    message: impl Into<String>,
    extra: Option<String>,
) {
    let message = message.into();
    let extra_text = extra.clone().unwrap_or_default();
    let line = if extra_text.is_empty() {
        format!("[NATIVE-RDP][{level}][{session_id}][{stage}] {message}")
    } else {
        format!("[NATIVE-RDP][{level}][{session_id}][{stage}] {message} | {extra_text}")
    };

    match level {
        "error" => crate::logging::error("NATIVE-RDP", line.clone()),
        "warn" => crate::logging::warn("NATIVE-RDP", line.clone()),
        _ => crate::logging::info("NATIVE-RDP", line.clone()),
    }

    let _ = app.emit(
        &format!("native-rdp-trace-{}", session_id),
        NativeRdpTraceEventPayload {
            timestamp_ms: now_millis(),
            level: level.to_string(),
            stage: stage.to_string(),
            message,
            extra,
        },
    );
}

#[cfg(not(windows))]
fn emit_native_rdp_trace<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    level: &str,
    stage: &str,
    message: impl Into<String>,
    extra: Option<String>,
) {
    let _ = app;
    let _ = session_id;
    let _ = level;
    let _ = stage;
    let _ = message.into();
    let _ = extra;
}

#[cfg(windows)]
fn main_window_hwnd<R: Runtime>(app: &AppHandle<R>) -> Result<i64, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不存在，无法挂载 MsTscAx sidecar。".to_string())?;
    let raw_handle: RawWindowHandle = window
        .window_handle()
        .map_err(|e| format!("获取主窗口窗口句柄失败: {e}"))?
        .into();

    match raw_handle {
        RawWindowHandle::Win32(handle) => Ok(handle.hwnd.get() as i64),
        other => Err(format!(
            "主窗口不是 Win32 句柄，无法挂载 MsTscAx sidecar: {other:?}"
        )),
    }
}

#[cfg(windows)]
fn send_native_rdp_sidecar_message(
    writer: &mut std::io::BufWriter<std::process::ChildStdin>,
    message: &NativeRdpSidecarInboundMessage,
) -> Result<(), String> {
    let line = serde_json::to_string(message)
        .map_err(|e| format!("序列化 native RDP sidecar 消息失败: {e}"))?;
    writer
        .write_all(line.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush())
        .map_err(|e| format!("发送 native RDP sidecar 消息失败: {e}"))
}

#[cfg(windows)]
fn spawn_native_rdp_sidecar<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    config: &RdpConnectConfig,
    title: String,
    control_rx: std_mpsc::Receiver<NativeRdpSidecarCommand>,
) -> Result<(), String> {
    emit_native_rdp_trace(
        &app,
        &session_id,
        "info",
        "rust.spawn.start",
        "开始创建 msrdpax sidecar 进程",
        Some(format!(
            "target={}:{} user={}",
            config.host, config.port, config.username
        )),
    );

    let sidecar_path = native_rdp_sidecar_path(&app).ok_or_else(|| {
        "未找到 msrdpax-host.exe。打包版本应包含 msrdpax-host 资源；开发环境请先执行 npm run build:msrdpax-sidecar:debug 或 npm run build:msrdpax-sidecar:release。".to_string()
    })?;

    emit_native_rdp_trace(
        &app,
        &session_id,
        "info",
        "rust.spawn.sidecar_path",
        "已解析 sidecar 可执行文件路径",
        Some(sidecar_path.display().to_string()),
    );

    let parent_hwnd = main_window_hwnd(&app)?;

    emit_native_rdp_trace(
        &app,
        &session_id,
        "info",
        "rust.spawn.parent_hwnd",
        "已获取主窗口 HWND",
        Some(parent_hwnd.to_string()),
    );

    let mut child = create_hidden_command(&sidecar_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 msrdpax sidecar 失败: {e}"))?;

    emit_native_rdp_trace(
        &app,
        &session_id,
        "info",
        "rust.spawn.started",
        "sidecar 进程已启动",
        Some(format!("pid={}", child.id())),
    );

    let child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法获取 msrdpax sidecar stdin。".to_string())?;
    let child_stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 msrdpax sidecar stdout。".to_string())?;
    let child_stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 msrdpax sidecar stderr。".to_string())?;

    let app_for_stdout = app.clone();
    let session_for_stdout = session_id.clone();
    std::thread::spawn(move || {
        emit_native_rdp_trace(
            &app_for_stdout,
            &session_for_stdout,
            "info",
            "rust.stdout.thread",
            "stdout 监听线程已启动",
            None,
        );
        let reader = std::io::BufReader::new(child_stdout);
        use std::io::BufRead as _;
        for line in reader.lines() {
            let Ok(line) = line else { break };
            emit_native_rdp_trace(
                &app_for_stdout,
                &session_for_stdout,
                "info",
                "sidecar.stdout.raw",
                "收到 sidecar stdout 行",
                Some(line.clone()),
            );
            match serde_json::from_str::<NativeRdpSidecarOutboundMessage>(&line) {
                Ok(message) => {
                    let state_type = message.r#type.clone();
                    let detail_for_trace = message.detail.clone();
                    let rect_for_trace = message.rect.clone();
                    emit_native_rdp_trace(
                        &app_for_stdout,
                        &session_for_stdout,
                        "info",
                        "sidecar.stdout.decoded",
                        format!("解析 sidecar 消息成功: type={state_type}"),
                        detail_for_trace,
                    );
                    emit_native_rdp_state(
                        &app_for_stdout,
                        &session_for_stdout,
                        &state_type,
                        message.detail,
                        message.rect,
                    );
                    if let Some(rect) = rect_for_trace {
                        emit_native_rdp_trace(
                            &app_for_stdout,
                            &session_for_stdout,
                            "info",
                            "sidecar.stdout.rect",
                            "sidecar 消息包含挂载矩形",
                            Some(format!(
                                "x={} y={} w={} h={} scale={}",
                                rect.x, rect.y, rect.width, rect.height, rect.scale_factor
                            )),
                        );
                    }
                }
                Err(error) => {
                    emit_native_rdp_trace(
                        &app_for_stdout,
                        &session_for_stdout,
                        "error",
                        "sidecar.stdout.decode_error",
                        format!("解析 sidecar stdout 失败: {error}"),
                        Some(line.clone()),
                    );
                    emit_native_rdp_state(
                        &app_for_stdout,
                        &session_for_stdout,
                        "error",
                        Some(format!(
                            "解析 msrdpax sidecar 输出失败: {error}; raw={line}"
                        )),
                        None,
                    )
                }
            }
        }
        emit_native_rdp_trace(
            &app_for_stdout,
            &session_for_stdout,
            "warn",
            "rust.stdout.thread_end",
            "stdout 监听线程结束，触发 native-rdp-close",
            None,
        );
        let _ = app_for_stdout.emit(&format!("native-rdp-close-{}", session_for_stdout), ());
    });

    let app_for_stderr = app.clone();
    let session_for_stderr = session_id.clone();
    std::thread::spawn(move || {
        emit_native_rdp_trace(
            &app_for_stderr,
            &session_for_stderr,
            "info",
            "rust.stderr.thread",
            "stderr 监听线程已启动",
            None,
        );
        let reader = std::io::BufReader::new(child_stderr);
        use std::io::BufRead as _;
        for line in reader.lines() {
            let Ok(line) = line else { break };
            emit_native_rdp_trace(
                &app_for_stderr,
                &session_for_stderr,
                "error",
                "sidecar.stderr.raw",
                "收到 sidecar stderr 行",
                Some(line.clone()),
            );
            emit_native_rdp_state(
                &app_for_stderr,
                &session_for_stderr,
                "error",
                Some(format!("msrdpax sidecar stderr: {line}")),
                None,
            );
        }
        emit_native_rdp_trace(
            &app_for_stderr,
            &session_for_stderr,
            "warn",
            "rust.stderr.thread_end",
            "stderr 监听线程结束",
            None,
        );
    });

    let init_message = NativeRdpSidecarInboundMessage {
        r#type: "init".to_string(),
        init: Some(NativeRdpSidecarInitPayload {
            session_id: session_id.clone(),
            parent_hwnd,
            title,
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            password: config.password.clone(),
            domain: config.domain.clone(),
            width: None,
            height: None,
        }),
        rect: None,
    };

    let app_for_control = app.clone();
    let session_for_control = session_id.clone();
    std::thread::spawn(move || {
        emit_native_rdp_trace(
            &app_for_control,
            &session_for_control,
            "info",
            "rust.control.thread",
            "control 下发线程已启动",
            None,
        );
        let mut writer = std::io::BufWriter::new(child_stdin);
        emit_native_rdp_trace(
            &app_for_control,
            &session_for_control,
            "info",
            "rust.control.init_send",
            "准备发送 init 消息给 sidecar",
            None,
        );
        if let Err(error) = send_native_rdp_sidecar_message(&mut writer, &init_message) {
            emit_native_rdp_trace(
                &app_for_control,
                &session_for_control,
                "error",
                "rust.control.init_send_error",
                "发送 init 消息失败",
                Some(error.clone()),
            );
            emit_native_rdp_state(
                &app_for_control,
                &session_for_control,
                "error",
                Some(error),
                None,
            );
            return;
        }
        emit_native_rdp_trace(
            &app_for_control,
            &session_for_control,
            "info",
            "rust.control.init_sent",
            "init 消息发送成功",
            None,
        );

        for command in control_rx {
            let (message, stage) = match command {
                NativeRdpSidecarCommand::Mount(rect) => (
                    NativeRdpSidecarInboundMessage {
                        r#type: "mount".to_string(),
                        init: None,
                        rect: Some(rect),
                    },
                    "rust.control.mount",
                ),
                NativeRdpSidecarCommand::Show => (
                    NativeRdpSidecarInboundMessage {
                        r#type: "show".to_string(),
                        init: None,
                        rect: None,
                    },
                    "rust.control.show",
                ),
                NativeRdpSidecarCommand::Hide => (
                    NativeRdpSidecarInboundMessage {
                        r#type: "hide".to_string(),
                        init: None,
                        rect: None,
                    },
                    "rust.control.hide",
                ),
                NativeRdpSidecarCommand::Focus => (
                    NativeRdpSidecarInboundMessage {
                        r#type: "focus".to_string(),
                        init: None,
                        rect: None,
                    },
                    "rust.control.focus",
                ),
                NativeRdpSidecarCommand::Close => {
                    let message = NativeRdpSidecarInboundMessage {
                        r#type: "close".to_string(),
                        init: None,
                        rect: None,
                    };
                    emit_native_rdp_trace(
                        &app_for_control,
                        &session_for_control,
                        "info",
                        "rust.control.close",
                        "收到 close 指令，准备发送 close 消息",
                        None,
                    );
                    let _ = send_native_rdp_sidecar_message(&mut writer, &message);
                    emit_native_rdp_trace(
                        &app_for_control,
                        &session_for_control,
                        "warn",
                        "rust.control.thread_end",
                        "close 消息已发送，control 线程结束",
                        None,
                    );
                    break;
                }
            };

            if let Some(rect) = message.rect.clone() {
                emit_native_rdp_trace(
                    &app_for_control,
                    &session_for_control,
                    "info",
                    stage,
                    "准备发送控制消息",
                    Some(format!(
                        "type={} x={} y={} w={} h={} scale={}",
                        message.r#type, rect.x, rect.y, rect.width, rect.height, rect.scale_factor
                    )),
                );
            } else {
                emit_native_rdp_trace(
                    &app_for_control,
                    &session_for_control,
                    "info",
                    stage,
                    format!("准备发送控制消息: type={}", message.r#type),
                    None,
                );
            }

            if let Err(error) = send_native_rdp_sidecar_message(&mut writer, &message) {
                emit_native_rdp_trace(
                    &app_for_control,
                    &session_for_control,
                    "error",
                    "rust.control.send_error",
                    "发送控制消息失败",
                    Some(error.clone()),
                );
                emit_native_rdp_state(
                    &app_for_control,
                    &session_for_control,
                    "error",
                    Some(error),
                    message.rect,
                );
                break;
            }

            emit_native_rdp_trace(
                &app_for_control,
                &session_for_control,
                "info",
                "rust.control.sent",
                format!("控制消息发送成功: type={}", message.r#type),
                None,
            );
        }

        emit_native_rdp_trace(
            &app_for_control,
            &session_for_control,
            "warn",
            "rust.control.loop_end",
            "control 指令通道已结束",
            None,
        );
    });

    Ok(())
}

#[tauri::command]
pub fn create_native_rdp_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: RdpConnectConfig,
) -> Result<String, String> {
    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = state;
        let _ = config;
        return Err("MsTscAx 原生宿主当前仅支持 Windows。".to_string());
    }

    #[cfg(windows)]
    {
        let session_id = Uuid::new_v4().to_string();
        emit_native_rdp_trace(
            &app,
            &session_id,
            "info",
            "rust.command.create_native_rdp_session",
            "收到 create_native_rdp_session 命令",
            Some(format!(
                "target={}:{} user={}",
                config.host, config.port, config.username
            )),
        );
        let (control_tx, control_rx) = std_mpsc::channel::<NativeRdpSidecarCommand>();
        spawn_native_rdp_sidecar(
            app.clone(),
            session_id.clone(),
            &config,
            rdp_target_label(&config),
            control_rx,
        )?;

        state.native_rdp_sessions.lock().unwrap().insert(
            session_id.clone(),
            NativeRdpSession {
                mounted_rect: None,
                visible: false,
                control_tx,
            },
        );

        Ok(session_id)
    }
}

#[tauri::command]
pub fn mount_native_rdp_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: String,
    rect: NativeHostRect,
) -> Result<(), String> {
    let mut sessions = state.native_rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.mounted_rect = Some(rect.clone());
        emit_native_rdp_trace(
            &app,
            &session_id,
            "info",
            "rust.command.mount_native_rdp_session",
            "收到 mount 请求，准备转发给 sidecar",
            Some(format!(
                "x={} y={} w={} h={} scale={}",
                rect.x, rect.y, rect.width, rect.height, rect.scale_factor
            )),
        );
        session
            .control_tx
            .send(NativeRdpSidecarCommand::Mount(rect))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        emit_native_rdp_trace(
            &app,
            &session_id,
            "error",
            "rust.command.mount_native_rdp_session",
            "会话不存在，无法 mount",
            None,
        );
        Err("Native RDP 会话不存在".to_string())
    }
}

#[tauri::command]
pub fn set_native_rdp_session_visible<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: String,
    visible: bool,
) -> Result<(), String> {
    let mut sessions = state.native_rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.visible = visible;
        emit_native_rdp_trace(
            &app,
            &session_id,
            "info",
            "rust.command.set_native_rdp_session_visible",
            if visible {
                "收到 visible=true 请求"
            } else {
                "收到 visible=false 请求"
            },
            None,
        );
        session
            .control_tx
            .send(if visible {
                NativeRdpSidecarCommand::Show
            } else {
                NativeRdpSidecarCommand::Hide
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        emit_native_rdp_trace(
            &app,
            &session_id,
            "error",
            "rust.command.set_native_rdp_session_visible",
            "会话不存在，无法设置可见性",
            Some(format!("visible={visible}")),
        );
        Err("Native RDP 会话不存在".to_string())
    }
}

#[tauri::command]
pub fn focus_native_rdp_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let sessions = state.native_rdp_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        emit_native_rdp_trace(
            &app,
            &session_id,
            "info",
            "rust.command.focus_native_rdp_session",
            "收到 focus 请求",
            None,
        );
        session
            .control_tx
            .send(NativeRdpSidecarCommand::Focus)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        emit_native_rdp_trace(
            &app,
            &session_id,
            "error",
            "rust.command.focus_native_rdp_session",
            "会话不存在，无法 focus",
            None,
        );
        Err("Native RDP 会话不存在".to_string())
    }
}

#[tauri::command]
pub fn close_native_rdp_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let removed = state
        .native_rdp_sessions
        .lock()
        .unwrap()
        .remove(&session_id);
    if let Some(session) = removed {
        emit_native_rdp_trace(
            &app,
            &session_id,
            "warn",
            "rust.command.close_native_rdp_session",
            "收到 close 请求，准备结束会话",
            None,
        );
        let _ = session.control_tx.send(NativeRdpSidecarCommand::Close);
        emit_native_rdp_state(
            &app,
            &session_id,
            "closed",
            Some("Native RDP 原生宿主会话已关闭。".to_string()),
            None,
        );
        let _ = app.emit(&format!("native-rdp-close-{}", session_id), ());
    }
    Ok(())
}
