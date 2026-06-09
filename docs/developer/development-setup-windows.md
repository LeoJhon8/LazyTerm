# Windows 开发环境

这份文档说明一台新的 Windows 电脑如何准备 LazyTerm 开发环境。

## 必需组件

建议按顺序安装：

1. Git
2. Node.js 20+
3. Visual Studio 2022 Build Tools
4. Microsoft Edge WebView2 Runtime
5. Rustup + Rust stable MSVC toolchain
6. `.NET SDK 8+`，用于构建 MsTscAx sidecar

Visual Studio Build Tools 至少需要：

- `Desktop development with C++`
- MSVC v143 或更新版本
- Windows 10/11 SDK
- C++ CMake tools for Windows

## 验证工具链

重新打开 PowerShell 后执行：

```powershell
git --version
node -v
npm -v
rustc -V
cargo -V
rustup show
dotnet --version
where cl
```

`where cl` 找不到 `cl.exe` 时，通常是 C++ Build Tools 没装完整，或者当前终端没有加载到相关环境。

## 克隆和初始化

```powershell
git clone <你的仓库地址> lazy-terminal
cd .\lazy-terminal
npm ci
```

## 启动开发环境

只启动前端：

```powershell
npm run dev
```

启动完整 Tauri 应用：

```powershell
npm run tauri:dev
```

## LibVNCClient

Windows/MSVC 下 VNC 功能依赖 LibVNCClient。

推荐安装到默认目录：

```text
C:\dev\libvncserver\install
```

如果安装到其他目录，在当前 PowerShell 设置：

```powershell
$env:LIBVNCSERVER_ROOT = "C:\dev\libvncserver\install"
```

推荐构建命令：

```powershell
git clone https://github.com/LibVNC/libvncserver C:\dev\libvncserver
cmake -S C:\dev\libvncserver -B C:\dev\libvncserver\build-msvc -G "Visual Studio 17 2022" -A x64 -DWITH_OPENSSL=ON -DWITH_GNUTLS=OFF -DWITH_SDL=OFF -DWITH_GTK=OFF -DWITH_EXAMPLES=OFF -DWITH_TESTS=OFF -DCMAKE_INSTALL_PREFIX=C:\dev\libvncserver\install
cmake --build C:\dev\libvncserver\build-msvc --config Release
cmake --install C:\dev\libvncserver\build-msvc --config Release
```

注意不要使用 MSYS2 `mingw` 版本库给当前 Rust `x86_64-pc-windows-msvc` 目标链接。

## MsTscAx sidecar

MsTscAx sidecar 位于：

```text
src-tauri\native\msrdpax-host
```

构建命令：

```powershell
npm run build:msrdpax-sidecar:debug
npm run build:msrdpax-sidecar:release
```

如果提示 `dotnet SDK was not found`，安装 `.NET SDK 8+` 后重新打开 PowerShell。

