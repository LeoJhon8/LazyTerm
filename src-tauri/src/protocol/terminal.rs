//! 本地终端命令模块（从 commands/terminal.rs 迁移）

use crate::{AppState, LocalTerminalSession, ShellInfo};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read as _, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Runtime, State};
use uuid::Uuid;

const GIT_BASH_INTEGRATION_SCRIPT: &str = r#"# Lazy Terminal Git Bash shell integration.
# This file is generated for one terminal session and removed when it closes.

if [[ -r ~/.bashrc ]]; then
    source ~/.bashrc
fi

if [[ $- == *i* && -z ${LAZYTERM_SHELL_INTEGRATION_ACTIVE:-} ]]; then
    LAZYTERM_SHELL_INTEGRATION_ACTIVE=1
    export LAZYTERM_SHELL_INTEGRATION_ACTIVE

    __lazyterm_prompt_begin() {
        local __lazyterm_exit_code=$?
        __lazyterm_last_exit_code=$__lazyterm_exit_code
        printf '\033]633;D;%s\007' "$__lazyterm_exit_code"
        return "$__lazyterm_exit_code"
    }

    __lazyterm_prompt_ready() {
        local __lazyterm_exit_code=${__lazyterm_last_exit_code:-0}
        if [[ ${PS1:-} != "${__lazyterm_wrapped_ps1:-}" ]]; then
            __lazyterm_wrapped_ps1='\[\033]633;A\007\]'"${PS1:-}"'\[\033]633;B\007\]'
            PS1=$__lazyterm_wrapped_ps1
        fi
        return "$__lazyterm_exit_code"
    }

    case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
        "declare -a"*)
            PROMPT_COMMAND=(
                __lazyterm_prompt_begin
                "${PROMPT_COMMAND[@]}"
                __lazyterm_prompt_ready
            )
            ;;
        *)
            PROMPT_COMMAND="__lazyterm_prompt_begin${PROMPT_COMMAND:+;$PROMPT_COMMAND};__lazyterm_prompt_ready"
            ;;
    esac

    PS0=$'\033]633;C\007'"${PS0:-}"
fi
"#;

fn is_git_bash_shell(shell: &str) -> bool {
    if !cfg!(target_os = "windows") {
        return false;
    }

    let normalized = shell.replace('/', "\\").to_ascii_lowercase();
    matches!(normalized.as_str(), "bash" | "bash.exe" | "git-bash")
        || (normalized.ends_with("\\bash.exe") && normalized.contains("\\git\\"))
}

fn create_git_bash_integration_script(session_id: &str) -> Result<PathBuf, String> {
    let directory = std::env::temp_dir().join("lazy-terminal-shell-integration");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建 Git Bash Shell Integration 临时目录: {error}"))?;

    let path = directory.join(format!("{session_id}.bash"));
    std::fs::write(&path, GIT_BASH_INTEGRATION_SCRIPT)
        .map_err(|error| format!("无法写入 Git Bash Shell Integration 脚本: {error}"))?;
    Ok(path)
}

fn bash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// 创建本地终端会话
#[tauri::command]
pub async fn create_terminal<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    cwd: Option<String>,
    shell: Option<String>,
    shell_args: Option<Vec<String>>,
    admin: Option<bool>,
    init_command: Option<String>,
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

    let git_bash_integration_path = if is_git_bash_shell(&shell_cmd) {
        Some(create_git_bash_integration_script(&session_id)?)
    } else {
        None
    };

    let mut cmd = if is_wsl_shell {
        // WSL shell：解析 "wsl.exe -d <发行版>" 格式
        let parts: Vec<&str> = shell_cmd.splitn(4, ' ').collect();
        let mut c = CommandBuilder::new("wsl.exe");
        // 跳过 "wsl.exe"，将后续参数依次添加
        for arg in parts.iter().skip(1) {
            c.arg(*arg);
        }
        // 添加额外的 shell_args
        if let Some(args) = &shell_args {
            for arg in args {
                c.arg(arg);
            }
        }
        c
    } else if cfg!(target_os = "windows") && admin.unwrap_or(false) {
        let mut c = CommandBuilder::new("sudo");
        c.arg("--inline");
        c.arg(shell_cmd);
        if let Some(path) = &git_bash_integration_path {
            c.arg("--rcfile");
            c.arg(bash_path(path));
            c.env("TERM_PROGRAM", "LazyTerminal");
            c.env("LAZYTERM_SHELL_INTEGRATION", "1");
        }
        // 添加额外的 shell_args
        if let Some(args) = &shell_args {
            for arg in args {
                c.arg(arg);
            }
        }
        c
    } else {
        let mut c = CommandBuilder::new(&shell_cmd);
        if let Some(path) = &git_bash_integration_path {
            c.arg("--rcfile");
            c.arg(bash_path(path));
            c.env("TERM_PROGRAM", "LazyTerminal");
            c.env("LAZYTERM_SHELL_INTEGRATION", "1");
        }
        // 添加额外的 shell_args
        if let Some(args) = &shell_args {
            for arg in args {
                c.arg(arg);
            }
        }
        c
    };

    if let Some(path) = cwd {
        cmd.cwd(path);
    }

    let _child = match pair.slave.spawn_command(cmd) {
        Ok(child) => child,
        Err(error) => {
            if let Some(path) = &git_bash_integration_path {
                let _ = std::fs::remove_file(path);
            }
            return Err(error.to_string());
        }
    };
    drop(pair.slave);

    let master = pair.master;
    let mut writer = master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    // 如果提供了 init_command，在 PTY 启动后立即写入命令
    // PTY 缓冲区会保存数据，shell 初始化完成后会自动读取执行
    // 同时设置输出抑制期，跳过 cmd.exe 横幅和命令回显
    let suppress_until = if let Some(cmd) = &init_command {
        log::info!(
            "create_terminal: 写入 init_command 到 PTY, session_id={}, command={}",
            session_id,
            cmd
        );
        // 写入命令 + 回车换行符触发执行
        let cmd_with_newline = format!("{}\r\n", cmd);
        if let Err(e) = writer.write_all(cmd_with_newline.as_bytes()) {
            log::warn!("create_terminal: 写入 init_command 失败: {}", e);
        }
        if let Err(e) = writer.flush() {
            log::warn!("create_terminal: flush init_command 失败: {}", e);
        }
        // 抑制前 500ms 的输出（cmd.exe 横幅 + 命令回显）
        Some(std::time::Instant::now() + std::time::Duration::from_millis(500))
    } else {
        None
    };

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
            // 抑制期内：读取但丢弃数据，跳过 shell 启动横幅和命令回显
            if let Some(until) = &suppress_until {
                if std::time::Instant::now() < *until {
                    continue;
                }
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

    state.local_sessions.lock().unwrap().insert(
        session_id.clone(),
        LocalTerminalSession {
            master,
            writer,
            integration_script_path: git_bash_integration_path,
        },
    );

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
    use crate::utils::create_hidden_command;

    let output = create_hidden_command("wsl.exe")
        .args(["--list", "--quiet"])
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
