# Windows 开发环境

> **简体中文** | [English](../en/developer/development-setup-windows.md)

这份文档说明如何在 Windows x64 上准备 LazyTerm 的前端、Rust、VNC 和两条 RDP 开发路径。默认 shell 为 PowerShell，Rust 目标为 `x86_64-pc-windows-msvc`。

## 必需组件

基础开发环境：

1. Git
2. Node.js 20+ 与 npm
3. Rustup、Rust 1.85+ stable MSVC toolchain
4. Microsoft Edge WebView2 Runtime
5. Visual Studio 2022 Build Tools
6. CMake

Visual Studio Build Tools 至少选择：

- `Desktop development with C++`
- MSVC v143 或更新版本
- Windows 10/11 SDK
- C++ CMake tools for Windows

按功能还需要：

| 功能 | 依赖 |
| --- | --- |
| MsTscAx 原生 RDP | .NET SDK 8+ |
| VNC | LibVNCClient、OpenSSL 开发文件 |
| FreeRDP 内嵌 RDP | FreeRDP 3、WinPR 3 头文件/库/运行时 DLL |

## 验证工具链

安装完成并重新打开 PowerShell 后执行：

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

`where.exe cl` 在普通 PowerShell 中可能找不到 `cl.exe`，但 Visual Studio Developer PowerShell 中应可用。若两处都找不到，通常是 C++ workload 未完整安装。

## 自动初始化脚本

仓库提供 Windows 辅助脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows-dev.ps1
```

它会检查或安装常用工具、安装 npm 依赖、构建 MsTscAx sidecar，并准备 LibVNCClient。脚本会使用 `winget` 或 Chocolatey；安装系统组件可能需要管理员权限。

常用选项：

```powershell
# 只检查/准备项目，不安装缺失的系统包
.\scripts\setup-windows-dev.ps1 -SkipPackageInstall

# 已有依赖时跳过耗时步骤
.\scripts\setup-windows-dev.ps1 -SkipLibVncBuild -SkipNpmInstall -SkipMsRdpSidecarBuild

# 将识别出的环境变量写入用户环境
.\scripts\setup-windows-dev.ps1 -PersistUserEnvironment
```

当前脚本不会构建 FreeRDP；需要 FreeRDP 内嵌路径时必须单独准备。

## 克隆与安装依赖

```powershell
git clone https://github.com/LeoJhon8/LazyTerm.git lazy-terminal
Set-Location .\lazy-terminal
npm ci
rustup target add x86_64-pc-windows-msvc
```

## LibVNCClient

Windows/MSVC 默认 feature `vnc-libvncclient` 需要 MSVC 版本的 LibVNCClient。推荐安装前缀：

```text
C:\dev\libvncserver\install
```

可直接运行专用脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-libvncserver-msvc.ps1 `
  -GitRef LibVNCServer-0.9.14 `
  -SourceDir C:\dev\libvncserver `
  -InstallDir C:\dev\libvncserver\install `
  -Configuration Release `
  -EnableSystemOpenSSL
```

或手工构建：

```powershell
git clone --branch LibVNCServer-0.9.14 --depth 1 https://github.com/LibVNC/libvncserver C:\dev\libvncserver
cmake -S C:\dev\libvncserver -B C:\dev\libvncserver\build-msvc -G "Visual Studio 17 2022" -A x64 -DWITH_OPENSSL=ON -DWITH_GNUTLS=OFF -DWITH_SDL=OFF -DWITH_GTK=OFF -DWITH_EXAMPLES=OFF -DWITH_TESTS=OFF -DCMAKE_INSTALL_PREFIX=C:\dev\libvncserver\install
cmake --build C:\dev\libvncserver\build-msvc --config Release
cmake --install C:\dev\libvncserver\build-msvc --config Release
```

非默认路径：

```powershell
$env:LIBVNCSERVER_ROOT = "D:\native\libvncserver\install"
```

构建脚本期望安装前缀中至少存在：

```text
include\rfb\rfbclient.h
lib\vncclient.lib
```

不要把 MSYS2/MinGW 构建的库链接到 `x86_64-pc-windows-msvc` 目标。

## FreeRDP 3

内嵌 RDP 默认 feature 为 `rdp-freerdp`。Windows 构建按以下顺序发现 FreeRDP：

1. `FREERDP_INCLUDE_DIR` + `FREERDP_LIB_DIR`
2. `FREERDP_ROOT`
3. 自动检测 `C:\dev\freerdp\install`、`C:\FreeRDP`、`C:\dev\FreeRDP\install`

推荐安装结构：

```text
C:\dev\freerdp\install\
  include\freerdp3\
  include\winpr3\
  lib\
  bin\
```

非默认路径：

```powershell
$env:FREERDP_ROOT = "D:\native\freerdp\install"
```

默认库名为 `freerdp-client3`、`freerdp3` 和 `winpr3`，可通过以下变量覆盖：

```powershell
$env:FREERDP_CLIENT_LIB_NAME = "freerdp-client3"
$env:FREERDP_LIB_NAME = "freerdp3"
$env:WINPR_LIB_NAME = "winpr3"
```

如果没有发现有效的 FreeRDP 安装，Rust 构建会禁用内嵌 FreeRDP 后端并输出 warning。Windows 仍可使用已正确构建的 MsTscAx 路径，但默认选择 FreeRDP 的会话会不可用。

## OpenSSL 与运行时 DLL

Windows 构建会检查 `OPENSSL_ROOT_DIR` / `OPENSSL_LIB_DIR`，并尝试常用安装目录。需要时可在当前 PowerShell 设置：

```powershell
$env:OPENSSL_ROOT_DIR = "C:\Program Files\OpenSSL-Win64"
```

`build.rs` 会把检测到的 FreeRDP、WinPR 和 OpenSSL DLL 复制到 Cargo profile 输出目录。仓库中的 `src-tauri\native\freerdp-runtime\win-x64` 是受控发布资源，不应由日常本地构建随意覆盖。

## MsTscAx sidecar

sidecar 源码位于：

```text
src-tauri\native\msrdpax-host
```

构建命令：

```powershell
npm run build:msrdpax-sidecar:debug
npm run build:msrdpax-sidecar:release
```

发布输出写入 `src-tauri\native\msrdpax-host\publish\win-x64`，Tauri 打包时会把该目录作为资源包含进去。

## 启动与检查

```powershell
npm run tauri:dev
& .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
cargo check --manifest-path .\src-tauri\Cargo.toml
```

如果 `cargo check` 提示找不到原生库，先检查当前 PowerShell 中的环境变量和安装目录，不要通过修改业务代码绕过探测逻辑。

## 常见问题

- `dotnet SDK was not found`：安装 .NET SDK 8+ 后重新打开 PowerShell。
- `libvncclient` / `vncclient.lib` 未找到：检查 `LIBVNCSERVER_ROOT` 及 MSVC 构建产物。
- FreeRDP backend disabled：检查 `FREERDP_ROOT` 下的 `include`、`lib`、`bin`。
- OpenSSL 符号或 DLL 错误：确认架构为 x64，且头文件、导入库和运行时 DLL 来自兼容版本。
- `node` 安装后仍不可用：关闭并重新打开终端，让 PATH 更新生效。
