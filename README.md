<p align="center">
  <img src="./src-tauri/icons/LazyTerm-128.png" width="96" height="96" alt="LazyTerm 图标">
</p>

<h1 align="center">LazyTerm</h1>

<p align="center">面向桌面多协议运维与 Android SSH 的现代终端工作区</p>

<p align="center">
  <strong>简体中文</strong> · <a href="./README_EN.md">English</a>
</p>

LazyTerm 使用 Tauri 2、React 19、TypeScript 和 Rust 构建。桌面版把本地 Shell、SSH、AI CLI、RDP、VNC、串口、Telnet 与 SFTP 文件传输整合到一个可分屏、可定制的工作区；Android 版面向随身 SSH 运维，提供适合触屏的精简界面。

它适合同时管理多台主机、混合使用字符终端与远程桌面，或为不同项目保存可重复打开的连接与布局模板。

## 核心能力

- **统一多协议工作区**：本地终端、SSH、AI CLI、Telnet、串口、RDP 和 VNC 使用相同的标签页与分屏模型。
- **Android SSH 真机版**：支持 ARM64 Android 设备，提供 SSH 配置、多终端标签、历史命令、快捷命令、主题、移动端按键栏、后台保活与应用内更新。
- **递归分屏与工作区模板**：支持任意层级的横向/纵向分屏，并可保存会话组合、比例、焦点和字体覆盖。
- **两条 RDP 路径**：FreeRDP 在 WebView 内通过 Canvas 渲染；Windows 可选 MsTscAx 原生宿主。
- **完整 VNC 交互**：支持区域帧、远端光标、剪贴板、文本输入、组合键和远端尺寸调整。
- **SFTP 文件传输**：支持远端目录浏览、批量上传/下载、进度展示和取消操作。
- **现代终端体验**：基于 xterm.js，提供搜索、自动补全、命令时间线、快捷命令、历史记录和字体缩放。
- **连接可靠性**：统一展示连接阶段和错误；SSH、Telnet、串口、RDP、VNC 对可重试故障执行退避重连。
- **自适应图形质量**：根据焦点、面板可见性和应用可见性调整 RDP/VNC 帧率与图像质量。
- **凭据保险库**：敏感字段使用 AES-GCM 加密，支持可选主密码；会话配置只保存凭据引用。
- **AI 助手与 AI CLI**：可配置 OpenAI 兼容接口进行流式对话，也可把常用 AI 命令行工具作为终端会话运行。
- **可定制应用布局**：会话树、历史、快捷命令和 AI 助手可放入可调整的侧边或底部插槽。
- **配置同步与更新**：主要配置可显式同步到 Git 仓库，并提供应用更新检查、下载与安装能力。

## 协议支持

| 能力 | 前端体验 | 后端实现 | 说明 |
| --- | --- | --- | --- |
| 本地 Shell | xterm.js 终端 | portable-pty | 支持工作目录、Shell、管理员模式和启动命令 |
| SSH | xterm.js 终端 | russh | 支持密码、私钥及交互式认证路径 |
| AI CLI | xterm.js 终端 | portable-pty | 启动用户配置的 CLI 命令 |
| Telnet | xterm.js 终端 | Tokio TCP | 适合兼容旧设备与服务 |
| 串口 | xterm.js 终端 | serialport | 支持常用波特率、数据位、校验位和流控 |
| RDP | Canvas / 原生子窗口 | FreeRDP / MsTscAx | MsTscAx 仅 Windows 可用 |
| VNC | Canvas | LibVNCClient FFI | 支持输入、光标、剪贴板和质量策略 |
| SFTP | 文件传输弹窗 | russh-sftp | 支持上传、下载、远端浏览、进度和取消 |

### Android 支持范围

Android 正式版支持 Android 7.0（API 24）及以上的 ARM64 真机，应用包名为 `com.lazyterm`。移动端当前专注于 SSH，支持：

- SSH 密码、私钥和交互式认证，以及保存和管理 SSH 配置。
- 多终端标签、命令历史、快捷命令、主题与终端字体设置。
- 可隐藏的历史/快捷命令入口，以及 `Esc`、`Tab`、方向键、`Ctrl` 等移动终端按键栏。
- SSH 后台保活、状态通知、自动重连，以及应用内检查、下载并调用系统安装器更新 APK。

Android 当前不提供本地 Shell、AI CLI、Telnet、串口、RDP、VNC、SFTP、桌面分屏/工作区模板、AI 助手和 Git 配置同步。x86_64 APK 仅用于开发阶段的模拟器调试，不作为正式发布产物。

## 当前构建平台

