use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Debug, Deserialize)]
pub struct SerialConfigPayload {
    pub port: String,
    #[serde(rename = "baudRate")]
    pub baud_rate: u32,
    #[serde(rename = "dataBits")]
    pub data_bits: u32,
    pub parity: String,
    #[serde(rename = "stopBits")]
    pub stop_bits: u32,
    #[serde(rename = "flowControl")]
    pub flow_control: String,
}

static SERIAL_SESSIONS: Lazy<Arc<Mutex<HashMap<String, Box<dyn serialport::SerialPort>>>>> =
    Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

#[tauri::command]
pub async fn list_serial_ports() -> Result<Vec<String>, String> {
    let mut ports = std::collections::HashSet::new();

    // 1. 标准 API 枚举
    if let Ok(available) = serialport::available_ports() {
        for p in available {
            ports.insert(p.port_name);
        }
    }

    // 2. Windows 注册表兜底（用于发现虚拟串口，如 com0com）
    #[cfg(target_os = "windows")]
    {
        let queries = [
            "reg query HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM",
            "reg query HKLM\\SYSTEM\\CurrentControlSet\\services\\com0com\\Parameters /s",
        ];

        for query in queries {
            if let Ok(output) = std::process::Command::new("cmd")
                .arg("/c")
                .arg(query)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
            {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    for line in stdout.lines() {
                        let line_trimmed = line.trim();
                        if line_trimmed.starts_with("HKEY_LOCAL_MACHINE\\") {
                            if let Some(key_name) = line_trimmed.split('\\').last() {
                                if key_name.starts_with("CNC") {
                                    ports.insert(key_name.to_string());
                                }
                            }
                        }

                        let parts: Vec<&str> = line_trimmed.split_whitespace().collect();
                        if let Some(pos) = parts.iter().position(|&s| s == "REG_SZ") {
                            if pos + 1 < parts.len() {
                                let port_name = parts[pos + 1];
                                if port_name.starts_with("COM")
                                    || port_name.starts_with("CNCA")
                                    || port_name.starts_with("CNCB")
                                {
                                    ports.insert(port_name.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result: Vec<String> = ports.into_iter().collect();
    // 排序以保证 COM1, COM2 的顺序，避免 COM10 排在 COM2 前面
    result.sort_by(|a, b| {
        let a_num = a.trim_start_matches("COM").parse::<u32>().unwrap_or(0);
        let b_num = b.trim_start_matches("COM").parse::<u32>().unwrap_or(0);
        a_num.cmp(&b_num)
    });

    Ok(result)
}

#[tauri::command]
pub async fn open_serial_session<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    config: SerialConfigPayload,
) -> Result<(), String> {
    let data_bits = match config.data_bits {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        8 => serialport::DataBits::Eight,
        _ => serialport::DataBits::Eight,
    };

    let parity = match config.parity.as_str() {
        "None" => serialport::Parity::None,
        "Odd" => serialport::Parity::Odd,
        "Even" => serialport::Parity::Even,
        _ => serialport::Parity::None,
    };

    let stop_bits = match config.stop_bits {
        1 => serialport::StopBits::One,
        2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    };

    let flow_control = match config.flow_control.as_str() {
        "None" => serialport::FlowControl::None,
        "Software" => serialport::FlowControl::Software,
        "Hardware" => serialport::FlowControl::Hardware,
        _ => serialport::FlowControl::None,
    };

    let builder = serialport::new(config.port, config.baud_rate)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .flow_control(flow_control)
        .timeout(std::time::Duration::from_millis(100)); // Non-blocking-ish

    let port = builder.open().map_err(|e| e.to_string())?;
    let mut cloned_port = port.try_clone().map_err(|e| e.to_string())?;

    {
        let mut sessions = SERIAL_SESSIONS.lock().unwrap();
        sessions.insert(session_id.clone(), port);
    }

    let session_id_clone = session_id.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        let event_name = format!("serial-data-{}", session_id_clone);
        let close_event_name = format!("serial-close-{}", session_id_clone);
        loop {
            match cloned_port.read(&mut buffer) {
                Ok(n) if n > 0 => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app.emit(&event_name, data);
                }
                Ok(_) => {
                    // 0 bytes read shouldn't strictly happen with timeout, but check session
                    let sessions = SERIAL_SESSIONS.lock().unwrap();
                    if !sessions.contains_key(&session_id_clone) {
                        break;
                    }
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    let sessions = SERIAL_SESSIONS.lock().unwrap();
                    if !sessions.contains_key(&session_id_clone) {
                        break;
                    }
                }
                Err(e) => {
                    println!("Serial port read error: {:?}", e);
                    let _ = app.emit(&close_event_name, ());
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn write_serial(session_id: String, data: String) -> Result<(), String> {
    let mut sessions = SERIAL_SESSIONS.lock().unwrap();
    if let Some(port) = sessions.get_mut(&session_id) {
        port.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        port.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Serial session not found".to_string())
    }
}

#[tauri::command]
pub fn resize_serial(_session_id: String, _cols: u16, _rows: u16) -> Result<(), String> {
    // Serial doesn't support PTY sizing natively. No-op.
    Ok(())
}

#[tauri::command]
pub fn close_serial(session_id: String) -> Result<(), String> {
    let mut sessions = SERIAL_SESSIONS.lock().unwrap();
    sessions.remove(&session_id); // This attempts to close
    Ok(())
}
