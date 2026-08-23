use serde::Serialize;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime, State};

const ANDROID_PLUGIN_PACKAGE: &str = "com.lazyterm";
const ANDROID_PLUGIN_CLASS: &str = "AndroidUpdaterPlugin";

pub struct AndroidUpdater<R: Runtime> {
    handle: PluginHandle<R>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallApkRequest {
    path: String,
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-updater")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(ANDROID_PLUGIN_PACKAGE, ANDROID_PLUGIN_CLASS)?;
            app.manage(AndroidUpdater { handle });
            Ok(())
        })
        .build()
}

#[tauri::command]
pub fn get_android_arch() -> &'static str {
    std::env::consts::ARCH
}

#[tauri::command]
pub async fn install_android_update<R: Runtime>(
    app: AppHandle<R>,
    updater: State<'_, AndroidUpdater<R>>,
) -> Result<(), String> {
    let apk_path = crate::protocol::update_temp_path(&app)?;
    let metadata = std::fs::metadata(&apk_path)
        .map_err(|error| format!("Failed to find downloaded APK: {}", error))?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("The downloaded APK is invalid".to_string());
    }

    updater
        .handle
        .run_mobile_plugin_async::<()>(
            "installApk",
            InstallApkRequest {
                path: apk_path.to_string_lossy().into_owned(),
            },
        )
        .await
        .map_err(|error| error.to_string())
}
