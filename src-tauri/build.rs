use std::env;
use std::path::PathBuf;

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let _target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();

    println!("cargo:rerun-if-changed=src/protocol/vnc_ffi/wrapper.c");

    // 尝试查找 libvncclient
    let libvncclient_found = pkg_config::Config::new()
        .atleast_version("0.9")
        .probe("libvncclient")
        .is_ok();

    if libvncclient_found {
        println!("cargo:rustc-cfg=libvncclient_available");

        // 编译 C 包装器
        let wrapper_path = PathBuf::from("src/protocol/vnc_ffi/wrapper.c");
        if wrapper_path.exists() {
            cc::Build::new()
                .file(&wrapper_path)
                .include("/usr/include")
                .include("/usr/local/include")
                .compile("vnc_wrapper");
        }
    } else {
        // LibVNCClient 未安装，发出错误
        panic!(
            "LibVNCClient not found! Please install it:\n\
             Ubuntu/Debian: sudo apt-get install libvncclient-dev\n\
             macOS: brew install libvncserver\n\
             Windows: Use MSYS2 (pacman -S mingw-w64-x86_64-libvncserver)"
        );
    }

    // Windows 特定的链接设置
    if target_os == "windows" {
        // println!("cargo:rustc-link-lib=user32");
        // println!("cargo:rustc-link-lib=gdi32");
    }

    // 运行 Tauri 构建
    tauri_build::build();
}
