# CODEBUDDY.md 本文件为 CodeBuddy 在此仓库中工作时提供指导。

## 构建与开发命令

- `npm install` — 安装前端依赖。需要 Node.js 20+。
- `npm run dev` — 启动 Vite 开发服务器（仅前端，无 Tauri 后端）。
- `npm run tauri:dev` — 以开发模式启动完整 Tauri 桌面应用。这是测试终端/SSH/RDP/VNC 功能的主要方式，因为这些功能依赖 Rust 后端。
- `npm run build` — 类型检查 (`tsc -b`) 后通过 Vite 构建前端。输出到 `dist/`。
- `npm run tauri:build` — 构建生产级桌面安装包。内部会先执行 `npm run build`。
- `npm run lint` — 对所有 `*.ts`/`*.tsx` 文件运行 ESLint。忽略 `dist/`、`src-tauri/gen/`、`src-tauri/target/`。
- `npm run build:msrdpax-sidecar:debug` / `npm run build:msrdpax-sidecar:release` — 构建 C# MsTscAx sidecar 进程（仅 Windows）。使用 `scripts/build-msrdpax-sidecar.ps1` 脚本。

当前项目未配置测试框架。

## 架构总览

Lazy Terminal 是一个基于 Tauri 2 的桌面终端应用，支持五种协议：本地 PTY、SSH、RDP（ironrdp / msrdpax sidecar / mstsc）和 VNC。代码库分为 React 前端 (`src/`) 和 Rust 后端 (`src-tauri/`)。

### 数据流

```
React UI (components/) → Zustand 状态 (store/) → 连接器 (connectors/) → Tauri IPC (services/tauri.ts) → Rust 命令 (src-tauri/src/)
```

所有后端通信都通过连接器抽象进行 — UI 组件不应直接调用 `invoke()` 处理会话操作。

### 前端结构

**布局系统**：`App.tsx` 使用 CSS Grid 3x3 布局，包含四个可配置插槽（左/右/上/下）和一个中央终端区域。布局面板尺寸和折叠状态存储在 `useSettingsStore` 中，并同步为 CSS 变量（`--lw`、`--rw`、`--th`、`--bh`）。插槽系统 (`useSlotConfigStore`) 决定每个插槽中显示的模块。默认布局：左侧=SessionModule+Settings、右侧=HistoryModule、顶部=TabBar、底部=QuickCmdBar、中央=TerminalView。

**中央区域路由**：根据当前活跃会话的协议，中央区域渲染 `TerminalView`（本地/SSH）、`RemoteDesktopView`（RDP）或 `VncView`（VNC）。当图形会话（RDP/VNC）激活时，底部快捷命令栏自动隐藏。

**连接器模式**：所有连接器实现 `src/types/terminal.ts` 中定义的协议专用接口：
- `ITerminalConnector` — 本地/SSH 终端（数据通过 Tauri 事件：`terminal-data-{id}`）
- `IRdpConnector` — ironrdp RDP（帧通过 Tauri Channel，输入通过 invoke）
- `INativeRdpConnector` — MsTscAx sidecar RDP（状态通过 Tauri 事件，窗口定位通过 invoke）
- `IVncConnector` — VNC（帧通过 Tauri Channel，光标通过 Tauri 事件）

连接器实例在 `useTabsStore.addSession()` 中通过 `createConnector()` 创建，仅存在于内存中（不持久化）。断线行为：本地终端自动重建，SSH 降级为本地终端。

**Zustand 状态管理**（均使用 `persist` 中间件持久化到 localStorage）：
- `tabs.ts` — 会话列表、活跃标签、连接错误、连接器生命周期
- `settings.ts` — 终端字体/主题、面板尺寸、背景图片、透明度、自定义 CSS
- `slot-config.ts` — 插槽模块分配和折叠状态
- `ssh-profiles.ts` — 文件夹/连接配置树（folder/ssh/rdp/vnc 节点类型）
- `history.ts` — 命令历史（最多 30 条，自动去重）
- `quick-commands.ts` — 用户自定义快捷命令列表

