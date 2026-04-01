// src-tauri/src/main.rs

// 禁止在 Windows 上弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Prefer software rendering in headless/dev Linux environments to avoid noisy EGL/Zink failures.
        if std::env::var_os("LIBGL_ALWAYS_SOFTWARE").is_none() {
            std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    // 调用我们在 lib.rs 中定义的 run 函数
    // 注意：app_lib 必须对应 Cargo.toml 中 [lib] 的 name
    app_lib::run();
}
