# 快速开始

> **简体中文** | [English](../en/user/getting-started.md)

这份文档说明如何获取或从源码运行 LazyTerm，以及首次启动时需要了解的数据与凭据边界。

## 获取应用

预构建产物是否可用取决于当前发布版本，请先查看 [GitHub Releases](https://github.com/LeoJhon8/LazyTerm/releases)。当前仓库包含以下构建路径：

| 平台 | 构建目标 |
| --- | --- |
| Windows | x64，NSIS / MSI |
| macOS | Apple Silicon，DMG / App |
| Linux | 安装系统依赖后从源码构建 |

如果没有适合当前平台的产物，请按下面步骤从源码运行。

## 源码运行要求

- Node.js 20+
- npm
- Rust 1.85+ stable toolchain
- Tauri 2 对应平台的系统依赖

Windows 还需要或建议安装：

- Microsoft Edge WebView2 Runtime
- Visual Studio 2022 C++ Build Tools 与 Windows 10/11 SDK
- `.NET SDK 8+`，用于构建 MsTscAx RDP sidecar
- FreeRDP 与 LibVNCClient 开发文件，用于内嵌 RDP/VNC

完整 Windows 配置见 [Windows 开发环境](../developer/development-setup-windows.md)。

## 安装依赖

在仓库根目录执行：

```powershell
npm ci
```

只有在主动新增或升级依赖时才使用 `npm install`，因为它可能修改 `package-lock.json`。

## 启动应用

启动完整桌面应用：

```powershell
npm run tauri:dev
```

只启动前端开发服务器：

```powershell
npm run dev
```

仅启动前端时，依赖 Tauri IPC 的终端、协议和系统功能不可用。

## 首次使用

1. 从欢迎页打开“快速连接”或“新建连接”。
2. 选择本地终端、SSH、RDP、VNC、串口、Telnet 或 AI CLI。
3. 保存常用连接前，先在设置中创建凭据；远程配置会引用凭据 ID。
4. 使用标签页和分屏管理多个会话。
5. 如果要跨启动复用分屏组合，将当前多面板标签页保存为工作区模板。
6. 在设置中调整终端、外观、布局、AI 助手、凭据和数据同步。

## 配置 AI 助手

1. 在凭据设置中创建 `API Key` 类型的凭据。
2. 打开 AI 设置，填写 OpenAI 兼容服务地址和模型名。
3. 选择刚创建的凭据并保存。
4. 将 AI 模块放入可见插槽后开始对话。

服务地址应为 HTTP 或 HTTPS。LazyTerm 会请求兼容的 `/v1/chat/completions` 接口，并支持 SSE 流式响应。

## 数据与恢复

- 设置、会话树、工作区模板和快捷命令保存在 WebView localStorage。
- 标签页、活跃连接和当前分屏树只存在于内存，关闭应用后不会自动恢复。
- 凭据以加密保险库文档保存；启用主密码后，每次启动需要先解锁才能使用完整凭据。
- Git 配置同步需要用户显式触发，并以 localStorage 为主数据源。

常见应用数据目录：

| 系统 | 路径 |
| --- | --- |
| Windows | `%APPDATA%/LazyTerm/` |
| macOS | `~/Library/Application Support/LazyTerm/` |
| Linux | `~/.config/LazyTerm/` |

不同 WebView 或打包环境的实际存储文件位置可能有所差异。导出、同步或清理数据前，应先在应用的数据设置中确认范围。

## 下一步

- [功能说明](./features.md)
- [快捷键](./shortcuts.md)
- [常见问题](./troubleshooting.md)
