use crate::{
    build_rdp_config, connect_rdp, load_ssh_key, log_rdp_error, log_rdp_info, map_sftp_error,
    log_vnc_error, log_vnc_info, rdp_target_label, run_rdp_session, run_vnc_session, vnc_target_label,
    AppState, Client, LocalTerminalSession, RdpConnectConfig, VncConnectConfig,
    RdpControlMsg, RdpKeyboardEventPayload, RdpPointerEventPayload, RdpSession, ShellInfo,
    SftpUploadCancelGuard, SftpUploadItem, SftpUploadProgress, SshConnectConfig, SshControlMsg,
    SshTerminalSession, VncControlMsg, VncKeyboardEventPayload, VncPointerEventPayload, VncSession,
};
use crate::logging;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use russh::client;
use russh_sftp::client::SftpSession;
use std::io::{Read as _, Write};
use std::path::Path;
use std::sync::{mpsc as std_mpsc, Arc};
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream as TokioTcpStream;
use tokio::sync::mpsc;
use uuid::Uuid;
use vnc::{PixelFormat as VncPixelFormat, VncConnector as RustVncConnector, VncEncoding, VncError as RustVncError};

#[tauri::command]
pub async fn create_terminal<R: Runtime>(
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
    let local_sessions = state.local_sessions.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let event_name = format!("terminal-data-{}", session_id_clone);
        let close_event_name = format!("terminal-close-{}", session_id_clone);
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            let data = String::from_utf8_lossy(&buffer[..n]).to_string();
            let _ = app.emit(&event_name, data);
        }

        let should_emit_close = local_sessions.lock().unwrap().remove(&session_id_clone).is_some();
        if should_emit_close {
            let _ = app.emit(&close_event_name, ());
        }
    });

    state.local_sessions.lock().unwrap().insert(
        session_id.clone(),
        LocalTerminalSession { master, writer },
    );

    Ok(session_id)
}

