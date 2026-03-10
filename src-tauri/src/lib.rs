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

/// 用于控制 SSH 后台任务的内部消息
enum SshControlMsg {
    SendData(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// 本地终端会话管理
struct LocalTerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

/// SSH 终端会话管理
struct SshTerminalSession {
    control_tx: mpsc::UnboundedSender<SshControlMsg>,
}

/// 全局应用状态，存储所有活动会话
struct AppState {
    local_sessions: Arc<StdMutex<HashMap<String, LocalTerminalSession>>>,
    ssh_sessions: Arc<TokioMutex<HashMap<String, SshTerminalSession>>>,
}

// --- Russh 客户端回调处理 ---

#[derive(Clone)]
struct Client;

#[async_trait]
impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        println!("收到服务器公钥响应");
        Ok(true)
    }

    async fn disconnected(&mut self, reason: client::DisconnectReason<Self::Error>) -> Result<(), Self::Error> {
        println!("--- SSH 连接已断开: {:?} ---", reason);
        Ok(())
    }
}

/// 前端传入的 SSH 配置
#[derive(serde::Deserialize, Debug)]
pub struct SshConnectConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>, // 如果私钥有密码
}

#[derive(serde::Serialize, Debug)]
pub struct ShellInfo {
    pub name: String,
    pub path: String,
    pub icon_type: String, // 'cmd', 'powershell', 'bash', 'ssh'
}

/// 核心功能：使用 russh-keys 解析多种格式的私钥
fn load_ssh_key(path: &str, passphrase: Option<String>) -> Result<key::KeyPair, String> {
    let key_content = std::fs::read_to_string(path)
        .map_err(|e| format!("无法读取密钥文件: {}", e))?;

    // decode_secret_key 支持: OpenSSH, PKCS#1, PKCS#8 以及多种加密算法
    russh_keys::decode_secret_key(&key_content, passphrase.as_deref())
        .map_err(|e| format!("私钥解析失败: {:?}. 请检查格式或密码。", e))
}

// --- Tauri 指令实现 ---

/// 创建本地终端 (Portable-PTY)
#[tauri::command]
async fn create_terminal<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    cwd: Option<String>,
    shell: Option<String>,
    admin: Option<bool>,
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

    let mut shell_cmd = shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
        }
    });

    // 针对 Windows 特殊处理 'bash' / 'git-bash' 的路径探测
    if cfg!(target_os = "windows") && (shell_cmd == "bash.exe" || shell_cmd == "git-bash" || shell_cmd == "bash") {
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let common_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe".to_string(),
            "C:\\Program Files\\Git\\usr\\bin\\bash.exe".to_string(),
            format!("{}\\AppData\\Local\\Programs\\Git\\bin\\bash.exe", user_profile),
            format!("{}\\AppData\\Local\\Programs\\Git\\usr\\bin\\bash.exe", user_profile),
        ];
        for path in common_paths {
            if std::path::Path::new(&path).exists() {
                shell_cmd = path;
                break;
            }
        }
    }

    let mut cmd = if cfg!(target_os = "windows") && admin.unwrap_or(false) {
        // Windows 11 sudo 默认可能会开新窗口
        // 使用 --inline (或 -e) 尝试在当前控制台会话中运行
        // 注意：这要求用户在 Windows 设置中将 sudo 配置为“内联”或“允许输入”模式
        let mut c = CommandBuilder::new("sudo");
        c.arg("--inline"); 
        c.arg(shell_cmd);
        c
    } else {
        CommandBuilder::new(shell_cmd)
    };

    if let Some(path) = cwd {
        cmd.cwd(path);
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
            let _ = app.emit(&event_name, data);
        }
    });

    state.local_sessions.lock().unwrap().insert(
        session_id.clone(),
        LocalTerminalSession { master, writer },
    );

    Ok(session_id)
}

