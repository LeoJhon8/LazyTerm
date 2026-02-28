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
    // 专门存储 writer 用于写入数据，类型直接设为 Box<dyn Write + Send>
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
    
    // 使用 openpty
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("无法打开PTY: {}", e))?;

    let default_shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        "bash".to_string()
    };
    
    let mut cmd = CommandBuilder::new(shell.unwrap_or(default_shell));
    if let Some(path) = cwd {
        if !path.is_empty() {
            cmd.cwd(path);
        }
    }

    let _child = pair.slave.spawn_command(cmd)
        .map_err(|e| format!("无法启动进程: {}", e))?;
    
    drop(pair.slave);

    let master = pair.master;
    
    // 获取写入器：take_writer 返回的是 Box<dyn Write + Send>
    let writer = master.take_writer()
        .map_err(|e| format!("无法获取写入器: {}", e))?;

    // 获取读取器
    let mut reader = master.try_clone_reader()
        .map_err(|e| format!("无法创建读取器: {}", e))?;
    
    let session_id_clone = session_id.clone();
    
    // 读取线程
    thread::spawn(move || {
        let mut buffer = [0u8; 1024 * 8];
        loop {
            match reader.read(&mut buffer) {
                Ok(n) if n > 0 => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let event_name = format!("terminal-data-{}", session_id_clone);
                    if let Err(_) = app.emit(&event_name, data) {
                        break; 
                    }
                }
                Ok(_) => break,
                Err(_) => break,
            }
        }
    });

    // 存入 sessions
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
        // 直接使用 session.writer，因为它已经是 Box<dyn Write + Send>
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