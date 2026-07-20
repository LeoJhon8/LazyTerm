use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn feature_enabled(name: &str) -> bool {
    env::var_os(name).is_some()
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key).map(PathBuf::from)
}

fn compile_c_wrapper(wrapper_path: &str, include_paths: &[PathBuf], output_name: &str) {
    let wrapper_path = PathBuf::from(wrapper_path);
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

    build.compile(output_name);
}

fn existing_paths(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    paths
        .into_iter()
        .filter(|path| path.exists())
        .filter(|path| seen.insert(path.clone()))
        .collect()
}

fn default_windows_vnc_roots() -> Vec<PathBuf> {
    vec![
        PathBuf::from(r"C:\dev\libvncserver\install"),
        PathBuf::from(r"C:\libvncserver\install"),
    ]
}

fn default_windows_openssl_roots() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(root_dir) = env_path("OPENSSL_ROOT_DIR") {
        candidates.push(root_dir);
    }

    candidates.extend([
        PathBuf::from(r"C:\Program Files\OpenSSL-Win64"),
        PathBuf::from(r"C:\OpenSSL-Win64"),
        PathBuf::from(r"C:\Program Files\OpenSSL"),
    ]);

    existing_paths(candidates)
}

fn emit_windows_openssl_link() {
    if let Some(lib_dir) = env_path("OPENSSL_LIB_DIR") {
        println!("cargo:rustc-link-search=native={}", lib_dir.display());
    } else {
        for root_dir in default_windows_openssl_roots() {
            for lib_dir in [root_dir.join(r"lib\VC\x64\MD"), root_dir.join("lib")] {
                if lib_dir.exists() {
                    println!("cargo:rustc-link-search=native={}", lib_dir.display());
                }
            }
        }
    }

    let ssl_lib = env::var("OPENSSL_SSL_LIB_NAME").unwrap_or_else(|_| "libssl".to_string());
    let crypto_lib =
        env::var("OPENSSL_CRYPTO_LIB_NAME").unwrap_or_else(|_| "libcrypto".to_string());
    println!("cargo:rustc-link-lib={ssl_lib}");
    println!("cargo:rustc-link-lib={crypto_lib}");
}

fn vnc_windows_include_paths(root_dir: &Path) -> Vec<PathBuf> {
    existing_paths([root_dir.join("include")])
}

fn emit_manual_windows_vnc_link(include_paths: &[PathBuf], lib_dir: &Path, lib_name: &str) {
    compile_c_wrapper(
        "src/protocol/vnc_ffi/wrapper.c",
        include_paths,
        "vnc_wrapper",
    );
    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib={lib_name}");
    emit_windows_openssl_link();
    println!("cargo:rustc-link-lib=ws2_32");
    println!("cargo:rustc-link-lib=crypt32");
    println!("cargo:rustc-link-lib=user32");
    println!("cargo:rustc-link-lib=advapi32");
}

fn try_windows_vnc_root(root_dir: &Path, lib_name: &str) -> bool {
    let include_paths = vnc_windows_include_paths(root_dir);
    let lib_dir = root_dir.join("lib");

    if !include_paths.is_empty() && lib_dir.exists() {
        emit_manual_windows_vnc_link(&include_paths, &lib_dir, lib_name);
        return true;
    }

    false
}

fn probe_manual_windows_vnc_install() -> Result<bool, String> {
    let include_dir = env_path("LIBVNCCLIENT_INCLUDE_DIR");
    let lib_dir = env_path("LIBVNCCLIENT_LIB_DIR");
    let root_dir = env_path("LIBVNCSERVER_ROOT");
    let lib_name = env::var("LIBVNCCLIENT_LIB_NAME").unwrap_or_else(|_| "vncclient".to_string());

    if let (Some(include_dir), Some(lib_dir)) = (include_dir, lib_dir) {
        emit_manual_windows_vnc_link(&[include_dir], &lib_dir, &lib_name);
        return Ok(true);
    }

    if let Some(root_dir) = root_dir {
        if try_windows_vnc_root(&root_dir, &lib_name) {
            return Ok(true);
        }

        return Err(format!(
            "LIBVNCSERVER_ROOT is set to {}, but include/lib was not found",
            root_dir.display()
        ));
    }

    for candidate in default_windows_vnc_roots() {
        if try_windows_vnc_root(&candidate, &lib_name) {
            println!(
                "cargo:warning=Using auto-detected LIBVNCSERVER_ROOT={}",
                candidate.display()
            );
            return Ok(true);
        }
    }

    Ok(false)
}

