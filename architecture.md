# Lazy Terminal 架构设计文档

## 1. 系统概述

Lazy Terminal 是一款基于 Tauri 2 的跨平台桌面终端应用，支持多种远程连接协议。应用采用前后端分离架构，前端使用 React + TypeScript 构建用户界面，后端使用 Rust 实现核心协议逻辑。

### 1.1 核心特性

- **多协议支持**：本地 PTY、SSH、RDP（IronRDP/原生）、VNC
- **统一会话管理**：树形结构管理所有连接配置
- **可定制布局**：5 区域可配置布局系统
- **现代化 UI**：基于 shadcn/ui + Tailwind CSS

### 1.2 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 19 + TypeScript | UI 渲染与状态管理 |
| 构建工具 | Vite 6 | 开发与生产构建 |
| 桌面框架 | Tauri 2 | Rust 绑定与原生窗口 |
| 后端语言 | Rust | 协议实现与系统调用 |
| 状态管理 | Zustand | 持久化状态存储 |
| 终端渲染 | xterm.js | 本地/SSH 终端显示 |
| UI 组件 | shadcn/ui | 基础组件库 |
| 样式方案 | Tailwind CSS v4 | 原子化 CSS |

---

## 2. 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端层 (React)                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   UI 组件    │  │  Store 状态  │  │      连接器层           │  │
│  │  components/│  │   store/    │  │    connectors/          │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
│         │                │                     │                │
│         └────────────────┼─────────────────────┘                │
│                          │                                      │
│              ┌───────────┴───────────┐                          │
│              │    Tauri IPC 层       │                          │
│              │   (invoke/event)      │                          │
│              └───────────┬───────────┘                          │
└──────────────────────────┼──────────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────┐
│                     Rust 后端层                                  │
├──────────────────────────┼──────────────────────────────────────┤
│                          ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                     Tauri Runtime                        │   │
│  └────────────────────┬────────────────────────────────────┘   │
│                       │                                         │
│  ┌────────────────────┴────────────────────────────────────┐   │
│  │                     命令分发层 (Commands)                 │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │   │
│  │  │   SSH    │ │   RDP    │ │   VNC    │ │  Local PTY │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │   │
│  └────────────────────┬────────────────────────────────────┘   │
│                       │                                         │
│  ┌────────────────────┴────────────────────────────────────┐   │
│  │                     协议实现层                            │   │
│  │  ┌──────────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │  russh       │  │ ironrdp  │  │     vnc-rs       │   │   │
│  │  │  russh-sftp  │  │  sspi    │  │                  │   │   │
│  │  └──────────────┘  └──────────┘  └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 前端架构

### 3.1 布局系统

应用采用 **3x3 CSS Grid** 布局，包含 5 个可配置区域：

```
┌────────┬────────────────────────┬─────────┐
│        │        顶部区域         │         │
│        │      (TabBar)          │         │
├────────┼────────────────────────┼─────────┤
│ 左侧    │                        │  右侧    │
│ 区域    │       中央区域          │  区域    │
│(Session)│    (TerminalView/      │(History) │
│+Settings│    RemoteDesktopView/  │         │
│         │    VncView)            │         │
├────────┼────────────────────────┼─────────┤
│        │       底部区域          │         │
│        │    (QuickCmdBar)       │         │
└────────┴────────────────────────┴─────────┘
```

**布局状态管理**：
- 面板尺寸存储在 `useSettingsStore`（`--lw`, `--rw`, `--th`, `--bh` CSS 变量）
- 插槽模块配置存储在 `useSlotConfigStore`
- 支持拖拽调整尺寸与折叠展开

### 3.2 连接器模式

所有连接协议通过连接器抽象封装，实现统一的接口契约：