#[tauri::command]
pub async fn get_available_shells() -> Result<Vec<ShellInfo>, String> {
    let mut shells = Vec::new();

    if cfg!(target_os = "windows") {
        shells.push(ShellInfo { name: "CMD".into(), path: "cmd.exe".into(), icon_type: "cmd".into() });
        shells.push(ShellInfo { name: "PowerShell".into(), path: "powershell.exe".into(), icon_type: "powershell".into() });

        if std::path::Path::new("C:\\Program Files\\PowerShell\\7\\pwsh.exe").exists() {
            shells.push(ShellInfo { name: "PowerShell 7".into(), path: "pwsh.exe".into(), icon_type: "powershell".into() });
        }

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

#[tauri::command]
pub async fn create_ssh_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: SshConnectConfig,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();

    let mut ssh_config = client::Config::default();
    ssh_config.preferred = russh::Preferred::DEFAULT;

    let ssh_config = Arc::new(ssh_config);
    logging::info(
        "SSH/connect",
        format!("连接尝试: {}@{}:{}", config.username, config.host, config.port),
    );
    let addr = format!("{}:{}", config.host, config.port);

    let mut handle = client::connect(ssh_config, addr.clone(), Client)
        .await
        .map_err(|e| {
            logging::error("SSH/connect", format!("网络连接失败 ({addr}): {e:?}"));
            format!("网络连接失败: {:?}", e)
        })?;
    logging::info("SSH/connect", format!("网络连接已建立: {addr}"));

    let mut authenticated = false;

    if let Some(key_path) = config.private_key_path {
        logging::info("SSH/auth", format!("尝试私钥认证: {key_path}"));
        let key_pair = load_ssh_key(&key_path, config.private_key_passphrase)?;
        match handle.authenticate_publickey(config.username.clone(), Arc::new(key_pair)).await {
            Ok(true) => {
                logging::info("SSH/auth", "私钥认证成功");
                authenticated = true;
            }
            Ok(false) => logging::warn("SSH/auth", "服务器拒绝了私钥认证"),
            Err(e) => logging::warn("SSH/auth", format!("私钥认证过程出错: {e:?}")),
        }
    }

    if !authenticated {
        if let Some(password) = config.password.clone() {
            logging::info("SSH/auth", "开始 Keyboard-Interactive 认证");

            tokio::time::sleep(std::time::Duration::from_millis(100)).await;

            let kbd_start_res = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                handle.authenticate_keyboard_interactive_start(config.username.clone(), None),
            )
            .await;

            let kbd_start_enum = match kbd_start_res {
                Ok(Ok(res)) => Some(res),
                _ => None,
            };

            let mut kbd_authenticated = false;
            let mut should_fallback_to_password = false;

            if let Some(res) = kbd_start_enum {
                let mut current_kbd_res = Ok(res);
                for i in 0..5 {
                    match current_kbd_res {
                        Ok(client::KeyboardInteractiveAuthResponse::Success) => {
                            logging::info("SSH/auth", "Keyboard-Interactive 认证成功");
                            kbd_authenticated = true;
                            break;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, name, .. }) => {
                            logging::info(
                                "SSH/auth",
                                format!("收到交互请求: round={} name='{}' prompts={}", i + 1, name, prompts.len()),
                            );
                            let mut responses = Vec::new();
                            for _p in prompts.iter() {
                                responses.push(password.clone());
                            }
                            current_kbd_res = handle.authenticate_keyboard_interactive_respond(responses).await;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::Failure) => {
                            logging::warn("SSH/auth", "Keyboard-Interactive 被拒绝，切换密码认证");
                            should_fallback_to_password = true;
                            break;
                        }
                        Err(e) => {
                            logging::warn("SSH/auth", format!("Keyboard-Interactive 流程错误: {e:?}"));
                            should_fallback_to_password = true;
                            break;
                        }
                    }
                }
            } else {
                logging::warn("SSH/auth", "Keyboard-Interactive 启动失败或超时，尝试标准密码认证");
                should_fallback_to_password = true;
            }

            if kbd_authenticated {
                authenticated = true;
            } else if should_fallback_to_password {
                logging::info("SSH/auth", "开始标准密码认证");
                match handle.authenticate_password(config.username.clone(), password).await {
                    Ok(true) => {
                        logging::info("SSH/auth", "标准密码认证成功");
                        authenticated = true;
                    }
                    Ok(false) => logging::warn("SSH/auth", "标准密码认证被服务器拒绝"),
                    Err(e) => logging::warn("SSH/auth", format!("标准密码认证出错: {e:?}")),
                }
            }
        }
    }

    if !authenticated {
        logging::warn("SSH/auth", "所有认证方式均已尝试，认证失败");
        return Err("SSH 认证失败：密钥或密码错误".to_string());
    }
    logging::info("SSH/connect", "认证通过，初始化会话通道");

    let mut channel = handle.channel_open_session().await.map_err(|e| e.to_string())?;
    let initial_cols = config.initial_cols.unwrap_or(80).clamp(40, 400);
    let initial_rows = config.initial_rows.unwrap_or(24).clamp(12, 200);
    channel
        .request_pty(true, "xterm-256color", initial_cols, initial_rows, 0, 0, &[])
        .await
        .map_err(|e| e.to_string())?;
    let _ = channel.set_env(false, "TERM_PROGRAM", "LazyTerm").await;
    let _ = channel.set_env(false, "TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION")).await;
    let _ = channel.set_env(false, "COLORTERM", "truecolor").await;
    channel.request_shell(true).await.map_err(|e| e.to_string())?;

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
                        Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                            let _ = app.emit(&close_event_name, ());
                            break;
                        }
                        _ => {}
                    }
                }
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

    state
        .ssh_sessions
        .lock()
        .await
        .insert(session_id.clone(), SshTerminalSession { control_tx });

    Ok(session_id)
}

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