| 平台 | 当前构建路径 | 支持范围 |
| --- | --- | --- |
| Android ARM64 | GitHub Actions 生成签名 APK | SSH 移动端功能 |
| Windows x64 | GitHub Actions 生成 NSIS / MSI；也可本地构建 | 完整桌面功能；FreeRDP、MsTscAx |
| macOS Apple Silicon | GitHub Actions 生成 DMG；也可本地构建 | 完整桌面功能；FreeRDP |
| Linux | 安装 Tauri 与原生库依赖后从源码构建 | 完整桌面功能；FreeRDP |

预构建产物、SHA-256 校验文件和构建来源证明统一发布到 [GitHub Releases](https://github.com/LeoJhon8/LazyTerm/releases)，发布成功后单向同步到 Gitee。应用内更新会优先探测 GitHub Releases；GitHub 超时、不可访问或没有有效安装包时自动回退到 Gitee。维护者发布步骤见[发布流程](./docs/developer/release-process.md)。

## 快速开始

### 环境要求

- Node.js 20+
- npm
- Rust 1.85+ stable toolchain
- [Tauri 2 对应平台的系统依赖](https://v2.tauri.app/start/prerequisites/)

Android 开发还需要 JDK 17、Android SDK 36、Build Tools 36.1.0、NDK 25.1.8937393，以及对应的 Rust Android 目标。

Windows 开发建议额外准备：

- Microsoft Edge WebView2 Runtime
- Visual Studio 2022 C++ Build Tools 与 Windows 10/11 SDK
- .NET SDK 8+，用于构建 MsTscAx sidecar
- FreeRDP 与 LibVNCClient 开发文件

完整步骤见 [Windows 开发环境](./docs/developer/development-setup-windows.md)。

Linux（Debian / Ubuntu）可先安装基础依赖：

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

macOS 构建图形协议还需要：

```bash
brew install libvncserver freerdp
```

### 安装并启动

```powershell
npm ci
npm run tauri:dev
```

只启动前端开发服务器：

```powershell
npm run dev
```

### 构建安装包

Windows 原生 RDP sidecar：

```powershell
npm run build:msrdpax-sidecar:release
```

构建桌面应用：

```powershell
npm run tauri:build
```

`tauri:build` 会先执行 `scripts/update-version.js`，根据最近一次 Git 提交的 UTC 时间同步版本号。

Android x86_64 模拟器调试版：

```powershell
npm run tauri -- android build --target x86_64 --apk --debug
```

Android ARM64 正式版由发布工作流使用固定签名构建；签名材料不进入 Git 仓库。

### 编译与代码检查

```powershell
npm run lint
& .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
cargo check --manifest-path .\src-tauri\Cargo.toml
```

## 使用概览

1. 从欢迎页、快速连接或会话树新建连接。
2. 使用标签页和分屏同时放置终端、RDP 与 VNC 会话。
3. 将常用连接按文件夹组织；多面板布局可另存为工作区模板。
4. SSH 节点可打开 SFTP 上传或下载弹窗。
5. 在设置中配置外观、终端行为、布局插槽、凭据、AI 助手和 Git 同步。
6. 使用专注模式或沉浸模式减少界面干扰。

## 常用快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + T` | 新建标签页 |
| `Ctrl + W` | 关闭当前标签页 |
| `Ctrl + Tab` | 切换到下一个标签页 |
| `Ctrl + Shift + Tab` | 切换到上一个标签页 |
| `Ctrl + F` | 搜索当前终端缓冲区 |
| `Ctrl + 鼠标滚轮` | 调整当前终端字体大小 |
| `Ctrl + Shift + C` | 复制终端选中内容 |
| `Ctrl + Shift + V` | 粘贴到终端 |
| `Ctrl + Shift + F` | 切换专注模式 |
| `F11` | 切换沉浸模式 |

完整说明见 [快捷键文档](./docs/user/shortcuts.md)。

## 架构概览

```text
React UI
  -> Zustand 运行时与配置 Store
  -> Connection Supervisor / Readiness / Quality
  -> Protocol Connectors
  -> Tauri invoke / event / binary Channel
  -> Rust protocol backend
  -> PTY / SSH / FreeRDP / LibVNCClient / serialport / sidecar
```

- `tabs.ts` 是会话连接状态的应用级唯一数据源。
- Connector 隔离 UI 与协议后端，并负责监听器和连接资源的前端生命周期。
- `ConnectionSupervisor` 处理 generation、错误分类和自动重连。
- RDP/VNC 帧通过 Tauri 二进制 Channel 传输；文本终端主要使用会话级事件。
- Rust 后端持有实际会话句柄、异步任务、FFI 客户端和原生 sidecar。

完整说明见 [架构设计](./docs/developer/architecture.md)，RDP 双后端细节见 [RDP 架构](./docs/developer/rdp-architecture.md)。

## 数据与安全边界

- 标签页、活跃会话、Connector 和当前分屏树只存在于运行时内存，重启后不会自动恢复。
- 设置、会话树、工作区模板、快捷命令和其他用户配置保存在 WebView localStorage。
- Git 同步以 localStorage 为主数据源，仅在用户触发时读写仓库根目录的 `lazy-term-config.json`。
- 凭据保险库保存加密文档；启用主密码后使用 PBKDF2-SHA-256 派生密钥。
- 工作区模板和会话树使用 `credentialId` 引用凭据，不应包含明文密码、API Key、私钥正文或私钥口令。
- AI 助手的 API Key 由凭据保险库管理；AI 配置只保存服务地址、模型与凭据引用。

常见应用数据目录：

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%/LazyTerm/` |
| macOS | `~/Library/Application Support/LazyTerm/` |
| Linux | `~/.config/LazyTerm/` |

## 项目结构

```text
src/
  components/             # 布局、会话视图、弹窗、模块和基础 UI
  connectors/             # 本地、SSH、RDP、VNC、串口、Telnet、AI CLI 连接器
  services/connection/    # 重连、就绪屏障、质量策略和错误归类
  services/               # Tauri IPC 与应用服务
  store/                  # Zustand 运行时状态和持久化配置
  lib/                    # 工作区、凭据、布局和事件等领域逻辑
  hooks/                  # 终端、视图模式和弹窗 Hook
  types/                  # 会话、IPC 与工作区模板类型
  i18n/                   # 中英文界面文案

src-tauri/
  src/protocol/           # PTY、SSH、SFTP、RDP、VNC、串口、Telnet、Git、更新
  src/state.rs            # 后端活跃会话注册表
  src/lib.rs              # Tauri 插件、状态注入和 command 注册
  native/msrdpax-host/    # Windows 原生 RDP sidecar
  native/freerdp-runtime/ # Windows FreeRDP 运行时
  capabilities/           # Tauri 权限配置
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [文档索引](./docs/README.md) | 所有用户与开发者文档 |
| [快速开始](./docs/user/getting-started.md) | 环境、启动与首次使用 |
| [功能说明](./docs/user/features.md) | 各协议与工作区能力 |
| [故障排查](./docs/user/troubleshooting.md) | 连接、构建和原生依赖问题 |
| [架构设计](./docs/developer/architecture.md) | 状态归属、连接编排、IPC 和持久化边界 |
| [开发工作流](./docs/developer/development-workflow.md) | 日常开发与变更注意事项 |

## 常见问题

### 本地终端创建失败

确认配置的 Shell 存在。Windows 可检查 `powershell.exe`、`pwsh.exe` 或 Git Bash 路径，并尝试在设置中重新选择默认 Shell。

### SSH、Telnet 或远程桌面不断重连

检查主机、端口、网络、认证信息和远端服务状态。LazyTerm 只会自动重试被归类为可恢复的错误；认证失败、证书或主机密钥问题通常需要用户处理。

### Windows 下 RDP 或 VNC 无法构建

按 [Windows 开发环境](./docs/developer/development-setup-windows.md) 准备 FreeRDP、LibVNCClient、C++ 工具链和可选的 .NET sidecar 环境。

### SFTP 无法传输文件

确认 SSH 凭据有效、远端启用了 SFTP 子系统，并检查本地目录和远端目录的读写权限。

更多信息见 [故障排查](./docs/user/troubleshooting.md)。

## 贡献与支持

欢迎提交 Issue、Pull Request 和文档改进。参与前请阅读：

- [贡献指南](./CONTRIBUTING.md)
- [支持说明](./SUPPORT.md)
- [安全政策](./SECURITY.md)

报告问题时请提供 LazyTerm 版本、操作系统、连接类型、复现步骤和脱敏日志。不要上传密码、私钥、Token、真实服务器地址或包含个人信息的终端内容。

## 许可

LazyTerm 基于 [GNU General Public License v3.0 or later](./LICENSE) 开源。分发修改版或二进制版本时，需要遵守 GPL 并提供对应源代码。

默认 VNC 构建会链接 GPL-2.0-or-later 的 LibVNCClient；第三方组件、字体和随附二进制的许可说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

Copyright (c) 2025-present LazyTerm Contributors

## 致谢

LazyTerm 建立在许多优秀项目之上，特别感谢 [Tauri](https://tauri.app/)、[React](https://react.dev/)、[xterm.js](https://xtermjs.org/)、[Zustand](https://zustand.docs.pmnd.rs/)、[russh](https://github.com/warp-tech/russh)、[FreeRDP](https://www.freerdp.com/)、[LibVNCServer / LibVNCClient](https://github.com/LibVNC/libvncserver)、[Radix UI](https://www.radix-ui.com/) 和 [shadcn/ui](https://ui.shadcn.com/)。

项目开发过程中也使用了 Codex、Copilot、CodeBuddy、Lingma、Antigravity 等开发辅助工具，以及 ChatGPT、Gemini、GLM、Claude、Kimi、豆包和 Qwen 等模型或平台。