| 连接器类型 | 接口 | 适用协议 | 数据传输方式 |
|-----------|------|---------|-------------|
| `ITerminalConnector` | 终端连接 | 本地 PTY、SSH | Tauri Event |
| `IRdpConnector` | RDP 连接 | IronRDP | Tauri Channel |
| `INativeRdpConnector` | 原生 RDP | MsTscAx Sidecar | Tauri Event + Invoke |
| `IVncConnector` | VNC 连接 | VNC | Tauri Channel + Event |

**连接器生命周期**：
1. 在 `useTabsStore.addSession()` 中通过 `createConnector()` 创建
2. 连接器实例仅存于内存，不持久化
3. 断线行为：本地终端自动重建，SSH 降级为本地终端

### 3.3 状态管理

使用 Zustand + persist 中间件实现持久化状态管理：

| Store | 功能 | 持久化 Key |
|-------|------|-----------|
| `tabs.ts` | 会话列表、活跃标签、连接错误 | `lazy-terminal-tabs` |
| `settings.ts` | 终端外观、布局尺寸、背景图片 | `lazy-terminal-settings` |
| `slot-config.ts` | 插槽模块分配与折叠状态 | `lazy-terminal-slot-config` |
| `ssh-profiles.ts` | 会话树配置（文件夹/连接节点） | `terminal-sessions-v10` |
| `history.ts` | 命令历史（最多 30 条） | `lazy-terminal-history` |
| `quick-commands.ts` | 快捷命令列表 | `lazy-terminal-quick-commands` |

### 3.4 终端渲染

**TerminalView** 组件负责终端渲染：

- 维护 `terminalMap` 存储每个会话的 xterm.js 实例
- 早期缓冲区捕获连接器建立前到达的数据
- 拦截远端 OSC 颜色序列，保持本地主题权威
- 背景图片/透明度激活时禁用 WebGL 渲染器
- 支持 Ctrl+滚轮调整字体、选中自动复制、右键粘贴

---

## 4. 后端架构

### 4.1 文件组织

```
src-tauri/src/
├── main.rs           # 应用入口
├── lib.rs            # 库入口、Tauri Builder
├── state.rs          # 全局状态 AppState
├── types.rs          # 共享数据结构
├── error.rs          # 错误定义
├── logging.rs        # 轻量日志器
├── utils.rs          # 工具函数
└── protocol/         # 协议核心实现（含 Tauri 命令）
    ├── mod.rs
    ├── ssh.rs        # SSH 客户端
    ├── ssh_auth.rs   # SSH 认证
    ├── rdp.rs        # IronRDP 实现
    ├── vnc_core.rs   # VNC 客户端
    └── ...
```

### 4.2 全局状态

`AppState` 管理所有活跃会话：

```rust
pub struct AppState {
    pub local_sessions: StdMutex<HashMap<String, LocalSession>>,
    pub ssh_sessions: TokioMutex<HashMap<String, SshSession>>,
    pub rdp_sessions: StdMutex<HashMap<String, RdpSession>>,
    pub vnc_sessions: StdMutex<HashMap<String, VncSession>>,
}
```

- **本地/RDP/VNC**：使用 `StdMutex`（同步上下文）
- **SSH**：使用 `TokioMutex`（异步上下文）

### 4.3 协议实现

#### 本地 PTY
- **库**：`portable-pty`
- **实现**：线程池 + std mpsc 通道
- **特性**：Shell 发现、工作目录自定义、管理员模式

#### SSH
- **库**：`russh` + `russh-sftp`
- **实现**：异步客户端
- **认证策略**：私钥 → keyboard-interactive → 密码（自动降级）
- **SFTP**：支持单文件/总进度事件、取消功能

#### RDP (IronRDP)
- **库**：`ironrdp` + `sspi`
- **实现**：阻塞线程
- **特性**：自适应帧率、动态 JPEG 质量、剪贴板重定向

#### RDP (原生)
- **实现**：C# sidecar 进程（`msrdpax-host.exe`）
- **通信**：JSON stdin/stdout 管道
- **特性**：托管 MsTscAx ActiveX、窗口定位同步