#[tauri::command]
pub async fn create_vnc_session<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    config: VncConnectConfig,
    frame_channel: Channel<Response>,
) -> Result<String, String> {
    let session_id = Uuid::new_v4().to_string();
    let target = vnc_target_label(&config);
    log_vnc_info(&session_id, &target, "connect", "received open request from frontend");

    let tcp = TokioTcpStream::connect((config.host.as_str(), config.port)).await.map_err(|error| {
        let message = format!("TCP connect failed: {error}");
        log_vnc_error(&session_id, &target, "connect", &message);
        message
    })?;

    let password = config.password.clone().unwrap_or_default();
    let shared = config.shared.unwrap_or(true);
    let allow_jpeg = config.allow_jpeg.unwrap_or(true);

    let builder = if allow_jpeg {
        RustVncConnector::new(tcp)
            .set_auth_method(std::future::ready(Ok::<String, RustVncError>(password.clone())))
            .add_encoding(VncEncoding::CursorPseudo)
            .add_encoding(VncEncoding::Tight)
            .add_encoding(VncEncoding::Zrle)
            .add_encoding(VncEncoding::Raw)
            .add_encoding(VncEncoding::DesktopSizePseudo)
            .allow_shared(shared)
            .set_pixel_format(VncPixelFormat::rgba())
    } else {
        RustVncConnector::new(tcp)
            .set_auth_method(std::future::ready(Ok::<String, RustVncError>(password)))
            .add_encoding(VncEncoding::CursorPseudo)
            .add_encoding(VncEncoding::Zrle)
            .add_encoding(VncEncoding::Raw)
            .add_encoding(VncEncoding::DesktopSizePseudo)
            .allow_shared(shared)
            .set_pixel_format(VncPixelFormat::rgba())
    };

    let client = builder
        .build()
        .map_err(|error| {
            let message = format!("build VNC connector failed: {error}");
            log_vnc_error(&session_id, &target, "config", &message);
            message
        })?
        .try_start()
        .await
        .map_err(|error| {
            let message = format!("start VNC handshake failed: {error}");
            log_vnc_error(&session_id, &target, "handshake", &message);
            message
        })?
        .finish()
        .map_err(|error| {
            let message = format!("finish VNC connection failed: {error}");
            log_vnc_error(&session_id, &target, "connect", &message);
            message
        })?;

    let (control_tx, control_rx) = mpsc::unbounded_channel::<VncControlMsg>();
    state
        .vnc_sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), VncSession { control_tx });

    let session_id_clone = session_id.clone();
    let target_clone = target.clone();
    let app_clone = app.clone();
    let vnc_sessions = Arc::clone(&state.vnc_sessions);
    tokio::spawn(async move {
        match run_vnc_session(
            app_clone.clone(),
            session_id_clone.clone(),
            target_clone.clone(),
            client,
            frame_channel,
            control_rx,
        ).await {
            Ok(()) => log_vnc_info(&session_id_clone, &target_clone, "close", "session loop ended"),
            Err(error) => log_vnc_error(&session_id_clone, &target_clone, "runtime", &error),
        }
        vnc_sessions.lock().unwrap().remove(&session_id_clone);
        let _ = app_clone.emit(&format!("vnc-close-{}", session_id_clone), ());
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn sftp_upload_file(
    config: SshConnectConfig,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let host = config.host.clone();
    let port = config.port;
    let username = config.username.clone();
    let password = config.password.clone();
    let key_path = config.private_key_path.clone();
    let passphrase = config.private_key_passphrase.clone();

    let mut ssh_config = client::Config::default();
    ssh_config.preferred = russh::Preferred::DEFAULT;
    let ssh_config = Arc::new(ssh_config);

    let addr = format!("{}:{}", host, port);
    let mut handle = client::connect(ssh_config, addr.clone(), Client)
        .await
        .map_err(|e| format!("连接失败：{}", e))?;

    let mut authenticated = false;

    if let Some(key_path) = key_path {
        let key_pair = load_ssh_key(&key_path, passphrase)?;
        match handle.authenticate_publickey(username.clone(), Arc::new(key_pair)).await {
            Ok(true) => authenticated = true,
            Ok(false) => {}
            Err(e) => return Err(format!("私钥认证失败：{}", e)),
        }
    }

    if !authenticated {
        if let Some(password) = password.clone() {
            let kbd_start_res = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                handle.authenticate_keyboard_interactive_start(username.clone(), None),
            )
            .await;

            let kbd_start_enum = match kbd_start_res {
                Ok(Ok(res)) => Some(res),
                _ => None,
            };

            let mut kbd_authenticated = false;
            let mut should_fallback_to_password = false;

            if let Some(res) = kbd_start_enum {
                let mut current_kbd_res = Ok(res);
                for _ in 0..5 {
                    match current_kbd_res {
                        Ok(client::KeyboardInteractiveAuthResponse::Success) => {
                            kbd_authenticated = true;
                            break;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. }) => {
                            let mut responses = Vec::new();
                            for _ in prompts.iter() {
                                responses.push(password.clone());
                            }
                            current_kbd_res = handle.authenticate_keyboard_interactive_respond(responses).await;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::Failure) => {
                            should_fallback_to_password = true;
                            break;
                        }
                        Err(_) => {
                            should_fallback_to_password = true;
                            break;
                        }
                    }
                }
            } else {
                should_fallback_to_password = true;
            }

            if kbd_authenticated {
                authenticated = true;
            } else if should_fallback_to_password {
                match handle.authenticate_password(username.clone(), password).await {
                    Ok(true) => authenticated = true,
                    Ok(false) => {}
                    Err(e) => return Err(format!("密码认证失败：{}", e)),
                }
            }
        }
    }

    if !authenticated {
        return Err("SSH 认证失败，请检查账号、私钥或密码。".to_string());
    }

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
    let remote_path_resolved = if remote_path.starts_with("~/") {
        match sftp.canonicalize(".").await {
            Ok(cwd) => format!("{}/{}", cwd.trim_end_matches('/'), &remote_path[2..]),
            Err(_) => remote_path.clone(),
        }
    } else {
        remote_path.clone()
    };

    if let Some(parent) = remote_path_resolved.rsplit_once('/') {
        let dir = parent.0;
        if !dir.is_empty() {
            let mut cur = String::new();
            let mut first = true;
            for part in dir.split('/') {
                if part.is_empty() {
                    if first {
                        cur.push('/');
                    }
                    first = false;
                    continue;
                }
                if !cur.ends_with('/') && !cur.is_empty() {
                    cur.push('/');
                }
                cur.push_str(part);
                let exists = sftp.try_exists(cur.clone()).await.unwrap_or(false);
                if !exists {
                    if let Err(e) = sftp.create_dir(cur.clone()).await {
                        let exists_after = sftp.try_exists(cur.clone()).await.unwrap_or(false);
                        if !exists_after {
                            return Err(map_sftp_error("创建远程目录失败", &e, Some(&cur)));
                        }
                    }
                }
                first = false;
            }
        }
    }

    match sftp.create(&remote_path_resolved).await {
        Ok(mut file) => match file.write_all(&data).await {
            Ok(_) => {
                let _ = sftp.close().await;
                Ok(())
            }
            Err(e) => Err(map_sftp_error("写入远程文件失败", &e, Some(&remote_path_resolved))),
        },
        Err(e) => Err(map_sftp_error("创建远程文件失败", &e, Some(&remote_path_resolved))),
    }
}

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

    {
        let mut cancellations = state.sftp_upload_cancellations.lock().unwrap();
        cancellations.insert(upload_id.clone(), false);
    }
    let _cancel_guard = SftpUploadCancelGuard {
        upload_id: upload_id.clone(),
        cancellations: Arc::clone(&state.sftp_upload_cancellations),
    };

    let host = config.host.clone();
    let port = config.port;
    let username = config.username.clone();
    let password = config.password.clone();
    let key_path = config.private_key_path.clone();
    let passphrase = config.private_key_passphrase.clone();

    let mut ssh_config = client::Config::default();
    ssh_config.preferred = russh::Preferred::DEFAULT;
    let ssh_config = Arc::new(ssh_config);

    let addr = format!("{}:{}", host, port);
    let mut handle = client::connect(ssh_config, addr.clone(), Client)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let mut authenticated = false;

    if let Some(key_path) = key_path {
        let key_pair = load_ssh_key(&key_path, passphrase)?;
        match handle.authenticate_publickey(username.clone(), Arc::new(key_pair)).await {
            Ok(true) => authenticated = true,
            Ok(false) => {}
            Err(e) => return Err(format!("私钥认证失败: {}", e)),
        }
    }

    if !authenticated {
        if let Some(password) = password.clone() {
            let kbd_start_res = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                handle.authenticate_keyboard_interactive_start(username.clone(), None),
            )
            .await;

            let kbd_start_enum = match kbd_start_res {
                Ok(Ok(res)) => Some(res),
                _ => None,
            };

            let mut kbd_authenticated = false;
            let mut should_fallback_to_password = false;

            if let Some(res) = kbd_start_enum {
                let mut current_kbd_res = Ok(res);
                for _ in 0..5 {
                    match current_kbd_res {
                        Ok(client::KeyboardInteractiveAuthResponse::Success) => {
                            kbd_authenticated = true;
                            break;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. }) => {
                            let mut responses = Vec::new();
                            for _ in prompts.iter() {
                                responses.push(password.clone());
                            }
                            current_kbd_res = handle.authenticate_keyboard_interactive_respond(responses).await;
                        }
                        Ok(client::KeyboardInteractiveAuthResponse::Failure) => {
                            should_fallback_to_password = true;
                            break;
                        }
                        Err(_) => {
                            should_fallback_to_password = true;
                            break;
                        }
                    }
                }
            } else {
                should_fallback_to_password = true;
            }

            if kbd_authenticated {
                authenticated = true;
            } else if should_fallback_to_password {
                match handle.authenticate_password(username.clone(), password).await {
                    Ok(true) => authenticated = true,
                    Ok(false) => {}
                    Err(e) => return Err(format!("密码认证失败: {}", e)),
                }
            }
        }
    }

    if !authenticated {
        return Err("SSH 认证失败，请检查账号、私钥或密码。".to_string());
    }

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

    let mut file_infos: Vec<(usize, SftpUploadItem, u64, String)> = Vec::new();
    let mut overall_total = 0u64;
    for (index, item) in files.into_iter().enumerate() {
        let meta = tokio::fs::metadata(&item.local_path)
            .await
            .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;
        if !meta.is_file() {
            return Err(format!("读取本地文件失败: 不是文件 (path={})", item.local_path));
        }
        let size = meta.len();
        overall_total += size;
        let file_name = Path::new(&item.local_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&item.local_path)
            .to_string();
        file_infos.push((index, item, size, file_name));
    }

    let mut overall_sent = 0u64;
    for (index, item, file_size, file_name) in file_infos.into_iter() {
        let cancelled = state
            .sftp_upload_cancellations
            .lock()
            .unwrap()
            .get(&upload_id)
            .copied()
            .unwrap_or(false);
        if cancelled {
            return Err("上传已停止".to_string());
        }

        let remote_path_resolved = if item.remote_path.starts_with("~/") {
            match sftp.canonicalize(".").await {
                Ok(cwd) => format!("{}/{}", cwd.trim_end_matches('/'), &item.remote_path[2..]),
                Err(_) => item.remote_path.clone(),
            }
        } else {
            item.remote_path.clone()
        };

        if remote_path_resolved.is_empty() {
            return Err("远程路径不能为空。".to_string());
        }

        if let Some(parent) = remote_path_resolved.rsplit_once('/') {
            let dir = parent.0;
            if !dir.is_empty() {
                let mut cur = String::new();
                let mut first = true;
                for part in dir.split('/') {
                    if part.is_empty() {
                        if first {
                            cur.push('/');
                        }
                        first = false;
                        continue;
                    }
                    if !cur.ends_with('/') && !cur.is_empty() {
                        cur.push('/');
                    }
                    cur.push_str(part);
                    let exists = sftp.try_exists(cur.clone()).await.unwrap_or(false);
                    if !exists {
                        if let Err(e) = sftp.create_dir(cur.clone()).await {
                            let exists_after = sftp.try_exists(cur.clone()).await.unwrap_or(false);
                            if !exists_after {
                                return Err(map_sftp_error("创建远程目录失败", &e, Some(&cur)));
                            }
                        }
                    }
                    first = false;
                }
            }
        }

        let mut local_file = tokio::fs::File::open(&item.local_path)
            .await
            .map_err(|e| format!("读取本地文件失败: {} (path={})", e, item.local_path))?;

        let mut remote_file = match sftp.create(&remote_path_resolved).await {
            Ok(file) => file,
            Err(e) => return Err(map_sftp_error("创建远程文件失败", &e, Some(&remote_path_resolved))),
        };

        let mut sent = 0u64;
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let cancelled = state
                .sftp_upload_cancellations
                .lock()
                .unwrap()
                .get(&upload_id)
                .copied()
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

#[tauri::command]
pub fn cancel_sftp_upload(state: State<'_, AppState>, upload_id: String) -> Result<(), String> {
    let mut cancellations = state.sftp_upload_cancellations.lock().unwrap();
    if let Some(cancelled) = cancellations.get_mut(&upload_id) {
        *cancelled = true;
        Ok(())
    } else {
        Err("上传任务不存在或已结束".to_string())
    }
}

#[tauri::command]
pub fn write_to_terminal(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
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
pub async fn write_to_ssh_session(state: State<'_, AppState>, session_id: String, data: String) -> Result<(), String> {
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

#[tauri::command]
pub fn resize_terminal(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.local_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_ssh_session(state: State<'_, AppState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.ssh_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(SshControlMsg::Resize(cols as u32, rows as u32))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn close_terminal(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.local_sessions.lock().unwrap().remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn close_ssh_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.ssh_sessions.lock().await.remove(&session_id) {
        let _ = session.control_tx.send(SshControlMsg::Close);
    }
    Ok(())
}

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

#[tauri::command]
pub fn close_rdp_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.rdp_sessions.lock().unwrap().remove(&session_id) {
        let _ = session.control_tx.send(RdpControlMsg::Close);
    }
    Ok(())
}

#[tauri::command]
pub fn send_vnc_pointer(state: State<'_, AppState>, session_id: String, payload: VncPointerEventPayload) -> Result<(), String> {
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

#[tauri::command]
pub fn send_vnc_key(state: State<'_, AppState>, session_id: String, payload: VncKeyboardEventPayload) -> Result<(), String> {
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

#[tauri::command]
pub fn request_vnc_refresh(state: State<'_, AppState>, session_id: String, full: bool) -> Result<(), String> {
    let sessions = state.vnc_sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session
            .control_tx
            .send(VncControlMsg::Refresh(full))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("VNC 会话不存在".to_string())
    }
}

#[tauri::command]
pub fn close_vnc_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    if let Some(session) = state.vnc_sessions.lock().unwrap().remove(&session_id) {
        let _ = session.control_tx.send(VncControlMsg::Close);
    }
    Ok(())
}
