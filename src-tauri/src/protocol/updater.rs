use futures::StreamExt;
use reqwest::Client;
use serde::Serialize;
use std::env;
use std::fs::File;
use std::io::Write;
use std::sync::Mutex;
use tauri::{Emitter, State, Window};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadStatus {
    downloading: bool,
    progress: Option<f64>,
    error: Option<String>,
}

#[derive(Default)]
pub struct UpdateDownloadState {
    status: Mutex<UpdateDownloadStatus>,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    progress: f64,
}

#[derive(Clone, Serialize)]
struct ErrorPayload {
    error: String,
}

#[tauri::command]
pub fn get_update_download_status(
    state: State<'_, UpdateDownloadState>,
) -> Result<UpdateDownloadStatus, String> {
    state
        .status
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "Failed to read update download status".to_string())
}

fn set_download_progress(state: &UpdateDownloadState, progress: f64) {
    if let Ok(mut status) = state.status.lock() {
        status.downloading = true;
        status.progress = Some(progress);
        status.error = None;
    }
}

fn set_download_error(state: &UpdateDownloadState, error: &str) {
    if let Ok(mut status) = state.status.lock() {
        status.downloading = false;
        status.progress = None;
        status.error = Some(error.to_string());
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    url: String,
    window: Window,
    state: State<'_, UpdateDownloadState>,
) -> Result<(), String> {
    set_download_progress(&state, 0.0);

    let result = download_and_install_update_inner(url, window.clone(), &state).await;
    if let Err(error) = &result {
        set_download_error(&state, error);
        let _ = window.emit(
            "update-download-error",
            ErrorPayload {
                error: error.clone(),
            },
        );
    }
    result
}

async fn download_and_install_update_inner(
    url: String,
    window: Window,
    state: &UpdateDownloadState,
) -> Result<(), String> {
    log::info!("Starting update download from: {}", url);
    let client = Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!(
            "HTTP Error when downloading update: {}",
            res.status()
        ));
    }

    let total_size = res.content_length().unwrap_or(0) as f64;

    let mut temp_path = env::temp_dir();
    let file_name = if cfg!(target_os = "windows") {
        "LazyTerm_Update.exe"
    } else if cfg!(target_os = "macos") {
        "LazyTerm_Update.dmg"
    } else {
        return Err("Unsupported OS for auto update".to_string());
    };
    temp_path.push(file_name);

    let mut file =
        File::create(&temp_path).map_err(|e| format!("Failed to create temp file: {}", e))?;
    let mut downloaded: f64 = 0.0;

    let mut stream = res.bytes_stream();

    // Default initial broadcast
    let _ = window.emit("update-progress", ProgressPayload { progress: 0.0 });

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Network error stream: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Disk write error: {}", e))?;
        downloaded += chunk.len() as f64;

        if total_size > 0.0 {
            let progress = (downloaded / total_size) * 100.0;
            // Ensure bounds
            let pct = progress.clamp(0.0, 100.0);
            set_download_progress(state, pct);
            let _ = window.emit("update-progress", ProgressPayload { progress: pct });
        }
    }

    // Explicitly flush and drop file handle so installer can execute safely
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    log::info!(
        "Update fully downloaded to {:?}, executing installer...",
        temp_path
    );

    // Launch installer
    #[cfg(target_os = "windows")]
    crate::utils::create_hidden_command(&temp_path)
        .spawn()
        .map_err(|e| format!("Failed to start installer: {}", e))?;

    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&temp_path)
        .spawn()
        .map_err(|e| format!("Failed to start installer: {}", e))?;

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return Err("Unsupported OS for auto update".to_string());

    // Slight delay to ensure spawn finishes resolving
    std::thread::sleep(std::time::Duration::from_millis(500));

    log::info!("Exiting application for update...");
    std::process::exit(0);
}
