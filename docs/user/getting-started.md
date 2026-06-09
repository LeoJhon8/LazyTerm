# 快速开始

这份文档面向想直接运行 LazyTerm 的用户。

## 环境要求

基础运行和开发建议准备：

- Node.js 20+
- npm
- Rust stable toolchain，Windows 推荐 `x86_64-pc-windows-msvc`
- Tauri 2 所需系统依赖

Windows 额外建议：

- Microsoft Edge WebView2 Runtime
- Visual Studio 2022 C++ Build Tools
- `.NET SDK 8+`，仅在需要构建 MsTscAx RDP sidecar 时使用
- LibVNCClient，仅在需要使用 Windows/MSVC 下的 VNC 功能时使用

更完整的 Windows 开发环境说明见 [Windows 开发环境](../developer/development-setup-windows.md)。

## 安装依赖

```powershell
npm ci
```

日常新增或升级依赖时再使用：

```powershell
npm install
```

## 启动应用

只启动前端开发服务：

```powershell
npm run dev
```

启动完整桌面应用：

```powershell
npm run tauri:dev
```

## 首次使用

1. 启动应用。
2. 在快速连接或会话树中新建连接。
3. 选择连接类型：本地终端、SSH、RDP、VNC、串口、Telnet 或 AI CLI。
4. 在工作区中使用标签页和树形多面板分屏管理多个会话。
5. 在设置中调整主题、字体、透明度、背景、布局插槽和配置同步。

## 数据位置

LazyTerm 的主要配置会保存在系统应用数据目录中：

| 系统 | 路径 |
| --- | --- |
| Windows | `%APPDATA%/LazyTerm/` |
| macOS | `~/Library/Application Support/LazyTerm/` |
| Linux | `~/.config/LazyTerm/` |
