# 架构概览

LazyTerm 是基于 Tauri 2、React 19、TypeScript 和 Rust 的桌面终端应用。整体架构遵循前后端分离：

```text
React UI -> Zustand store -> connector/service -> Tauri IPC -> Rust protocol backend
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面框架 | Tauri 2 |
| 前端 | React 19、TypeScript、Vite 7 |
| 状态管理 | Zustand 5 |
| UI | Tailwind CSS v4、shadcn/ui、Radix UI、lucide-react |
| 终端渲染 | xterm.js 6 |
| 后端 | Rust |
| 本地终端 | portable-pty |
| SSH / SFTP | russh、russh-sftp |
| RDP | FreeRDP、MsTscAx sidecar |
| VNC | LibVNCClient FFI |
| 串口 | serialport |

## 前端目录

```text
src/
  components/    # 布局、弹窗、模块、终端视图和基础 UI
  config/        # 主题、插槽、更新等配置
  connectors/    # 各协议前端连接器
  hooks/         # 视图模式、终端、弹窗等 Hook
  i18n/          # 中英文文案
  lib/           # 通用工具、日志、面板工具、事件工具
  services/      # Tauri IPC 服务封装
  store/         # Zustand stores
  types/         # TypeScript 类型定义
  workers/       # 前端 Worker
```

## 后端目录

```text
src-tauri/
  src/
    protocol/       # 协议实现和 Tauri 命令
    error.rs        # 错误类型
    lib.rs          # Tauri Builder 与命令注册
    logging.rs      # 日志
    state.rs        # 全局会话状态
    types.rs        # Rust 共享类型
    utils.rs        # 后端工具函数
  native/
    msrdpax-host/   # Windows 原生 RDP sidecar
  capabilities/     # Tauri 权限配置
```

## 状态管理

主要 Zustand store：

| Store | 职责 | 持久化 |
| --- | --- | --- |
| `tabs.ts` | 标签页、会话元数据、连接错误 | 是 |
| `settings.ts` | 终端外观、布局、视图设置 | 是 |
| `slot-config.ts` | 插槽模块配置 | 是 |
| `ssh-profiles.ts` | 会话树配置 | 是 |
| `history.ts` | 命令历史 | 是 |
| `quick-commands.ts` | 快捷命令 | 是 |
| `panes.ts` | 分屏面板、焦点面板、面板比例 | 否 |

连接器实例、活跃连接句柄、后端会话句柄都不持久化。

分屏布局使用递归树模型：叶子节点承载会话，分裂节点保存方向和比例。当前模型不是固定两分屏，面板数量由用户继续分裂叶子节点形成。

## 连接器层

`src/connectors/` 负责隔离 UI 与协议后端：

- `LocalConnector.ts`：本地 PTY。
- `SshConnector.ts`：SSH 终端。
- `AiCliConnector.ts`：AI CLI 会话。
- `RdpConnector.ts`：FreeRDP 内嵌 RDP。
- `NativeRdpConnector.ts`：MsTscAx sidecar。
- `VncConnector.ts`：VNC。
- `SerialConnector.ts`：串口。
- `TelnetConnector.ts`：Telnet。
- `ConnectorFactory.ts`：按会话类型创建连接器。

新增协议时优先扩展连接器层，不要让 UI 组件直接调用协议命令。

## 会话视图

核心视图在 `src/components/terminal/`：

- `BaseSessionView.tsx`：终端和图形视图共用基础逻辑。
- `TerminalViewClass.tsx`：xterm.js 终端视图。
- `BaseGraphicSessionView.tsx`：RDP/VNC 图形视图共用逻辑。
- `RemoteDesktopViewClass.tsx`：RDP 图形视图。
- `NativeRdpHostView.tsx`：Windows 原生 RDP 宿主占位视图。
- `VncViewClass.tsx`：VNC 图形视图。

图形会话通过 Canvas 或原生宿主窗口展示，输入事件由前端转换后转发给后端。

## 后端协议层

`src-tauri/src/protocol/` 按协议拆分：

- `terminal.rs`：本地终端。
- `ssh.rs`、`ssh_auth.rs`：SSH 和认证。
- `sftp.rs`、`sftp_utils.rs`：SFTP 上传。
- `rdp.rs`、`rdp_core.rs`、`freerdp_client.rs`：FreeRDP 路径。
- `native_rdp.rs`：Windows 原生 RDP sidecar。
- `vnc.rs`、`vnc_core.rs`：VNC。
- `serial.rs`：串口。
- `telnet.rs`：Telnet。
- `git_sync.rs`：配置同步。
- `updater.rs`：更新检查。

新增 Tauri 命令后，需要同步检查：

- `src-tauri/src/lib.rs`
- `src-tauri/capabilities/`
- 前端 `services/` 或 `connectors/`

## 数据流

终端类会话：

```text
用户输入 -> xterm.js -> connector.write -> Tauri invoke -> Rust protocol -> PTY/SSH/Telnet/Serial
远端输出 -> Rust event -> connector onData -> xterm.js -> 屏幕
```

图形类会话：

```text
鼠标/键盘输入 -> 图形视图 -> connector -> Tauri invoke/channel -> Rust protocol -> 远端桌面
帧数据 -> Rust protocol -> Tauri channel/event -> Canvas 或原生宿主 -> 屏幕
```

## 维护约定

- UI 层只负责交互和展示。
- Store 层保存可序列化状态。
- Connector 层管理连接生命周期。
- Service 层封装 Tauri IPC。
- Rust 协议层负责真实系统调用和网络协议。
- 新增协议或命令时，同时更新能力配置、类型定义和用户可见错误处理。