**终端渲染** (`TerminalView.tsx`)：在 `terminalMap` 中维护每个会话的 xterm.js 实例池。使用早期缓冲区捕获连接器建立前到达的数据。拦截远端 OSC 颜色序列以保持本地主题权威。背景图片或透明度激活时禁用 WebGL 渲染器。支持 Ctrl+滚轮调整字体、选中自动复制到剪贴板、右键粘贴。

**关键组件**：
- `SessionModule.tsx` — SSH 配置树（拖拽排序）、SFTP 上传对话框、本地 Shell 发现
- `RemoteDesktopView.tsx` — IronRDP Canvas 渲染器和原生 RDP 宿主视图分发器
- `NativeRdpHostView.tsx` — 将 Win32 sidecar 窗口定位到 Web 容器上方，跟踪布局变化
- `VncView.tsx` — Canvas 渲染器，含 X11 keysym 映射、Pointer Capture、远端光标同步
- `CustomTitleBar.tsx` — 无边框窗口标题栏，含拖拽区域和窗口控制按钮

### Rust 后端

**文件组织**：`lib.rs`（数据结构、RDP/VNC 会话运行器、Tauri 构建器）、`commands.rs`（全部 29 个 Tauri 命令实现）、`mstsc.rs`（系统 mstsc 启动器）、`native_rdp.rs`（C# sidecar 通信）、`logging.rs`（轻量日志器）。

**全局状态** (`AppState`)：每种协议类型的会话对象 Map，通过 `StdMutex`（本地/RDP/VNC）或 `TokioMutex`（SSH）保护。通过 `tauri::manage()` 注入。

**协议实现**：
- 本地 PTY：`portable-pty`，线程池 + std mpsc 通道
- SSH：`russh` 异步客户端，多策略认证（私钥 → keyboard-interactive → 密码）
- RDP ironrdp：`ironrdp` + `sspi` 阻塞线程，自适应帧率和动态 JPEG 质量
- RDP 原生：JSON stdin/stdout 管道与 C# sidecar 通信（`msrdpax-host.exe` 托管 MsTscAx ActiveX）
- VNC：`vnc-rs` 异步客户端，快照批处理（60ms 提交延迟，PNG 输出）
- SFTP：`russh-sftp`，支持单文件/总进度事件和取消功能

**Tauri 命令**（共 29 个）：按协议分组为 `create_*` / `write_*` / `send_*` / `resize_*` / `close_*`。RDP 帧和 VNC 帧数据使用 `tauri::ipc::Channel<Response>` 流式传输。SFTP 上传使用前端传入的自定义进度事件名。

### 路径别名

`@/` 映射到 `src/`（在 `vite.config.ts` 和 `tsconfig.app.json` 中配置）。

### UI 框架

- **组件库**：shadcn/ui（new-york 风格）— 基础组件在 `src/components/ui/`
- **样式**：Tailwind CSS v4，使用 CSS 变量控制主题（定义在 `tailwind.config.js`）
- **图标**：lucide-react
- **动画**：framer-motion
- **拖拽**：@dnd-kit

### 关键约定

- 通过 `babel-plugin-react-compiler` 启用了 React Compiler
- Store 方法应保持确定性，副作用边界要明确
- 连接器实例绝不能被序列化 — 仅持久化会话元数据
- 事件命名：`{protocol}-data-{session_id}`、`{protocol}-close-{session_id}`
- 新增 Tauri 命令时：在 `commands.rs` 中实现，在 `lib.rs` 的 `generate_handler!` 中注册，更新前端连接器，检查 capabilities 权限
- RDP/VNC 会话使用图形渲染（Canvas），非 xterm.js — 终端主题等外观设置不适用
- Vite 配置中使用了 `nodePolyfills()` 以在浏览器上下文中兼容 Node.js API