/// 获取当前系统可用的 Shell 列表
#[tauri::command]
async fn get_available_shells() -> Result<Vec<ShellInfo>, String> {
    let mut shells = Vec::new();

    if cfg!(target_os = "windows") {
        shells.push(ShellInfo { name: "CMD".into(), path: "cmd.exe".into(), icon_type: "cmd".into() });
        shells.push(ShellInfo { name: "PowerShell".into(), path: "powershell.exe".into(), icon_type: "powershell".into() });
        
        // 探测 PowerShell Core
        if std::path::Path::new("C:\\Program Files\\PowerShell\\7\\pwsh.exe").exists() {
            shells.push(ShellInfo { name: "PowerShell 7".into(), path: "pwsh.exe".into(), icon_type: "powershell".into() });
        }

        // 探测 Git Bash
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let git_bash_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe".to_string(),
            format!("{}\\AppData\\Local\\Programs\\Git\\bin\\bash.exe", user_profile),
        ];
        
        for path in git_bash_paths {
            if std::path::Path::new(&path).exists() {
                shells.push(ShellInfo { name: "Git Bash".into(), path: path.into(), icon_type: "bash".into() });
                break;
            }
        }
    } else {
        // macOS / Linux
        let common = ["bash", "zsh", "fish", "sh"];
        for s in common {
            let path = format!("/bin/{}", s);
            let usr_path = format!("/usr/bin/{}", s);
            if std::path::Path::new(&path).exists() {
                shells.push(ShellInfo { name: s.to_uppercase(), path, icon_type: "bash".into() });
            } else if std::path::Path::new(&usr_path).exists() {
                shells.push(ShellInfo { name: s.to_uppercase(), path: usr_path, icon_type: "bash".into() });
            }
        }
    }

    Ok(shells)
}

