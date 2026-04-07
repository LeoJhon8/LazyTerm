use std::env;
use std::path::PathBuf;

fn compile_wrapper(include_paths: &[PathBuf]) {
    let wrapper_path = PathBuf::from("src/protocol/vnc_ffi/wrapper.c");
    if !wrapper_path.exists() {
        return;
    }

    let mut build = cc::Build::new();
    build.file(&wrapper_path);

    if env::var("CARGO_CFG_TARGET_OS").ok().as_deref() == Some("windows") {
        build.flag_if_supported("/utf-8");
    }

    for include_path in include_paths {
        build.include(include_path);
    }

    build.compile("vnc_wrapper");
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key).map(PathBuf::from)
}

fn default_windows_vnc_roots() -> Vec<PathBuf> {
    vec![
        PathBuf::from(r"C:\dev\libvncserver\install"),
        PathBuf::from(r"C:\libvncserver\install"),
    ]
}

fn try_windows_root(root_dir: &PathBuf, lib_name: &str) -> Result<bool, String> {
    let include_dir = root_dir.join("include");
    let lib_dir = root_dir.join("lib");

    if include_dir.exists() && lib_dir.exists() {
        emit_manual_windows_link(&[include_dir], &lib_dir, lib_name);
        return Ok(true);
    }

    Ok(false)
}

fn emit_manual_windows_link(include_paths: &[PathBuf], lib_dir: &PathBuf, lib_name: &str) {
    compile_wrapper(include_paths);
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib={lib_name}");
    println!("cargo:rustc-link-lib=ws2_32");
    println!("cargo:rustc-link-lib=crypt32");
    println!("cargo:rustc-link-lib=user32");
    println!("cargo:rustc-link-lib=advapi32");
}

fn probe_manual_windows_install() -> Result<bool, String> {
    let include_dir = env_path("LIBVNCCLIENT_INCLUDE_DIR");
    let lib_dir = env_path("LIBVNCCLIENT_LIB_DIR");
    let root_dir = env_path("LIBVNCSERVER_ROOT");
    let lib_name = env::var("LIBVNCCLIENT_LIB_NAME").unwrap_or_else(|_| "vncclient".to_string());

    if let (Some(include_dir), Some(lib_dir)) = (include_dir, lib_dir) {
        emit_manual_windows_link(&[include_dir], &lib_dir, &lib_name);
        return Ok(true);
    }

    if let Some(root_dir) = root_dir {
        if try_windows_root(&root_dir, &lib_name)? {
            return Ok(true);
        }

        return Err(format!(
            "LIBVNCSERVER_ROOT 已设置为 {}，但未找到 include/lib 子目录",
            root_dir.display()
        ));
    }

    for candidate in default_windows_vnc_roots() {
        if try_windows_root(&candidate, &lib_name)? {
            println!("cargo:warning=Using auto-detected LIBVNCSERVER_ROOT={}", candidate.display());
            return Ok(true);
        }
    }

    Ok(false)
}

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
    let _target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();

    println!("cargo:rerun-if-changed=src/protocol/vnc_ffi/wrapper.c");
    println!("cargo:rustc-check-cfg=cfg(libvncclient_available)");

    let libvncclient_available = if target_os == "windows" {
        match probe_manual_windows_install() {
            Ok(true) => true,
            Ok(false) => {
                panic!(
                    "LibVNCClient not found for Windows/MSVC.\n\
                     vcpkg 当前没有 libvncserver port，因此请先用官方源码自行构建并安装，再通过下面任一方式暴露给 Cargo：\n\
                     方式 A：设置 LIBVNCSERVER_ROOT=<安装前缀目录>，要求目录下存在 include 和 lib\n\
                     方式 B：分别设置 LIBVNCCLIENT_INCLUDE_DIR 和 LIBVNCCLIENT_LIB_DIR\n\
                     可参考命令：\n\
                     1. git clone https://github.com/LibVNC/libvncserver C:\\dev\\libvncserver\n\
                     2. cmake -S C:\\dev\\libvncserver -B C:\\dev\\libvncserver\\build-msvc -G \"Visual Studio 17 2022\" -A x64 -DWITH_OPENSSL=ON -DWITH_GNUTLS=OFF -DWITH_SDL=OFF -DWITH_GTK=OFF -DWITH_EXAMPLES=OFF -DWITH_TESTS=OFF -DCMAKE_INSTALL_PREFIX=C:\\dev\\libvncserver\\install\n\
                     3. cmake --build C:\\dev\\libvncserver\\build-msvc --config Release\n\
                     4. cmake --install C:\\dev\\libvncserver\\build-msvc --config Release\n\
                     5. 默认会自动探测 C:\\dev\\libvncserver\\install；如果你安装到其他目录，再在当前终端设置：$env:LIBVNCSERVER_ROOT='你的安装目录'
                     6. 然后重新运行 npm run tauri dev
                     注意：MSYS2 pacman 安装的 mingw 版本不能链接到当前 Rust 目标 x86_64-pc-windows-msvc。"
                );
            }
            Err(error) => {
                panic!("LibVNCClient Windows 配置无效: {error}");
            }
        }
    } else {
        match pkg_config::Config::new()
            .atleast_version("0.9")
            .probe("libvncclient") {
            Ok(library) => {
                compile_wrapper(&library.include_paths);
                true
            }
            Err(error) => {
                panic!(
                    "LibVNCClient not found: {error}\n\
                     Ubuntu/Debian: sudo apt-get install libvncclient-dev\n\
                     macOS: brew install libvncserver"
                );
            }
        }
    };

    if libvncclient_available {
        println!("cargo:rustc-cfg=libvncclient_available");
    }

    // Windows 特定的链接设置
    if target_os == "windows" {
        // println!("cargo:rustc-link-lib=user32");
        // println!("cargo:rustc-link-lib=gdi32");
    }

    // 运行 Tauri 构建
    tauri_build::build();
}
