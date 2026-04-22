//! 本地终端命令模块（从 commands/terminal.rs 迁移）

use crate::{AppState, LocalTerminalSession, ShellInfo};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read as _, Write};
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

/// 创建本地终端会话
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

    // 检测是否为 WSL shell（格式：wsl.exe -d <发行版名> 或 wsl.exe）
    let is_wsl_shell = cfg!(target_os = "windows") && shell_cmd.starts_with("wsl.exe");

    if cfg!(target_os = "windows")
        && (shell_cmd == "bash.exe" || shell_cmd == "git-bash" || shell_cmd == "bash")
    {
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let common_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe".to_string(),
            "C:\\Program Files\\Git\\usr\\bin\\bash.exe".to_string(),
            format!(
                "{}\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
                user_profile
            ),
            format!(
                "{}\\AppData\\Local\\Programs\\Git\\usr\\bin\\bash.exe",
                user_profile
            ),
        ];
        for path in common_paths {
            if std::path::Path::new(&path).exists() {
                shell_cmd = path;
                break;
            }
        }
    }

    let mut cmd = if is_wsl_shell {
        // WSL shell：解析 "wsl.exe -d <发行版>" 格式
        let parts: Vec<&str> = shell_cmd.splitn(4, ' ').collect();
        let mut c = CommandBuilder::new("wsl.exe");
        // 跳过 "wsl.exe"，将后续参数依次添加
        for arg in parts.iter().skip(1) {
            c.arg(*arg);
        }
        c
    } else if cfg!(target_os = "windows") && admin.unwrap_or(false) {
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

        let should_emit_close = local_sessions
            .lock()
            .unwrap()
            .remove(&session_id_clone)
            .is_some();
        if should_emit_close {
            let _ = app.emit(&close_event_name, ());
        }
    });

    state
        .local_sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), LocalTerminalSession { master, writer });

    Ok(session_id)
}

/// 获取系统可用的 Shell 列表
#[tauri::command]
pub async fn get_available_shells() -> Result<Vec<ShellInfo>, String> {
    let mut shells = Vec::new();

    if cfg!(target_os = "windows") {
        shells.push(ShellInfo {
            name: "CMD".into(),
            path: "cmd.exe".into(),
            icon_type: "cmd".into(),
        });
        shells.push(ShellInfo {
            name: "PowerShell".into(),
            path: "powershell.exe".into(),
            icon_type: "powershell".into(),
        });

        if std::path::Path::new("C:\\Program Files\\PowerShell\\7\\pwsh.exe").exists() {
            shells.push(ShellInfo {
                name: "PowerShell 7".into(),
                path: "pwsh.exe".into(),
                icon_type: "powershell".into(),
            });
        }

        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let git_bash_paths = [
            "C:\\Program Files\\Git\\bin\\bash.exe".to_string(),
            format!(
                "{}\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
                user_profile
            ),
        ];

        for path in git_bash_paths {
            if std::path::Path::new(&path).exists() {
                shells.push(ShellInfo {
                    name: "Git Bash".into(),
                    path: path.into(),
                    icon_type: "bash".into(),
                });
                break;
            }
        }

        // 检测 WSL 发行版
        if let Ok(wsl_shells) = detect_wsl_distributions() {
            shells.extend(wsl_shells);
        }
    } else {
        let common = ["bash", "zsh", "fish", "sh"];
        for s in common {
            let path = format!("/bin/{}", s);
            let usr_path = format!("/usr/bin/{}", s);
            if std::path::Path::new(&path).exists() {
                shells.push(ShellInfo {
                    name: s.to_uppercase(),
                    path,
                    icon_type: "bash".into(),
                });
            } else if std::path::Path::new(&usr_path).exists() {
                shells.push(ShellInfo {
                    name: s.to_uppercase(),
                    path: usr_path,
                    icon_type: "bash".into(),
                });
            }
        }
    }

    Ok(shells)
}

/// 检测已安装的 WSL 发行版
/// 通过运行 `wsl.exe --list --quiet` 获取发行版列表
fn detect_wsl_distributions() -> Result<Vec<ShellInfo>, String> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;

    // CREATE_NO_WINDOW 标志，防止执行 wsl.exe 时闪现控制台窗口
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let output = Command::new("wsl.exe")
        .args(["--list", "--quiet"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("无法执行 wsl.exe: {}", e))?;

    if !output.status.success() {
        return Err("wsl.exe 执行失败".to_string());
    }

    // WSL 输出是 UTF-16LE 编码，需要转换
    let stdout = &output.stdout;
    if stdout.is_empty() {
        return Ok(Vec::new());
    }

    // UTF-16LE 解码
    let distributions = decode_wsl_output(stdout);

    Ok(distributions
        .into_iter()
        .filter(|name| !name.is_empty())
        .map(|distro_name| {
            let shell_path = format!("wsl.exe -d {}", distro_name);
            ShellInfo {
                name: format!("WSL: {}", distro_name),
                path: shell_path,
                icon_type: "wsl".into(),
            }
        })
        .collect())
}

/// 解析 WSL --list --quiet 的 UTF-16LE 输出
fn decode_wsl_output(raw: &[u8]) -> Vec<String> {
    // wsl.exe --list --quiet 输出 UTF-16LE 编码
    let utf16: Vec<u16> = raw
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    let full_text = String::from_utf16_lossy(&utf16);

    full_text
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

/// 向终端写入数据
#[tauri::command]
pub fn write_to_terminal(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.local_sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("本地会话不存在".to_string())
    }
}

/// 调整终端大小
#[tauri::command]
pub fn resize_terminal(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
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

/// 关闭终端会话
#[tauri::command]
pub fn close_terminal(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.local_sessions.lock().unwrap().remove(&session_id);
    Ok(())
}