fn probe_vnc(target_os: &str) {
    if !feature_enabled("CARGO_FEATURE_VNC_LIBVNCCLIENT") {
        return;
    }

    let libvncclient_available = if target_os == "windows" {
        match probe_manual_windows_vnc_install() {
            Ok(true) => true,
            Ok(false) => {
                panic!(
                    "LibVNCClient not found for Windows/MSVC.\n\
                     Set LIBVNCSERVER_ROOT to an install prefix containing include/lib, or set \
                     LIBVNCCLIENT_INCLUDE_DIR and LIBVNCCLIENT_LIB_DIR."
                );
            }
            Err(error) => {
                panic!("Invalid LibVNCClient Windows configuration: {error}");
            }
        }
    } else {
        match pkg_config::Config::new()
            .atleast_version("0.9")
            .probe("libvncclient")
        {
            Ok(library) => {
                compile_c_wrapper(
                    "src/protocol/vnc_ffi/wrapper.c",
                    &library.include_paths,
                    "vnc_wrapper",
                );
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
}

fn default_windows_freerdp_roots() -> Vec<PathBuf> {
    vec![
        PathBuf::from(r"C:\dev\freerdp\install"),
        PathBuf::from(r"C:\FreeRDP"),
        PathBuf::from(r"C:\dev\FreeRDP\install"),
    ]
}

fn freerdp_include_paths_from_dir(include_dir: &Path) -> Vec<PathBuf> {
    existing_paths([
        include_dir.to_path_buf(),
        include_dir.join("freerdp3"),
        include_dir.join("winpr3"),
    ])
}

fn freerdp_include_paths_from_root(root_dir: &Path) -> Vec<PathBuf> {
    freerdp_include_paths_from_dir(&root_dir.join("include"))
}

fn emit_manual_windows_freerdp_link(
    include_paths: &[PathBuf],
    lib_dir: &Path,
    bin_dir: &Path,
    freerdp_lib: &str,
    freerdp_client_lib: &str,
    winpr_lib: &str,
) {
    compile_c_wrapper(
        "src/protocol/freerdp_ffi/wrapper.c",
        include_paths,
        "freerdp_wrapper",
    );

    println!("cargo:rustc-link-search=native={}", lib_dir.display());
    println!("cargo:rustc-link-lib={freerdp_client_lib}");
    println!("cargo:rustc-link-lib={freerdp_lib}");
    println!("cargo:rustc-link-lib={winpr_lib}");

    for lib in [
        "ws2_32", "secur32", "crypt32", "user32", "gdi32", "advapi32", "ole32", "shell32",
        "iphlpapi", "dnsapi", "version", "shlwapi",
    ] {
        println!("cargo:rustc-link-lib={lib}");
    }

    copy_windows_runtime_dlls(bin_dir);
}

fn try_windows_freerdp_root(
    root_dir: &Path,
    freerdp_lib: &str,
    freerdp_client_lib: &str,
    winpr_lib: &str,
) -> bool {
    let include_paths = freerdp_include_paths_from_root(root_dir);
    let lib_dir = root_dir.join("lib");

    let bin_dir = root_dir.join("bin");

    if !include_paths.is_empty() && lib_dir.exists() && bin_dir.exists() {
        emit_manual_windows_freerdp_link(
            &include_paths,
            &lib_dir,
            &bin_dir,
            freerdp_lib,
            freerdp_client_lib,
            winpr_lib,
        );
        return true;
    }

    false
}

fn probe_manual_windows_freerdp_install() -> Result<bool, String> {
    let include_dir = env_path("FREERDP_INCLUDE_DIR");
    let lib_dir = env_path("FREERDP_LIB_DIR");
    let root_dir = env_path("FREERDP_ROOT");
    let freerdp_lib = env::var("FREERDP_LIB_NAME").unwrap_or_else(|_| "freerdp3".to_string());
    let freerdp_client_lib =
        env::var("FREERDP_CLIENT_LIB_NAME").unwrap_or_else(|_| "freerdp-client3".to_string());
    let winpr_lib = env::var("WINPR_LIB_NAME").unwrap_or_else(|_| "winpr3".to_string());

    if let (Some(include_dir), Some(lib_dir)) = (include_dir, lib_dir) {
        let include_paths = freerdp_include_paths_from_dir(&include_dir);
        let bin_dir = lib_dir
            .parent()
            .map(|root| root.join("bin"))
            .unwrap_or_else(|| PathBuf::from("bin"));
        emit_manual_windows_freerdp_link(
            &include_paths,
            &lib_dir,
            &bin_dir,
            &freerdp_lib,
            &freerdp_client_lib,
            &winpr_lib,
        );
        return Ok(true);
    }

    if let Some(root_dir) = root_dir {
        if try_windows_freerdp_root(&root_dir, &freerdp_lib, &freerdp_client_lib, &winpr_lib) {
            return Ok(true);
        }

        return Err(format!(
            "FREERDP_ROOT is set to {}, but include/lib was not found",
            root_dir.display()
        ));
    }

    for candidate in default_windows_freerdp_roots() {
        if try_windows_freerdp_root(&candidate, &freerdp_lib, &freerdp_client_lib, &winpr_lib) {
            println!(
                "cargo:warning=Using auto-detected FREERDP_ROOT={}",
                candidate.display()
            );
            return Ok(true);
        }
    }

    Ok(false)
}

fn profile_output_dir() -> Option<PathBuf> {
    let out_dir = PathBuf::from(env::var_os("OUT_DIR")?);
    out_dir.ancestors().nth(3).map(Path::to_path_buf)
}

fn copy_dlls_from_dir(source_dir: &Path, dll_names: &[&str]) {
    if !source_dir.exists() {
        return;
    }

    let Some(output_dir) = profile_output_dir() else {
        return;
    };

    for dll_name in dll_names {
        let source = source_dir.join(dll_name);
        if !source.exists() {
            continue;
        }

        let target = output_dir.join(dll_name);
        if let Err(error) = fs::copy(&source, &target) {
            println!(
                "cargo:warning=Failed to copy runtime DLL {} to {}: {}",
                source.display(),
                target.display(),
                error
            );
        }
    }
}

fn default_windows_openssl_bin_dirs() -> Vec<PathBuf> {
    default_windows_openssl_roots()
        .into_iter()
        .map(|root_dir| root_dir.join("bin"))
        .collect()
}

fn copy_windows_runtime_dlls(freerdp_bin_dir: &Path) {
    let freerdp_dlls = [
        "freerdp-client3.dll",
        "freerdp3.dll",
        "winpr3.dll",
        "winpr-tools3.dll",
    ];
    let openssl_dlls = [
        "libcrypto-3-x64.dll",
        "libssl-3-x64.dll",
        "libcrypto-4-x64.dll",
        "libssl-4-x64.dll",
    ];
    // Keep machine-local dependencies out of the tracked runtime directory. The
    // checked-in DLLs are release assets and should only change during an
    // intentional runtime upgrade; normal builds only need DLLs beside the
    // executable in Cargo's ignored target directory.
    copy_dlls_from_dir(freerdp_bin_dir, &freerdp_dlls);

    for openssl_bin_dir in default_windows_openssl_bin_dirs() {
        copy_dlls_from_dir(&openssl_bin_dir, &openssl_dlls);
    }
}

fn probe_freerdp(target_os: &str) {
    if !feature_enabled("CARGO_FEATURE_RDP_FREERDP") {
        return;
    }

    let freerdp_available = if target_os == "windows" {
        match probe_manual_windows_freerdp_install() {
            Ok(true) => true,
            Ok(false) => {
                println!(
                    "cargo:warning=FreeRDP 3 not found for Windows/MSVC; the embedded FreeRDP \
                     backend will be disabled. Set FREERDP_ROOT to an install prefix containing \
                     include/lib/bin, or set FREERDP_INCLUDE_DIR and FREERDP_LIB_DIR to enable it. \
                     Required libraries: freerdp-client3, freerdp3, winpr3."
                );
                false
            }
            Err(error) => {
                panic!("Invalid FreeRDP Windows configuration: {error}");
            }
        }
    } else {
        let mut include_paths = Vec::new();
        for package in ["freerdp3", "freerdp-client3", "winpr3"] {
            match pkg_config::Config::new().probe(package) {
                Ok(library) => include_paths.extend(library.include_paths),
                Err(error) => {
                    panic!(
                        "FreeRDP package {package} not found: {error}\n\
                         Ubuntu/Debian: sudo apt-get install freerdp3-dev\n\
                         macOS: brew install freerdp"
                    );
                }
            }
        }

        let include_paths = existing_paths(include_paths);
        compile_c_wrapper(
            "src/protocol/freerdp_ffi/wrapper.c",
            &include_paths,
            "freerdp_wrapper",
        );
        true
    };

    if freerdp_available {
        println!("cargo:rustc-cfg=freerdp_available");
    }
}

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();

    println!("cargo:rerun-if-changed=src/protocol/vnc_ffi/wrapper.c");
    println!("cargo:rerun-if-changed=src/protocol/freerdp_ffi/wrapper.c");
    for variable in [
        "FREERDP_ROOT",
        "FREERDP_INCLUDE_DIR",
        "FREERDP_LIB_DIR",
        "FREERDP_LIB_NAME",
        "FREERDP_CLIENT_LIB_NAME",
        "WINPR_LIB_NAME",
        "OPENSSL_ROOT_DIR",
        "OPENSSL_LIB_DIR",
        "OPENSSL_SSL_LIB_NAME",
        "OPENSSL_CRYPTO_LIB_NAME",
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
    }
    println!("cargo:rustc-check-cfg=cfg(libvncclient_available)");
    println!("cargo:rustc-check-cfg=cfg(freerdp_available)");

    probe_vnc(&target_os);
    probe_freerdp(&target_os);

    tauri_build::build();
}
