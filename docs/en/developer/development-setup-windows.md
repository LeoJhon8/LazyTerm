# Windows Development Setup

> [简体中文](../../developer/development-setup-windows.md) | **English**

This guide prepares the LazyTerm frontend, Rust backend, VNC, and both RDP paths on Windows x64. Commands use PowerShell and the Rust target is `x86_64-pc-windows-msvc`.

## Required Components

Base development environment:

1. Git
2. Node.js 20+ and npm
3. Rustup with Rust 1.85+ stable MSVC toolchain
4. Microsoft Edge WebView2 Runtime
5. Visual Studio 2022 Build Tools
6. CMake

Select at least these Visual Studio components:

- `Desktop development with C++`
- MSVC v143 or newer
- Windows 10/11 SDK
- C++ CMake tools for Windows

Feature-specific dependencies:

| Feature | Dependency |
| --- | --- |
| Native MsTscAx RDP | .NET SDK 8+ |
| VNC | LibVNCClient and OpenSSL development files |
| Embedded FreeRDP | FreeRDP 3 and WinPR 3 headers, libraries, and runtime DLLs |

## Verify the Toolchain

Open a new PowerShell after installation:

```powershell
git --version
node -v
npm -v
rustc -V
cargo -V
rustup show
dotnet --version
cmake --version
where.exe cl
```

`where.exe cl` may fail in a normal PowerShell, but it should work in Visual Studio Developer PowerShell. If neither finds it, the C++ workload is probably incomplete.

## Automated Setup Script

The repository includes a Windows helper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows-dev.ps1
```

It checks or installs common tools, installs npm dependencies, builds the MsTscAx sidecar, and prepares LibVNCClient. It uses `winget` or Chocolatey and may need administrator rights for system packages.

Useful options:

```powershell
# Detect and prepare without installing missing system packages
.\scripts\setup-windows-dev.ps1 -SkipPackageInstall

# Skip expensive steps when dependencies already exist
.\scripts\setup-windows-dev.ps1 -SkipLibVncBuild -SkipNpmInstall -SkipMsRdpSidecarBuild

# Persist detected environment variables for the user
.\scripts\setup-windows-dev.ps1 -PersistUserEnvironment
```

The current script does not build FreeRDP; prepare it separately for the embedded RDP path.

## Clone and Install

```powershell
git clone https://github.com/An-egg/LazyTerm.git lazy-terminal
Set-Location .\lazy-terminal
npm ci
rustup target add x86_64-pc-windows-msvc
```

## LibVNCClient

The default `vnc-libvncclient` feature requires an MSVC build of LibVNCClient. The recommended prefix is:

```text
C:\dev\libvncserver\install
```

Run the dedicated script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-libvncserver-msvc.ps1 `
  -GitRef LibVNCServer-0.9.14 `
  -SourceDir C:\dev\libvncserver `
  -InstallDir C:\dev\libvncserver\install `
  -Configuration Release `
  -EnableSystemOpenSSL
```

Or build manually:

```powershell
git clone --branch LibVNCServer-0.9.14 --depth 1 https://github.com/LibVNC/libvncserver C:\dev\libvncserver
cmake -S C:\dev\libvncserver -B C:\dev\libvncserver\build-msvc -G "Visual Studio 17 2022" -A x64 -DWITH_OPENSSL=ON -DWITH_GNUTLS=OFF -DWITH_SDL=OFF -DWITH_GTK=OFF -DWITH_EXAMPLES=OFF -DWITH_TESTS=OFF -DCMAKE_INSTALL_PREFIX=C:\dev\libvncserver\install
cmake --build C:\dev\libvncserver\build-msvc --config Release
cmake --install C:\dev\libvncserver\build-msvc --config Release
```

For a non-default prefix:

```powershell
$env:LIBVNCSERVER_ROOT = "D:\native\libvncserver\install"
```

The build expects at least:

```text
include\rfb\rfbclient.h
lib\vncclient.lib
```

Do not link an MSYS2/MinGW build into the `x86_64-pc-windows-msvc` target.

## FreeRDP 3

Embedded RDP uses the default `rdp-freerdp` feature. Windows discovery order is:

1. `FREERDP_INCLUDE_DIR` plus `FREERDP_LIB_DIR`
2. `FREERDP_ROOT`
3. `C:\dev\freerdp\install`, `C:\FreeRDP`, and `C:\dev\FreeRDP\install`

Recommended layout:

```text
C:\dev\freerdp\install\
  include\freerdp3\
  include\winpr3\
  lib\
  bin\
```

For a non-default prefix:

```powershell
$env:FREERDP_ROOT = "D:\native\freerdp\install"
```

Default library names are `freerdp-client3`, `freerdp3`, and `winpr3`. Override them if necessary:

```powershell
$env:FREERDP_CLIENT_LIB_NAME = "freerdp-client3"
$env:FREERDP_LIB_NAME = "freerdp3"
$env:WINPR_LIB_NAME = "winpr3"
```

If no valid installation is found, Rust disables the embedded FreeRDP backend and emits a warning. A correctly built MsTscAx path can still work on Windows, but sessions configured for the default FreeRDP path will not.

## OpenSSL and Runtime DLLs

Windows checks `OPENSSL_ROOT_DIR` / `OPENSSL_LIB_DIR` and several common install locations. If necessary:

```powershell
$env:OPENSSL_ROOT_DIR = "C:\Program Files\OpenSSL-Win64"
```

`build.rs` copies detected FreeRDP, WinPR, and OpenSSL DLLs into the Cargo profile output. `src-tauri\native\freerdp-runtime\win-x64` contains controlled release assets and should not be overwritten by routine local builds.

## MsTscAx Sidecar

Source location:

```text
src-tauri\native\msrdpax-host
```

Build commands:

```powershell
npm run build:msrdpax-sidecar:debug
npm run build:msrdpax-sidecar:release
```

Published files go to `src-tauri\native\msrdpax-host\publish\win-x64`, which Tauri includes as a bundle resource.

## Start and Check

```powershell
npm run tauri:dev
& .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
cargo check --manifest-path .\src-tauri\Cargo.toml
```

If `cargo check` cannot find a native library, inspect the current PowerShell environment and install prefixes rather than bypassing discovery in application code.

## Common Problems

- `dotnet SDK was not found`: install .NET SDK 8+ and reopen PowerShell.
- Missing `libvncclient` / `vncclient.lib`: check `LIBVNCSERVER_ROOT` and the MSVC output.
- FreeRDP backend disabled: check `include`, `lib`, and `bin` under `FREERDP_ROOT`.
- OpenSSL symbol or DLL errors: ensure headers, import libraries, and runtime DLLs are compatible x64 versions.
- `node` remains unavailable after installation: reopen the terminal so PATH is refreshed.
