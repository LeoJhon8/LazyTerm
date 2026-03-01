use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, State, Runtime, Emitter};

// --- 数据结构 ---

struct TerminalSession {
    // 存储 master 用于 resize 和获取会话状态
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    // 专门存储 writer 用于写入数据
    writer: Box<dyn Write + Send>,
}

struct AppState {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

// --- Tauri 指令 ---

#[tauri::command]
async fn create_terminal<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    
    let pty_system = native_pty_system();
    
    // 打开 PTY 配对
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("无法打开PTY: {}", e))?;

    // 1. 确定默认 Shell
    let default_shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
    };
    
    let target_shell = shell.unwrap_or(default_shell);
    let mut cmd = CommandBuilder::new(target_shell);

    // 2. 【核心修复】注入当前系统的所有环境变量
    // 这能确保 PowerShell 加载配置文件（Prompt 样式、颜色、PATH 等）
    for (key, val) in std::env::vars() {
        cmd.env(key, val);
    }

    // 3. 优化工作目录处理
    if let Some(mut path) = cwd {
        if path.is_empty() || path == "/" || path == "\\" {
            // 如果路径无效，直接清空，让它使用系统默认路径
            // 或者手动指定为用户主目录
            if let Ok(home) = std::env::var("USERPROFILE") {
                cmd.cwd(home);
            }
        } else {
            cmd.cwd(path);
        }
    }

    // 4. 启动 Shell 进程
    let _child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("无法启动进程: {}", e))?;
    
    // 释放 slave，因为 master 会持有引用
    drop(pair.slave);

    let master = pair.master;
    
    // 获取写入器
    let writer = master.take_writer()
        .map_err(|e| format!("无法获取写入器: {}", e))?;

    // 获取读取器用于线程监听输出
    let mut reader = master.try_clone_reader()
        .map_err(|e| format!("无法创建读取器: {}", e))?;
    
    let session_id_clone = session_id.clone();
    
    // 5. 启动读取线程：将 PTY 输出转发到前端
    thread::spawn(move || {
        let mut buffer = [0u8; 1024 * 8];
        loop {
            match reader.read(&mut buffer) {
                Ok(n) if n > 0 => {
                    // 使用 lossy 确保即使有不完整的 UTF-8 字符也不会 crash
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let event_name = format!("terminal-data-{}", session_id_clone);
                    // 发送事件到前端
                    if let Err(_) = app.emit(&event_name, data) {
                        break; // 前端连接断开或 app 销毁时退出
                    }
                }
                Ok(_) => break, // EOF
                Err(_) => break, // 读取错误
            }
        }
    });

    // 6. 存入全局状态管理
    let mut sessions = state.sessions.lock().unwrap();
    sessions.insert(session_id.clone(), TerminalSession { master, writer });

    Ok(session_id)
}

#[tauri::command]
fn write_to_terminal(
    state: State<'_, AppState>, 
    session_id: String, 
    data: String
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    
    if let Some(session) = sessions.get_mut(&session_id) {
        session.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("写入失败: {}", e))?;
            
        session.writer.flush().map_err(|e| format!("刷新失败: {}", e))?;
        
        Ok(())
    } else {
        Err("会话不存在".to_string())
    }
}

#[tauri::command]
fn resize_terminal(
    state: State<'_, AppState>, 
    session_id: String, 
    cols: u16, 
    rows: u16
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("调整大小失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn close_terminal(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    sessions.remove(&session_id);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            create_terminal,
            write_to_terminal,
            resize_terminal,
            close_terminal
        ])
        .run(tauri::generate_context!())
        .expect("运行失败");
}