# LazyTerm

LazyTerm 是一款基于 Tauri 2、React 19、TypeScript 和 Rust 构建的现代桌面终端工具。它把本地终端、SSH、AI CLI、RDP、VNC、串口、Telnet、SFTP 上传、会话树管理和可定制布局整合到同一个工作区里，适合日常开发、远程运维和多环境连接管理。

## 特性

- 多协议连接：支持本地 PTY、SSH、AI CLI、RDP、VNC、串口和 Telnet。
- 图形远程桌面：RDP 支持 IronRDP 内嵌渲染、Windows MsTscAx sidecar 和系统 mstsc 外部启动；VNC 支持画面渲染、输入转发和光标同步。
- 会话树管理：以文件夹和连接节点组织配置，支持新增、编辑、删除、排序、导入和导出。
- SFTP 上传：可对 SSH 会话执行文件上传，并显示整体和单文件进度。
- 多面板工作区：中心工作区支持标签页和分屏，周围插槽可放置会话、历史、快捷命令等模块。
- 终端体验：基于 xterm.js，支持主题、字体、透明度、背景图、历史命令和快捷命令。
- 配置同步：支持将主要配置同步到 Git 目录，并在设置中执行同步、提交和拉取。
- 自动更新：内置更新检查与下载配置。

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 前端 | React 19、TypeScript、Vite 7 |
| 状态管理 | Zustand 5 |
| UI | Tailwind CSS v4、shadcn/ui、Radix UI、lucide-react |
| 终端渲染 | xterm.js 6 |
| 后端 | Rust |
| 本地终端 | portable-pty |
| SSH / SFTP | russh、russh-sftp |
| RDP | IronRDP、MsTscAx sidecar、mstsc |
| VNC | LibVNCClient FFI |
| 串口 | serialport |

## 快速开始

### 环境要求

- Node.js 20+
- npm
- Rust stable toolchain，Windows 推荐 MSVC toolchain
- Tauri 2 构建依赖

Windows 额外建议安装：

- WebView2 Runtime
- Visual Studio 2022 C++ Build Tools
- .NET SDK 8+，用于构建 MsTscAx RDP sidecar
- LibVNCClient，用于 VNC 功能，可参考 `scripts/setup-libvncserver-msvc.ps1`

Linux 需要安装 Tauri 相关系统依赖，例如：

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

更多 Windows 新机器配置步骤见 [docs/windows-new-machine-setup.md](./docs/windows-new-machine-setup.md)。

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
# 仅启动前端开发服务
npm run dev

# 启动完整桌面应用
npm run tauri:dev
```

### 构建

```bash
# 前端构建
npm run build

# 桌面应用打包，会先更新版本号时间戳
npm run tauri:build
```

### 代码检查

```bash
npm run lint
```

### 可选：构建 MsTscAx RDP sidecar

```bash
npm run build:msrdpax-sidecar:debug
npm run build:msrdpax-sidecar:release
```

## 使用概览

1. 启动应用后，可从快速连接或会话树创建本地终端、SSH、RDP、VNC、串口、Telnet 或 AI CLI 会话。
2. 在会话树中维护常用连接配置，按文件夹组织不同环境。
3. 在工作区中使用标签页和分屏同时查看多个会话。
4. 在设置中调整终端主题、字体、透明度、背景图、布局插槽和数据同步。
5. 对 SSH 节点可使用 SFTP 上传文件；对 Git 同步目录可执行配置同步、提交和拉取。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl + T` | 新建标签页 |
| `Ctrl + W` | 关闭当前标签页 |
| `Ctrl + Tab` | 切换到下一个标签页 |
| `Ctrl + Shift + Tab` | 切换到上一个标签页 |
| `Ctrl + 鼠标滚轮` | 调整终端字体大小 |
| `Ctrl + Shift + C` | 复制终端选中内容 |
| `Ctrl + Shift + V` | 粘贴到终端 |

## 项目结构

```text
src/
  components/
    dialogs/       # 连接、新建会话、SFTP、设置等弹窗
    layout/        # 标题栏、插槽、工作区、分屏与通知中心
    modules/       # 会话树、标签栏、历史命令、快捷命令
    terminal/      # 终端视图、RDP/VNC 图形视图、Native RDP 宿主视图
    ui/            # 基础 UI 组件
  config/          # 主题、默认插槽、更新配置
  connectors/      # 各协议前端连接器
  hooks/           # 终端、视图模式、弹窗状态等 Hook
  i18n/            # 中英文文案
  lib/             # 通用工具、日志、面板工具、快速连接事件
  services/        # Tauri IPC 服务封装
  store/           # Zustand stores 与持久化逻辑
  types/           # TypeScript 类型定义

src-tauri/
  src/
    protocol/      # 本地终端、SSH、SFTP、RDP、VNC、串口、Telnet、更新等后端实现
    error.rs       # 错误类型
    lib.rs         # Tauri Builder 与命令注册
    logging.rs     # 日志
    state.rs       # 全局会话状态
    types.rs       # Rust 共享类型
    utils.rs       # 后端工具函数
  native/
    msrdpax-host/  # Windows 原生 RDP sidecar
  capabilities/    # Tauri 权限配置
```