/// 创建 SSH 终端 (异步全格式支持)
#[tauri::command]
async fn create_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: SshConnectConfig,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    
    // --- 算法兼容性增强设计 ---
    // Ubuntu 24.04 (OpenSSH 9.x) 建议使用默认算法并由系统自动协商
    let mut ssh_config = client::Config::default();
    
    // 使用默认首选列表，包含 ED25519, RSA-SHA2 等
    ssh_config.preferred = russh::Preferred::DEFAULT;

    let ssh_config = Arc::new(ssh_config);
    println!("--- SSH 连接尝试: {}@{}:{} ---", config.username, config.host, config.port);
    let addr = format!("{}:{}", config.host, config.port);

    // 1. 建立连接
    let mut handle = client::connect(ssh_config, addr.clone(), Client)
        .await
        .map_err(|e| {
            println!("网络连接失败 ({}): {:?}", addr, e);
            format!("网络连接失败: {:?}", e)
        })?;
    println!("网络底层连接已建立: {}", addr);

    // 2. 身份认证流程
    let mut authenticated = false;

    // 优先尝试私钥认证
    if let Some(key_path) = config.private_key_path {
        println!("尝试私钥认证: {}", key_path);
        let key_pair = load_ssh_key(&key_path, config.private_key_passphrase)?;
        match handle.authenticate_publickey(config.username.clone(), Arc::new(key_pair)).await {
            Ok(true) => {
                println!("私钥认证成功");
                authenticated = true;
            }
            Ok(false) => println!("服务器拒绝了私钥认证"),
            Err(e) => println!("私钥认证过程出错: {:?}", e),
        }
    }

    // 如果认证未成功，尝试密码
    if !authenticated {
        if let Some(password) = config.password.clone() {
            // 2.a 尝试 Keyboard-Interactive (优先走交互，避免“污染”会话)
            println!("开始认证交互 (尝试 Keyboard-Interactive 模式)...");
            
            // 给服务器一点喘息时间
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;

            // 启动交互流程
            let kbd_start_res = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                handle.authenticate_keyboard_interactive_start(config.username.clone(), None)
            ).await;

            let kbd_start_enum = match kbd_start_res {
                Ok(Ok(res)) => Some(res),
                _ => None, // 超时或底层错误
            };

            let mut kbd_authenticated = false;
            let mut should_fallback_to_password = false;

            if let Some(res) = kbd_start_enum {
                let mut current_kbd_res = Ok(res);
                // 处理交互循环
                for i in 0..5 {
                    match current_kbd_res {
                        Ok(client::KeyboardInteractiveAuthResponse::Success) => {
                            println!("Keyboard-Interactive 认证成功！");
                            kbd_authenticated = true;
                            break;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, name, .. }) => {
                            println!("收到交互请求 (轮次 {}): Name='{}', Prompts={}", i + 1, name, prompts.len());
                            let mut responses = Vec::new();
                            for p in prompts.iter() {
                                responses.push(password.clone());
                            }
                            current_kbd_res = handle.authenticate_keyboard_interactive_respond(responses).await;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::Failure) => {
                            println!("Keyboard-Interactive 被服务器显式拒绝，切换为标准密码认证...");
                            should_fallback_to_password = true;
                            break;
                        }
                        Err(e) => {
                            println!("Keyboard-Interactive 流程错误: {:?}", e);
                            should_fallback_to_password = true;
                            break;
                        }
                    }
                }
            } else {
                println!("Keyboard-Interactive 启动失败或超时，尝试标准密码认证...");
                should_fallback_to_password = true;
            }

            if kbd_authenticated {
                authenticated = true;
            } else if should_fallback_to_password {
                // 2.b 如果 KBI 被拒绝或不支持，尝试标准密码认证 (RFC 4252)
                println!("开始尝试直接密码认证 (Password Authentication)...");
                match handle.authenticate_password(config.username.clone(), password).await {
                    Ok(true) => {
                        println!("标准密码认证成功");
                        authenticated = true;
                    }
                    Ok(false) => println!("标准密码认证也被服务器拒绝"),
                    Err(e) => println!("标准密码认证出错: {:?}", e),
                }
            }
        }
    }

    if !authenticated {
        println!("所有认证方式均已尝试，认证失败。");
        return Err("SSH 认证失败：密钥或密码错误".to_string());
    }
    println!("认证通过，正在初始化会话通道...");

    // 3. 打开 Channel 并请求 PTY
    let mut channel = handle.channel_open_session().await.map_err(|e| e.to_string())?;
    channel.request_pty(true, "xterm-256color", 80, 24, 0, 0, &[]).await.map_err(|e| e.to_string())?;
    channel.request_shell(true).await.map_err(|e| e.to_string())?;

    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<SshControlMsg>();
    let session_id_clone = session_id.clone();

    // 4. 后台任务：处理 SSH 双向数据流
    tokio::spawn(async move {
        let event_name = format!("terminal-data-{}", session_id_clone);
        let close_event_name = format!("terminal-close-{}", session_id_clone);
        loop {
            tokio::select! {
                // 读取远程服务器输出
                msg = channel.wait() => {
                    match msg {
                        Some(russh::ChannelMsg::Data { data }) => {
                            let _ = app.emit(&event_name, String::from_utf8_lossy(&data).to_string());
                        }
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                            // 发送连接关闭事件
                            let _ = app.emit(&close_event_name, ());
                            break;
                        }
                        _ => {}
                    }
                }
                // 处理本地控制请求
                Some(ctrl) = control_rx.recv() => {
                    match ctrl {
                        SshControlMsg::SendData(data) => { let _ = channel.data(&data[..]).await; }
                        SshControlMsg::Resize(cols, rows) => { let _ = channel.window_change(cols, rows, 0, 0).await; }
                        SshControlMsg::Close => { 
                            let _ = app.emit(&close_event_name, ());
                            let _ = channel.close().await; 
                            break; 
                        }
                    }
                }
            }
        }
    });

    state.ssh_sessions.lock().await.insert(
        session_id.clone(),
        SshTerminalSession { control_tx },
    );

    Ok(session_id)
}

// --- 通用交互指令 ---

#[tauri::command]
fn write_to_terminal(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    let mut sessions = state.local_sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("本地会话不存在".to_string())
    }
}

#[tauri::command]
async fn write_to_ssh_session(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session.control_tx.send(SshControlMsg::SendData(data.into_bytes())).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("SSH会话不存在".to_string())
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
    }
    Ok(())
}

#[tauri::command]
fn close_terminal(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.local_sessions.lock().unwrap().remove(&session_id);
    Ok(())
}

#[tauri::command]
async fn close_ssh_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.ssh_sessions.lock().await.remove(&session_id) {
        let _ = session.control_tx.send(SshControlMsg::Close);
    }
    Ok(())
}

// --- 程序入口 ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init()) // 👈 添加这一行
        .plugin(tauri_plugin_dialog::init()) // <--- 添加这一行
        .manage(AppState {
            local_sessions: Arc::new(StdMutex::new(HashMap::new())),
            ssh_sessions: Arc::new(TokioMutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            get_available_shells,
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