use crate::state::AppState;
use crate::types::{TelnetConnectConfig, TelnetSession};
use log::{error, info, warn};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

// Telnet Protocol Bytes
const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;

#[tauri::command]
pub async fn open_telnet_session(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: String,
    config: TelnetConnectConfig,
) -> Result<(), String> {
    info!("TELNET connecting to {}:{}", config.host, config.port);

    let stream = match TcpStream::connect((config.host.as_str(), config.port)).await {
        Ok(s) => s,
        Err(e) => {
            error!("TELNET connection failed: {:?}", e);
            return Err(e.to_string());
        }
    };

    let (mut read_half, mut write_half) = stream.into_split();
    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<String>();

    // Register session
    {
        let mut sessions = state.telnet_sessions.lock().await;
        sessions.insert(session_id.clone(), TelnetSession { control_tx });
    }

    let session_id_clone = session_id.clone();
    let app_clone = app.clone();

    let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // Task to handle reading from TCP and emitting to frontend
    tokio::spawn(async move {
        let mut buffer = [0u8; 8192];
        let mut state = 0; // 0: Normal, 1: IAC, 2: IAC+DO/DONT/WILL/WONT, 3: IAC+SB, 4: IAC+SB...+IAC
        let mut cmd = 0;

        loop {
            match read_half.read(&mut buffer).await {
                Ok(n) if n == 0 => {
                    info!(
                        "TELNET connection closed by remote (session {})",
                        session_id_clone
                    );
                    break;
                }
                Ok(n) => {
                    let mut output = String::new();

                    for &b in &buffer[..n] {
                        match state {
                            0 => {
                                if b == IAC {
                                    state = 1;
                                } else {
                                    output.push(b as char);
                                }
                            }
                            1 => {
                                match b {
                                    IAC => {
                                        // escaped IAC
                                        output.push(IAC as char);
                                        state = 0;
                                    }
                                    DO | DONT | WILL | WONT => {
                                        state = 2;
                                        cmd = b;
                                    }
                                    SB => {
                                        state = 3;
                                    }
                                    _ => {
                                        state = 0;
                                    }
                                }
                            }
                            2 => {
                                // We read the option byte
                                let option = b;
                                // Accept ECHO(1) and SGA(3), refuse everything else
                                let reply_cmd = match cmd {
                                    DO => {
                                        if option == 1 || option == 3 {
                                            WILL
                                        } else {
                                            WONT
                                        }
                                    }
                                    WILL => {
                                        if option == 1 || option == 3 {
                                            DO
                                        } else {
                                            DONT
                                        }
                                    }
                                    _ => 0,
                                };
                                if reply_cmd != 0 {
                                    let _ = write_tx.send(vec![IAC, reply_cmd, option]);
                                }
                                state = 0;
                            }
                            3 => {
                                if b == IAC {
                                    state = 4;
                                }
                            }
                            4 => {
                                if b == SE {
                                    state = 0;
                                } else if b == IAC {
                                    state = 4;
                                } else {
                                    state = 3;
                                }
                            }
                            _ => state = 0,
                        }
                    }

                    if !output.is_empty() {
                        if let Err(e) =
                            app_clone.emit(&format!("telnet-data-{}", session_id_clone), output)
                        {
                            warn!("Failed to emit telnet data: {:?}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("TELNET read error (session {}): {:?}", session_id_clone, e);
                    break;
                }
            }
        }
        let _ = app_clone.emit(&format!("telnet-close-{}", session_id_clone), ());
    });

    // Task to handle writing to TCP from frontend
    tokio::spawn(async move {
        loop {
            tokio::select! {
                Some(payload) = write_rx.recv() => {
                    if let Err(e) = write_half.write_all(&payload).await {
                        error!("TELNET local write error: {:?}", e);
                        break;
                    }
                }
                Some(text) = control_rx.recv() => {
                    if let Err(e) = write_half.write_all(text.as_bytes()).await {
                        error!("TELNET user write error: {:?}", e);
                        break;
                    }
                }
                else => {
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn write_telnet(
    state: tauri::State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.telnet_sessions.lock().await;
    if let Some(session) = sessions.get(&session_id) {
        let _ = session.control_tx.send(data);
        Ok(())
    } else {
        Err("TELNET session not found".to_string())
    }
}

#[tauri::command]
pub async fn resize_telnet(
    _state: tauri::State<'_, AppState>,
    _session_id: String,
    _cols: u32,
    _rows: u32,
) -> Result<(), String> {
    // Basic telnet doesn't strictly require NAWS unless negotiated.
    // Ignored for MVP.
    Ok(())
}

#[tauri::command]
pub async fn close_telnet(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    info!("Closing TELNET session {}", session_id);
    let mut sessions = state.telnet_sessions.lock().await;
    sessions.remove(&session_id);
    Ok(())
}
