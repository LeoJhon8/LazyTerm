use futures::StreamExt;
use reqwest::Client;
use serde::Serialize;
#[cfg(not(target_os = "android"))]
use std::env;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Window};

#[cfg(target_os = "android")]
use sha2::{Digest, Sha256};

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
    expected_sha256: Option<String>,
    window: Window,
    state: State<'_, UpdateDownloadState>,
) -> Result<(), String> {
    begin_download(&state)?;

    let result =
        download_update_inner(&url, expected_sha256.as_deref(), window.clone(), &state).await;
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
    expected_sha256: Option<&str>,
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

    let temp_path = update_temp_path(window.app_handle())?;

    let mut file =
        File::create(&temp_path).map_err(|e| format!("Failed to create temp file: {}", e))?;
    let mut downloaded: f64 = 0.0;

    #[cfg(target_os = "android")]
    let mut hasher = Sha256::new();

    #[cfg(not(target_os = "android"))]
    let _ = expected_sha256;

    let mut stream = res.bytes_stream();

    // Default initial broadcast
    let _ = window.emit("update-progress", ProgressPayload { progress: 0.0 });

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Network error stream: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Disk write error: {}", e))?;

        #[cfg(target_os = "android")]
        hasher.update(&chunk);

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

    #[cfg(target_os = "android")]
    if let Some(expected) = expected_sha256 {
        let normalized_expected = expected.trim().to_ascii_lowercase();
        if normalized_expected.len() != 64
            || !normalized_expected
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            let _ = std::fs::remove_file(&temp_path);
            return Err("The expected APK SHA-256 checksum is invalid".to_string());
        }

        let actual = format!("{:x}", hasher.finalize());
        if actual != normalized_expected {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!(
                "APK SHA-256 checksum mismatch (expected {}, got {})",
                normalized_expected, actual
            ));
        }
    }

    log::info!("Update fully downloaded to {:?}", temp_path);

    Ok(())
}

pub(crate) fn update_temp_path<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        let mut update_dir = _app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Failed to resolve app cache directory: {}", error))?;
        update_dir.push("updates");
        std::fs::create_dir_all(&update_dir)
            .map_err(|error| format!("Failed to create update cache directory: {}", error))?;
        update_dir.push("LazyTerm_Update.apk");
        return Ok(update_dir);
    }

    #[cfg(not(target_os = "android"))]
    let mut temp_path = env::temp_dir();

    #[cfg(not(target_os = "android"))]
    let file_name = if cfg!(target_os = "windows") {
        "LazyTerm_Update.exe"
    } else if cfg!(target_os = "macos") {
        "LazyTerm_Update.dmg"
    } else {
        return Err("Unsupported OS for auto update".to_string());
    };

    #[cfg(not(target_os = "android"))]
    temp_path.push(file_name);

    #[cfg(not(target_os = "android"))]
    Ok(temp_path)
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn install_update<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, UpdateDownloadState>,
) -> Result<(), String> {
    {
        let status = state
            .status
            .lock()
            .map_err(|_| "Failed to read update download status".to_string())?;

        if status.downloading || status.downloaded_url.is_none() {
            return Err("The update package has not been downloaded".to_string());
        }
    }

    let temp_path = update_temp_path(&app)?;
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
