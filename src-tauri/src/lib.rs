use async_trait::async_trait;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use russh::client;
use russh_keys::key;
use std::{
    collections::HashMap,
    io::Write,
    sync::{Arc, Mutex as StdMutex},
};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::sync::{mpsc, Mutex as TokioMutex};
use uuid::Uuid;

// --- 数据结构定义 ---

/// SSH 内部控制消息，用于从 Tauri 指令向后台任务发送指令
enum SshControlMsg {
    SendData(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// 本地 PTY 会话结构
struct LocalTerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

/// SSH 会话结构
struct SshTerminalSession {
    // 存储发送器，用于向运行中的 SSH 任务发送数据或调整大小
    control_tx: mpsc::UnboundedSender<SshControlMsg>,
}

/// 全局应用状态
struct AppState {
    local_sessions: Arc<StdMutex<HashMap<String, LocalTerminalSession>>>,
    ssh_sessions: Arc<TokioMutex<HashMap<String, SshTerminalSession>>>,
}

// --- Russh 客户端处理 ---

#[derive(Clone)]
struct Client;

#[async_trait]
impl client::Handler for Client {
    type Error = russh::Error;

    // 适配 russh 0.40 的 check_server_key 签名
    async fn check_server_key(
        self,
        _server_public_key: &key::PublicKey,
    ) -> Result<(Self, bool), Self::Error> {
        Ok((self, true))
    }
}

/// SSH 连接配置
#[derive(serde::Deserialize, Debug)]
pub struct SshConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
}

// --- Tauri 指令实现 ---

/// 1. 创建本地终端 (Portable-PTY)
#[tauri::command]
async fn create_terminal<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let default_shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    };

    let mut cmd = CommandBuilder::new(shell.unwrap_or(default_shell));
    if let Some(path) = cwd {
        cmd.cwd(path);
    }
    for (key, val) in std::env::vars() {
        cmd.env(key, val);
    }

    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let master = pair.master;
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    let session_id_clone = session_id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let event_name = format!("terminal-data-{}", session_id_clone);
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 { break; }
            let data = String::from_utf8_lossy(&buffer[..n]).to_string();
            if app.emit(&event_name, data).is_err() { break; }
        }
    });

    let mut sessions = state.local_sessions.lock().unwrap();
    sessions.insert(session_id.clone(), LocalTerminalSession { master, writer });

    Ok(session_id)
}

/// 2. 创建 SSH 终端 (Russh 异步模式)
#[tauri::command]
async fn create_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: SshConnectConfig,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let ssh_config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", config.host, config.port);

    // 建立连接
    let mut handle = client::connect(ssh_config, addr, Client)
        .await
        .map_err(|e| format!("连接失败: {:?}", e))?;

    // 身份认证
    let auth_success = if let Some(key_path) = config.private_key_path {
        let key_pair = russh_keys::load_secret_key(key_path, None).map_err(|e| e.to_string())?;
        handle.authenticate_publickey(config.username, Arc::new(key_pair)).await.map_err(|e| e.to_string())?
    } else if let Some(password) = config.password {
        handle.authenticate_password(config.username, password).await.map_err(|e| e.to_string())?
    } else {
        return Err("缺少密码或私钥".to_string());
    };

    if !auth_success {
        return Err("SSH 认证失败".to_string());
    }

    // 打开会话和 PTY
    let mut channel = handle.channel_open_session().await.map_err(|e| e.to_string())?;
    channel.request_pty(true, "xterm-256color", 80, 24, 0, 0, &[]).await.map_err(|e| e.to_string())?;
    channel.request_shell(true).await.map_err(|e| e.to_string())?;

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<SshControlMsg>();
    let session_id_clone = session_id.clone();

    // 核心后台循环：处理数据读取与指令写入
    tokio::spawn(async move {
        let event_name = format!("terminal-data-{}", session_id_clone);
        loop {
            tokio::select! {
                // 监听服务器传回的数据
                res = channel.wait() => {
                    match res {
                        Some(russh::ChannelMsg::Data { data }) => {
                            let text = String::from_utf8_lossy(&data).to_string();
                            let _ = app.emit(&event_name, text);
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => break,
                        _ => {}
                    }
                }
                // 监听来自 Tauri 指令的控制请求
                Some(ctrl) = control_rx.recv() => {
                    match ctrl {
                        SshControlMsg::SendData(data) => {
                            let _ = channel.data(&data[..]).await;
                        }
                        SshControlMsg::Resize(cols, rows) => {
                            // 在 Channel 对象上直接调用 window_change，避免 Handle 的泛型推导错误
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        SshControlMsg::Close => {
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
            }
        }
    });

    let mut sessions = state.ssh_sessions.lock().await;
    sessions.insert(session_id.clone(), SshTerminalSession { control_tx });

    Ok(session_id)
}

// --- 数据交互指令 ---

#[tauri::command]
fn write_to_terminal(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    let mut sessions = state.local_sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("会话不存在".to_string())
    }
}

#[tauri::command]
async fn write_to_ssh_session(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(SshControlMsg::SendData(data.into_bytes())).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("会话不存在".to_string())
    }
}

#[tauri::command]
fn resize_terminal(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.local_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_ssh_session(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(SshControlMsg::Resize(cols as u32, rows as u32)).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("会话不存在".to_string())
    }
}

#[tauri::command]
fn close_terminal(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.local_sessions.lock().unwrap();
    sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
async fn close_ssh_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.remove(&session_id) {
        let _ = session.control_tx.send(SshControlMsg::Close);
    }
    Ok(())
}

// --- 入口函数 ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            local_sessions: Arc::new(StdMutex::new(HashMap::new())),
            ssh_sessions: Arc::new(TokioMutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            create_ssh_session,
            write_to_terminal,
            write_to_ssh_session,
            resize_terminal,
            resize_ssh_session,
            close_terminal,
            close_ssh_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}