## 架构说明

LazyTerm 采用前后端分离架构：

```text
React UI -> Zustand stores -> Connector -> Tauri IPC -> Rust backend
```

- UI 层只负责交互和展示。
- Store 层保存标签页、会话树、设置、快捷命令、历史记录和 Git 同步配置。
- Connector 层封装不同协议的连接生命周期，避免 UI 直接调用后端命令。
- Rust 后端负责 PTY、SSH、SFTP、RDP、VNC、串口、Telnet、更新和 Git 操作。
- 图形协议通过 Tauri Channel 或事件把帧数据传回前端，由 Canvas/宿主视图渲染。

更完整的设计说明见：

- [docs/architecture.md](./docs/architecture.md)
- [docs/rdp-pipeline-comparison.md](./docs/rdp-pipeline-comparison.md)
- [docs/msrdpax-native-host-design.md](./docs/msrdpax-native-host-design.md)
- [docs/immersive-mode.md](./docs/immersive-mode.md)

## 数据与配置

主要本地持久化 key：

| Key | 说明 |
| --- | --- |
| `lazy-term-settings` | 终端、外观和布局设置 |
| `lazy-term-slot-config` | 插槽模块配置 |
| `lazy-term-quick-commands` | 快捷命令 |
| `lazy-term-tabs` | 标签页与会话状态 |
| `lazy-term-history` | 命令历史 |
| `terminal-sessions-v10` | 会话树配置 |
| `lazy-term-git-sync` | Git 同步目录配置 |

应用数据目录：

- Windows：`%APPDATA%/LazyTerm/`
- macOS：`~/Library/Application Support/LazyTerm/`
- Linux：`~/.config/LazyTerm/`

## 开发约定

- 前端状态统一放在 `src/store/`，需要持久化的数据使用 Zustand persist。
- 新协议优先沿用 `src/connectors/` 的连接器抽象，再通过 Tauri IPC 接入 Rust 后端。
- UI 组件不要直接调用协议后端命令，协议调用应集中在 connector 或 service 中。
- 新增 Tauri 命令后，同步检查 `src-tauri/src/lib.rs` 和 `src-tauri/capabilities/`。
- 修改终端尺寸、焦点、背景或透明度相关逻辑时，重点检查 `src/components/terminal/`、`src/hooks/useTerminal.ts` 和全局 CSS 变量。

## 常见问题

### 本地终端创建失败

检查默认 Shell 是否存在，尤其是 Windows 下的 `powershell.exe`、`pwsh.exe` 或 Git Bash 路径。也可以在设置中手动指定 Shell。

### SSH 连接失败

检查主机、端口、用户名、认证方式和私钥格式。LazyTerm 会在界面中展示最近一次连接失败的错误信息。

### RDP 连接异常

- IronRDP 适合内嵌渲染标准 RDP 服务。
- MsTscAx sidecar 需要 Windows 和 .NET 运行环境。
- mstsc 模式会启动系统自带远程桌面客户端。

### VNC 构建或连接失败

Windows 下需要先准备 LibVNCClient，可使用 `scripts/setup-libvncserver-msvc.ps1`。默认安装路径 `C:\dev\libvncserver\install` 会被构建脚本自动检测。

### 串口连接失败

确认设备已连接并被系统识别，同时检查波特率、数据位、校验位、停止位和流控配置是否与设备一致。

## 贡献

欢迎提交 Issue 和 Pull Request。建议在提交前执行：

```bash
npm run lint
npm run build
```

## 许可

本项目基于 [Apache License 2.0](./LICENSE) 开源。

第三方字体与依赖的许可说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

Copyright (c) 2025-present LazyTerm Contributors

## 致谢

感谢这些项目和生态提供的基础能力：
排名不区分先后，感觉以下开源项目对当前项目的贡献
- [Tauri](https://tauri.app/)
- [React](https://react.dev/)
- [xterm.js](https://xtermjs.org/)
- [shadcn/ui](https://ui.shadcn.com/)
- [russh](https://github.com/warp-tech/russh)
- [IronRDP](https://github.com/Devolutions/IronRDP)
- [LibVNCClient](https://github.com/LibVNC/libvncserver)

排名区分先后，感谢以下AI工具对当前项目的贡献
- [Antigravity]
- [Codex]
- [CodeBuddy]
- [Copilot]
- [Lingma]

排名区分先后，感谢以下LLM对当前项目的贡献
- [ChatGPT]
- [Gemini]
- [GLM]
- [Claude Code]
- [Kimi]
- [doubao]
- [QWen]
