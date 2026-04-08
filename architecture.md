# Lazy Term 架构设计文档

## 1. 系统概述

Lazy Term 是一款基于 Tauri 2 的跨平台桌面终端应用，支持多种远程连接协议。应用采用前后端分离架构，前端使用 React + TypeScript 构建用户界面，后端使用 Rust 实现核心协议逻辑。

### 1.1 核心特性

- **多协议支持**：本地 PTY、SSH、RDP（IronRDP/原生）、VNC
- **统一会话管理**：树形结构管理所有连接配置
- **可定制布局**：5 区域可配置布局系统 + 双面板分屏支持
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
│ 区域    │      中央区域           │  区域    │
│(Session)│   (PaneContainer)      │(History) │
│+Settings│   ┌────────┬────────┐  │         │
│         │   │ Pane 1 │ Pane 2 │  │         │
├────────┼───┴────────┴────────┴──┼─────────┤
│        │       底部区域          │         │
│        │    (QuickCmdBar)       │         │
└────────┴────────────────────────┴─────────┘
```

**布局状态管理**：
- 面板尺寸存储在 `useSettingsStore`（`--lw`, `--rw`, `--th`, `--bh` CSS 变量）
- 插槽模块配置存储在 `useSlotConfigStore`
- 支持拖拽调整尺寸与折叠展开

### 3.2 面板系统（Panes）

**核心设计**：
- 中央区域使用 `PaneContainer` 管理多个 `Pane`
- 支持最多 **2 个面板** 的分屏显示
- 面板方向支持水平或垂直拆分
- 面板状态**不持久化**（每次应用启动重置）

**Pane 数据结构**：
```typescript
interface Pane {
  id: string;           // 面板唯一标识
  sessionId: string | null; // 当前显示的会话 ID
  direction: "horizontal" | "vertical"; // 面板方向
  size: number;         // 大小比例（0-1）
}
```

**Pane 状态管理** (`panes.ts`)：
| 操作 | 说明 |
|------|------|
| `addPane` | 新增面板 |
| `removePane` | 移除面板 |
| `splitPane` | 拆分面板（水平/垂直） |
| `mergePane` | 合并两个面板 |
| `swapPanes` | 交换两个面板的会话 |
| `setPaneSession` | 设置面板关联的会话 |
| `focusPane` | 切换焦点面板 |
| `setPaneSize` | 调整面板大小比例 |

### 3.3 会话视图架构（模板方法模式）

采用**模板方法模式**统一所有会话视图的渲染逻辑：

```
┌─────────────────────────────────────────────────────────────────┐
│                    BaseSessionView (抽象基类)                     │
├─────────────────────────────────────────────────────────────────┤
│  # useBaseViewLogic(props): BaseSessionViewResult                │
│  # renderContent(result, props): ReactNode     [抽象方法]         │
│  # getViewType(): string                       [抽象方法]         │
└─────────────────────────────────────────────────────────────────┘
                              △
          ┌───────────────────┼───────────────────┐
          │                   │                   │
┌─────────┴────────┐ ┌────────┴───────────┐ ┌─────┴───────────┐
│ TerminalViewClass │ │BaseGraphicSessionView│ │                 │
│   (终端视图)       │ │  (图形化抽象类)      │ │                 │
├───────────────────┤ └─────────┬──────────┘ │                 │
│  xterm.js 渲染    │           │            │                 │
└───────────────────┘    ┌──────┴──────┐     │                 │
                    ┌────┴────┐   ┌────┴────┐ │                 │
                    │RemoteDesktop│ │ VncViewClass │                 │
                    │ViewClass  │   │          │                 │
                    │ (RDP)      │   │ (VNC)    │                 │
                    └───────────┘   └─────────┘                 │
```

**继承层次**：
1. **BaseSessionView** - 基础抽象类，提供通用状态管理和事件处理
2. **TerminalViewClass** - 终端视图（SSH/本地），使用 xterm.js
3. **BaseGraphicSessionView** - 图形化视图抽象类（RDP/VNC 共用）
   - **RemoteDesktopViewClass** - RDP 视图（IronRDP + Native）
   - **VncViewClass** - VNC 视图

**共享工具**：
| 类别 | 工具/常量 | 说明 |
|------|----------|------|
| 样式常量 | `VIEW_CONTAINER_CLASSNAME` | 视图主容器样式 |
| 基础工具 | `clamp(value, min, max)` | 数值范围限制 |
| 图形化 Hook | `useBaseGraphicSessionView` | Canvas、帧渲染、光标管理 |
| 键盘映射 | `RDP_SCANCODE_MAP` | RDP 扫描码映射 |
| | `VNC_KEYSYM_MAP` | VNC Keysym 映射 |
| 指针计算 | `getPointerPositionCentered` | 居中模式的指针位置计算 |
| | `getPointerPositionScaled` | 填充模式的指针位置计算 |

### 3.4 连接器模式

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

### 3.5 状态管理

使用 Zustand + persist 中间件实现持久化状态管理：

| Store | 功能 | 持久化 Key | 是否持久化 |
|-------|------|-----------|-----------|
| `tabs.ts` | 会话列表、活跃标签、连接错误 | `lazy-term-tabs` | ✅ |
| `settings.ts` | 终端外观、布局尺寸、背景图片 | `lazy-term-settings` | ✅ |
| `slot-config.ts` | 插槽模块分配与折叠状态 | `lazy-term-slot-config` | ✅ |
| `ssh-profiles.ts` | 会话树配置（文件夹/连接节点） | `terminal-sessions-v10` | ✅ |
| `history.ts` | 命令历史（最多 30 条） | `lazy-term-history` | ✅ |
| `quick-commands.ts` | 快捷命令列表 | `lazy-term-quick-commands` | ✅ |
| `panes.ts` | 面板列表、焦点面板、分屏状态 | - | ❌ |

**Pane 状态不持久化的设计决策**：
- 分屏是"本次会话"的布局选择，而非用户偏好设置
- 每次打开应用时 pane 列表为空，通过 `initializePanes()` 或 `addPane()` 创建
- 当 `MIN_PANES = 0` 时，无 pane 状态显示桌面首页

### 3.6 终端渲染

**TerminalViewClass** 组件负责终端渲染：

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
TerminalViewClass (xterm.js)
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
RemoteDesktopViewClass / VncViewClass
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

### 5.3 面板系统数据流

```
用户操作（点击分屏按钮）
    ↓
