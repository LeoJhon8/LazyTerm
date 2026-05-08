# LazyTerm 项目指南

## 项目概述
LazyTerm 是一个基于 Tauri 2、React 19、TypeScript 和 Rust 的现代化桌面终端应用。它提供本地终端、SSH 会话、RDP/VNC 远程桌面、串口连接、Telnet 连接、会话树管理、SFTP 文件传输、可定制多面板布局和丰富的终端外观系统。

**主要技术栈：**
*   **前端**：React 19, TypeScript, Vite 7, Zustand 5, Tailwind CSS v4, shadcn/ui, xterm.js 6
*   **后端**：Rust, Tauri 2, portable-pty (本地 PTY), russh (SSH), ironrdp (RDP), LibVNCClient (VNC FFI)
*   **架构**：前后端分离，通过 Tauri IPC 进行通信 (React UI → Zustand stores → Connector → Tauri IPC → Rust backend)。

## 构建与运行

确保系统已安装 Node.js 20+, npm, Rust toolchain (MSVC), 以及 Tauri 2 的相关构建依赖（Windows 环境还需要配置 WebView2, Visual Studio 2022 C++ Build Tools 以及 VNC 支持所需的 LibVNCClient）。

*   **安装依赖**：
    ```bash
    npm install
    ```
*   **启动开发环境**：
    ```bash
    npm run tauri:dev  # 完整桌面应用开发（推荐）
    npm run dev        # 仅前端开发（无后端功能）
    ```
*   **代码构建与打包**：
    ```bash
    npm run tauri:build # 桌面应用打包（自动更新版本号）
    npm run build       # 仅前端构建
    ```
*   **代码检查**：
    ```bash
    npm run lint
    ```
*   **构建 msrdpax sidecar (可选，仅限 Windows 环境的 RDP 功能)**：
    ```bash
    npm run build:msrdpax-sidecar:debug
    npm run build:msrdpax-sidecar:release
    ```

## 开发约定

*   **状态管理**：前端状态统一存放在 Zustand store (`src/store/`) 中，并使用 persist 中间件进行本地持久化（数据存储在 `%APPDATA%/LazyTerm/` 等用户目录）。
*   **连接器抽象**：终端及远程桌面连接必须通过 `src/connectors/` 目录下的连接器（如 `ITerminalConnector`, `IRdpConnector`）进行交互，**不要在 UI 组件层直接调用 Tauri 的后端 invoke 命令**。
*   **界面与布局**：修改终端尺寸、焦点和容器布局时，优先检查 `TerminalView`、`useTerminal` 以及 App 中的 CSS 变量同步逻辑。
*   **后端开发流程**：
    1. 在 `types/terminal.ts` 定义所需接口。
    2. 在 `src/connectors/` 目录实现对应的连接器。
    3. 在 Rust 端的 `src-tauri/src/protocol/` 目录下添加核心实现和 Tauri 命令。
    4. 在 `src-tauri/src/lib.rs` 中注册新增的 Tauri 命令。
    5. 确保同步检查并更新相关的系统及应用权限配置。