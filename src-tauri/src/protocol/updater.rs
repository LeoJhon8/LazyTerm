use futures::StreamExt;
use reqwest::Client;
use serde::Serialize;
use std::env;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, State, Window};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadStatus {
    downloading: bool,
    progress: Option<f64>,
    error: Option<String>,
    downloaded_url: Option<String>,
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

#[derive(Clone, Serialize)]
struct DownloadCompletePayload {
    url: String,
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

fn begin_download(state: &UpdateDownloadState) -> Result<(), String> {
    let mut status = state
        .status
        .lock()
        .map_err(|_| "Failed to update download status".to_string())?;

    if status.downloading {
        return Err("An update is already being downloaded".to_string());
    }

    status.downloading = true;
    status.progress = Some(0.0);
    status.error = None;
    status.downloaded_url = None;
    Ok(())
}

fn set_download_progress(state: &UpdateDownloadState, progress: f64) {
    if let Ok(mut status) = state.status.lock() {
        status.progress = Some(progress);
    }
}

fn set_download_error(state: &UpdateDownloadState, error: &str) {
    if let Ok(mut status) = state.status.lock() {
        status.downloading = false;
        status.progress = None;
        status.error = Some(error.to_string());
        status.downloaded_url = None;
    }
}

fn set_download_complete(state: &UpdateDownloadState, url: String) {
    if let Ok(mut status) = state.status.lock() {
        status.downloading = false;
        status.progress = None;
        status.error = None;
        status.downloaded_url = Some(url);
    }
}

#[tauri::command]
pub async fn download_update(
    url: String,
    window: Window,
    state: State<'_, UpdateDownloadState>,
) -> Result<(), String> {
    begin_download(&state)?;

    let result = download_update_inner(&url, window.clone(), &state).await;
    if let Err(error) = &result {
        set_download_error(&state, error);
        let _ = window.emit(
            "update-download-error",
            ErrorPayload {
                error: error.clone(),
            },
        );
    } else {
        set_download_complete(&state, url.clone());
        let _ = window.emit("update-progress", ProgressPayload { progress: 100.0 });
        let _ = window.emit("update-download-complete", DownloadCompletePayload { url });
    }
    result
}

async fn download_update_inner(
    url: &str,
    window: Window,
    state: &UpdateDownloadState,
) -> Result<(), String> {
    log::info!("Starting update download from: {}", url);
    let client = Client::new();
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!(
            "HTTP Error when downloading update: {}",
            res.status()
        ));
    }

    let total_size = res.content_length().unwrap_or(0) as f64;

    let temp_path = update_temp_path()?;

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

    log::info!("Update fully downloaded to {:?}", temp_path);

    Ok(())
}

fn update_temp_path() -> Result<PathBuf, String> {
    let mut temp_path = env::temp_dir();
    let file_name = if cfg!(target_os = "windows") {
        "LazyTerm_Update.exe"
    } else if cfg!(target_os = "macos") {
        "LazyTerm_Update.dmg"
    } else {
        return Err("Unsupported OS for auto update".to_string());
    };
    temp_path.push(file_name);
    Ok(temp_path)
}

#[tauri::command]
pub fn install_update(state: State<'_, UpdateDownloadState>) -> Result<(), String> {
    {
        let status = state
            .status
            .lock()
            .map_err(|_| "Failed to read update download status".to_string())?;

        if status.downloading || status.downloaded_url.is_none() {
            return Err("The update package has not been downloaded".to_string());
        }
    }

    let temp_path = update_temp_path()?;
    let metadata = std::fs::metadata(&temp_path)
        .map_err(|e| format!("Failed to find downloaded update package: {}", e))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("The downloaded update package is invalid".to_string());
    }

    log::info!("Starting update installer from {:?}", temp_path);

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
