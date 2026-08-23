use serde::Serialize;
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Runtime, State};

const ANDROID_PLUGIN_PACKAGE: &str = "com.lazyterm";
const ANDROID_PLUGIN_CLASS: &str = "AndroidSshBackgroundPlugin";

pub struct AndroidSshBackground<R: Runtime> {
    handle: PluginHandle<R>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveSshSessionRequest {
    active_sessions: u32,
    title: String,
    text: String,
}

#[derive(Serialize)]
struct EmptyRequest {}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-ssh-background")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin(ANDROID_PLUGIN_PACKAGE, ANDROID_PLUGIN_CLASS)?;
            app.manage(AndroidSshBackground { handle });
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn set_android_ssh_session_count<R: Runtime>(
    _app: AppHandle<R>,
    background: State<'_, AndroidSshBackground<R>>,
    active_sessions: u32,
    title: String,
    text: String,
) -> Result<(), String> {
    background
        .handle
        .run_mobile_plugin_async::<()>(
            "setActiveSessionCount",
            ActiveSshSessionRequest {
                active_sessions,
                title,
                text,
            },
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_android_app_settings<R: Runtime>(
    _app: AppHandle<R>,
    background: State<'_, AndroidSshBackground<R>>,
) -> Result<(), String> {
    background
        .handle
        .run_mobile_plugin_async::<()>("openAppSettings", EmptyRequest {})
        .await
        .map_err(|error| error.to_string())
}
