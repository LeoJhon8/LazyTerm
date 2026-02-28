// src-tauri/src/main.rs

// 禁止在 Windows 上弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 调用我们在 lib.rs 中定义的 run 函数
    // 注意：app_lib 必须对应 Cargo.toml 中 [lib] 的 name
    app_lib::run();
}