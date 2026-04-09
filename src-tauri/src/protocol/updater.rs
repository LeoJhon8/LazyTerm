use tauri::{Emitter, Window};
use std::fs::File;
use std::io::Write;
use reqwest::Client;
use futures::StreamExt;
use serde::Serialize;
use std::env;

#[derive(Clone, Serialize)]
struct ProgressPayload {
    progress: f64,
}

#[tauri::command]
pub async fn download_and_install_update(url: String, window: Window) -> Result<(), String> {
    log::info!("Starting update download from: {}", url);
    let client = Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        return Err(format!("HTTP Error when downloading update: {}", res.status()));
    }
    
    let total_size = res.content_length().unwrap_or(0) as f64;
    
    let mut temp_path = env::temp_dir();
    temp_path.push("LazyTerm_Update.exe");
    
    let mut file = File::create(&temp_path).map_err(|e| format!("Failed to create temp file: {}", e))?;
    let mut downloaded: f64 = 0.0;
    
    let mut stream = res.bytes_stream();
    
    // Default initial broadcast
    let _ = window.emit("update-progress", ProgressPayload { progress: 0.0 });
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Network error stream: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("Disk write error: {}", e))?;
        downloaded += chunk.len() as f64;
        
        if total_size > 0.0 {
            let progress = (downloaded / total_size) * 100.0;
            // Ensure bounds
            let pct = progress.clamp(0.0, 100.0);
            let _ = window.emit("update-progress", ProgressPayload { progress: pct });
        }
    }
    
    // Explicitly flush and drop file handle so installer can execute safely
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    
    log::info!("Update fully downloaded to {:?}, executing installer...", temp_path);
    
    // Launch installer
    std::process::Command::new(&temp_path)
        .spawn()
        .map_err(|e| format!("Failed to start installer: {}", e))?;
        
    // Slight delay to ensure spawn finishes resolving
    std::thread::sleep(std::time::Duration::from_millis(500));
    
    log::info!("Exiting application for update...");
    std::process::exit(0);
}