PaneContainer.handleSplit()
    ↓
usePanesStore.splitPane()
    ↓
pane-utils.splitPaneUtil()
    ↓
更新 pane 列表和大小
    ↓
触发 PaneContainer 重渲染
    ↓
新的 PaneView 实例
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
- **不可持久化**：连接器实例、活跃连接状态、面板布局

### 6.3 新增协议流程

1. 在 `types/terminal.ts` 定义接口
2. 在 `connectors/` 实现连接器
3. 在 `src-tauri/src/protocol/` 添加命令和协议实现
4. 在 `lib.rs` 注册命令
5. 更新 `capabilities` 权限配置

### 6.4 新增视图类型流程

1. 创建新文件，如 `SftpViewClass.tsx`
2. 调用 `useBaseSessionView(props)` 获取基础状态
3. 实现渲染逻辑
4. 返回带有 `data-view-type` 属性的 main 元素
5. 在 `PaneView.tsx` 中添加路由分支

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
2. 使用 `persist` 中间件启用持久化（如需要）
3. 在组件中使用 `create()` 导出

### 7.4 调整面板数量限制

1. 修改 `src/lib/pane-utils.ts` 中的 `MAX_PANES` 常量
2. 更新 `PaneContainer.tsx` 中的布局逻辑以支持更多面板

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

### 8.4 面板系统
- Pane 组件使用 `key={sessionId}` 确保会话组件复用
- 拖拽调整大小时使用 `userSelect: none` 避免文本选中

---

## 9. 安全考虑

- 私钥文件路径在前端存储，实际读取在 Rust 端
- SFTP 上传支持取消，防止资源滥用
- 所有系统调用通过 Tauri 权限系统控制
- 日志中不包含敏感信息（密码、密钥内容）

---

## 10. 文件结构总览

### 10.1 前端核心文件

```
src/
├── App.tsx                         # 应用根组件
├── components/
│   ├── layout/
│   │   ├── PaneContainer.tsx       # 面板容器（管理分屏布局）
│   │   ├── PaneView.tsx            # 单个面板视图
│   │   ├── SlotManager.tsx         # 插槽管理器
│   │   └── CustomTitleBar.tsx      # 自定义标题栏
│   ├── terminal/
│   │   ├── BaseSessionView.tsx     # 会话视图抽象基类
│   │   ├── BaseGraphicSessionView.tsx # 图形化视图抽象类
│   │   ├── TerminalViewClass.tsx   # 终端视图实现
│   │   ├── RemoteDesktopViewClass.tsx # RDP 视图实现
│   │   ├── VncViewClass.tsx        # VNC 视图实现
│   │   ├── NativeRdpHostView.tsx   # Native RDP 宿主视图
│   │   ├── index.ts                # 统一导出
│   │   └── README.md               # 架构文档
│   └── modules/                    # 侧边栏模块组件
├── store/
│   ├── tabs.ts                     # 会话状态管理
│   ├── panes.ts                    # 面板状态管理（不持久化）
│   ├── settings.ts                 # 设置状态管理
│   ├── slot-config.ts              # 插槽配置管理
│   ├── ssh-profiles.ts             # SSH 配置树
│   ├── history.ts                  # 命令历史
│   └── quick-commands.ts           # 快捷命令
├── lib/
│   ├── pane-utils.ts               # Pane 工具函数（纯函数）
│   └── utils.ts                    # 通用工具函数
├── connectors/                     # 协议连接器实现
├── types/                          # TypeScript 类型定义
└── services/                       # 服务层（Tauri IPC 封装）
```

### 10.2 后端核心文件

```
src-tauri/src/
├── main.rs           # 应用入口
├── lib.rs            # 库入口
├── state.rs          # 全局状态
├── types.rs          # 共享类型
├── error.rs          # 错误定义
├── logging.rs        # 日志
├── utils.rs          # 工具函数
└── protocol/         # 协议实现
    ├── mod.rs
    ├── ssh.rs
    ├── ssh_auth.rs
    ├── sftp.rs
    ├── rdp.rs
    ├── rdp_native.rs
    ├── vnc_core.rs
    └── local.rs
```
