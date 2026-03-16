# Lazy Terminal

Lazy Terminal 是一个基于 Tauri 2、React 19、TypeScript 和 Rust 的桌面终端应用，提供本地终端、SSH 会话、RDP 会话、会话树管理、SFTP 上传、可定制多面板布局和终端外观系统。

## 功能概览

- 本地终端会话：支持自定义工作目录、Shell 选择，以及 Windows 管理员模式启动。
- SSH 会话：支持密码和私钥认证，连接失败会给出明确错误提示。
- RDP 会话：支持内嵌 IronRDP 远程桌面，以及通过 mstsc 启动 Windows 原生远程桌面客户端。
- 会话树管理：以文件夹/连接节点形式维护 SSH 配置，支持拖拽排序、导入导出和右键菜单操作。
- SFTP 上传：可在会话树中直接对 SSH 节点执行文件上传，并显示整体与单文件进度。
- 多区域布局：左侧、右侧、顶部、底部和中心终端区域均可配置，布局状态持久化到本地。
- 外观定制：支持终端主题、字体、透明度、背景图片、背景模糊、UI 透明度和自定义 CSS。
- 标签页工作流：支持多会话标签、重排、关闭左右侧/其他标签，以及异常断连后的恢复策略。

## 技术架构

核心数据流如下：

```text
React UI
  -> Zustand stores
  -> Connector (LocalConnector / SshConnector)
  -> Tauri invoke + event
  -> Rust backend (portable-pty / russh / russh-sftp)
```

主要分层：

- 前端：负责布局渲染、状态管理、xterm.js 终端显示、交互弹窗和模块化 UI。
- 连接器层：封装本地 PTY 与 SSH 会话的打开、写入、尺寸变化和事件监听。
- Tauri IPC：以 invoke 命令和事件总线连接前端与 Rust 后端。
- Rust 后端：负责本地终端进程、SSH 会话、SFTP 上传和系统 Shell 探测。

## 目录结构

```text
src/
  components/
    dialogs/       连接与布局相关弹窗
    layout/        左右顶部底部插槽与拖拽布局
    modules/       会话树、历史命令、快捷命令、标签栏等模块
    terminal/      xterm.js 终端视图
    ui/            Radix UI 封装组件
  config/          默认插槽配置、终端主题
  connectors/      本地终端与 SSH 连接器
  hooks/           终端初始化与绑定逻辑
  store/           Zustand 持久化状态
  types/           终端与连接配置类型

src-tauri/
  src/lib.rs       Tauri 命令、本地 PTY、SSH、SFTP 逻辑
  tauri.conf.json  桌面应用构建配置
```

## 开发环境

建议准备以下环境：

- Node.js 20+
- npm
- Rust stable toolchain
- Tauri 2 构建依赖
- Windows 下建议安装 WebView2 和 Visual Studio C++ Build Tools

如果是首次配置 Tauri，请先参考官方文档安装平台相关依赖。

## 启动与构建

安装依赖：

```bash
npm install
```

启动前端开发服务器：

```bash
npm run dev
```

以桌面模式启动 Tauri：

```bash
npm run tauri:dev
```

执行前端构建：

```bash
npm run build
```

执行桌面应用打包：

```bash
npm run tauri:build
```

执行 ESLint：

```bash
npm run lint
```

## 关键状态说明

- `lazy-terminal-settings`：终端和界面外观配置。
- `lazy-terminal-slot-config`：布局插槽配置。
- `lazy-terminal-quick-commands`：快捷命令列表。
- `terminal-sessions-v10`：SSH 会话树配置。
- 标签页元数据会持久化，但连接器实例只存在于内存中，不会直接序列化。

## 当前模块布局

- 左侧：会话管理、设置入口。
- 右侧：历史命令。
- 顶部：标签栏。
- 底部：快捷命令栏。
- 中央：终端视图。

其中设置模块本身是隐藏占位模块，实际设置面板由布局侧栏管理。

## 开发约定

- 前端状态统一放在 Zustand store 中，并使用 persist 中间件持久化。
- 终端连接统一走 `ITerminalConnector` 抽象，不要在 UI 层直接调用后端命令。
- 修改终端尺寸、焦点和容器布局时，优先检查 `TerminalView`、`useTerminal` 以及 App 中的 CSS 变量同步逻辑。
- 修改 SSH 会话树拖拽时，应在 DnD 上下文层统一计算放置位置，避免依赖行内鼠标事件。
- 增加新的 Tauri 命令后，别忘了同步检查权限配置与前端调用点。

## 常见问题

### 本地终端创建失败

优先检查默认 Shell 是否存在，特别是 Windows 下的 `powershell.exe`、`pwsh.exe` 或 Git Bash 路径。

### SSH 连接失败

检查主机、端口、用户名、认证方式和私钥格式。应用会在界面中弹出最近一次连接失败的详细信息。

### 背景图发糊

如果背景图模式希望保持清晰，请将 UI 模式切换为 clear，避免额外的面板毛玻璃模糊叠加。

### 打包失败

先确认 Rust/Tauri 依赖完整，再分别执行 `npm run build` 和 `npm run tauri:build` 缩小问题范围。

## 后续可扩展方向

- Telnet 连接器目前只保留了类型定义，尚未落地实现。
- 多套布局预设目前已预留接口，后续可扩展为完整的配置方案管理。
- 会话树和历史/快捷命令可以继续补充导入导出、同步和模板能力。