#### VNC
- **库**：`vnc-rs`
- **实现**：异步客户端
- **特性**：快照批处理（60ms 提交延迟）、PNG 输出、光标同步

### 4.4 Tauri 命令

共 **29 个命令**，按协议分组：

```
create_*    - 创建会话
write_*     - 写入数据
send_*      - 发送输入/按键
resize_*    - 调整尺寸
close_*     - 关闭会话
```

**特殊命令**：
- RDP/VNC 帧数据使用 `tauri::ipc::Channel<Response>` 流式传输
- SFTP 上传使用前端传入的自定义进度事件名

---

## 5. 数据流

### 5.1 终端会话数据流

```
用户输入
    ↓
TerminalView (xterm.js)
    ↓
ITerminalConnector.write()
    ↓
tauri.invoke('write_ssh' / 'write_local')
    ↓
Rust Command Handler
    ↓
SSH Channel / PTY Master
    ↓
远程服务器 / 本地 Shell

远程输出（反向）：
远程服务器 / 本地 Shell
    ↓
SSH Channel / PTY Master
    ↓
Rust Event Emitter
    ↓
tauri.emit('terminal-data-{id}')
    ↓
ITerminalConnector (onData 回调)
    ↓
xterm.js write()
    ↓
屏幕渲染
```

### 5.2 图形会话数据流 (RDP/VNC)

```
用户输入/鼠标
    ↓
RemoteDesktopView / VncView
    ↓
IRdpConnector.sendInput() / IVncConnector.sendPointer()
    ↓
tauri.invoke() / Channel
    ↓
Rust Protocol Handler
    ↓
远程桌面服务器

帧数据（反向）：
远程桌面服务器
    ↓
Rust Protocol Handler
    ↓
tauri::ipc::Channel<Response>
    ↓
前端 Canvas 渲染
    ↓
屏幕显示
```

---

## 6. 关键约定

### 6.1 事件命名规范

```
{protocol}-data-{session_id}    # 数据事件
{protocol}-close-{session_id}   # 关闭事件
{protocol}-error-{session_id}   # 错误事件
```

### 6.2 状态持久化规则

- **可持久化**：会话元数据、配置、历史记录
- **不可持久化**：连接器实例、活跃连接状态

### 6.3 新增协议流程

1. 在 `types/terminal.ts` 定义接口
2. 在 `connectors/` 实现连接器
3. 在 `src-tauri/src/protocol/` 添加命令和协议实现
4. 在 `lib.rs` 注册命令
5. 更新 `capabilities` 权限配置

---

## 7. 扩展点

### 7.1 新增连接器类型

1. 在 `src/types/terminal.ts` 定义新接口
2. 在 `src/connectors/` 实现连接器类
3. 在 `src/store/tabs.ts` 的 `createConnector()` 中添加分支
4. 在 Rust 端实现对应协议命令

### 7.2 新增布局模块

1. 在 `src/components/modules/` 创建模块组件
2. 在 `src/config/slot-modules.ts` 注册模块
3. 模块将自动出现在插槽配置中

### 7.3 新增 Store

1. 在 `src/store/` 创建 store 文件
2. 使用 `persist` 中间件启用持久化
3. 在组件中使用 `create()` 导出

---

## 8. 性能优化

### 8.1 终端渲染
- 背景图片/透明度激活时禁用 WebGL
- 使用早期缓冲区避免数据丢失
- 批量处理远端输出

### 8.2 图形会话
- RDP：自适应帧率、动态 JPEG 质量
- VNC：60ms 快照批处理、PNG 压缩

### 8.3 状态管理
- Store 方法保持确定性
- 副作用边界明确
- 避免不必要的重渲染（React Compiler）

---

## 9. 安全考虑

- 私钥文件路径在前端存储，实际读取在 Rust 端
- SFTP 上传支持取消，防止资源滥用
- 所有系统调用通过 Tauri 权限系统控制
- 日志中不包含敏感信息（密码、密钥内容）
