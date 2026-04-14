# Lazy Term

Lazy Term 是一个基于 Tauri 2、React 19、TypeScript 和 Rust 的现代化桌面终端应用，提供本地终端、SSH 会话、RDP/VNC 远程桌面、会话树管理、SFTP 文件传输、可定制多面板布局和丰富的终端外观系统。

## 功能概览

### 终端功能
- **本地终端会话**：支持自定义工作目录、Shell 选择，以及 Windows 管理员模式启动
- **SSH 会话**：支持密码和私钥认证，连接失败会给出明确错误提示，支持 SFTP 文件上传
- **多标签页**：支持多会话标签、标签重排、批量关闭、异常断连后的恢复策略

### 远程桌面
- **RDP 会话**：支持内嵌 IronRDP 远程桌面渲染，以及通过 MsTscAx sidecar 实现原生 RDP 体验
- **VNC 会话**：支持标准 VNC 协议连接，Canvas 渲染，光标同步
- **自适应渲染**：RDP/VNC 支持自适应帧率和动态质量调整

### 会话管理
- **会话树管理**：以文件夹/连接节点形式维护所有连接配置，支持拖拽排序、导入导出和右键菜单操作
- **快速连接**：在会话树中一键连接，支持连接配置的新增/编辑/删除
- **SFTP 上传**：可在会话树中直接对 SSH 节点执行文件上传，并显示整体与单文件进度

### 界面定制
- **多区域布局**：左侧、右侧、顶部、底部和中心终端区域均可配置，布局状态持久化到本地
- **外观定制**：支持终端主题、字体、透明度、背景图片、背景模糊、UI 透明度和自定义 CSS
- **无边框窗口**：现代化无边框设计，自定义标题栏支持拖拽和窗口控制

### 效率工具
- **历史命令**：自动记录已执行的命令（最多 30 条），支持快速重用
- **快捷命令**：支持自定义快捷命令列表，一键发送常用命令

## 截图展示

> 应用界面采用现代化设计，支持深色/浅色主题，可自由定制布局和外观。

## 技术架构

Lazy Term 采用前后端分离架构：

- **前端**：React 19 + TypeScript，使用 Zustand 进行状态管理
- **后端**：Rust + Tauri 2，实现各类协议的核心逻辑
- **通信**：通过 Tauri IPC（invoke + event）进行前后端通信

核心数据流：

```
React UI → Zustand stores → Connector → Tauri IPC → Rust backend
```

详细说明请参考 [架构文档 (architecture.md)](./docs/architecture.md) 以及 [终端双屏设计文档 (overview.md)](./docs/overview.md)。

## 目录结构

```
src/
  components/
    dialogs/       # 连接与布局相关弹窗
    layout/        # 左右顶部底部插槽与拖拽布局
    modules/       # 会话树、历史命令、快捷命令、标签栏等模块
    terminal/      # xterm.js 终端视图
    ui/            # shadcn/ui 基础组件
  config/          # 默认插槽配置、终端主题
  connectors/      # 本地终端、SSH、RDP、VNC 连接器
  hooks/           # 终端初始化与绑定逻辑
  services/        # Tauri IPC 服务封装
  store/           # Zustand 持久化状态
  types/           # TypeScript 类型定义
  workers/         # Web Workers

src-tauri/
  src/
    protocol/      # 协议核心实现与 Tauri 命令
    lib.rs         # 库入口
    state.rs       # 全局状态
  tauri.conf.json  # 桌面应用构建配置
```

## 开发环境

### 前置要求

- Node.js 20+
- npm 或 pnpm
- Rust stable toolchain
- Tauri 2 构建依赖

### 平台依赖

**Windows**：
- WebView2
- Visual Studio C++ Build Tools

**macOS**：
- Xcode Command Line Tools

**Linux**：
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

首次配置 Tauri 请参考 [官方文档](https://tauri.app/start/prerequisites/)。

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
# 仅前端开发（无后端功能）
npm run dev

# 完整桌面应用开发（推荐）
npm run tauri:dev
```

### 构建应用

```bash
# 前端构建
npm run build

# 桌面应用打包
npm run tauri:build
```

### 代码检查

```bash
npm run lint
```

## 使用指南

### 首次使用

1. 启动应用后，点击左侧会话树中的「本地终端」快速开始
2. 在设置中调整终端外观、字体、主题等偏好
3. 在会话树中右键添加 SSH/RDP/VNC 连接配置

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + T` | 新建标签页 |
| `Ctrl + W` | 关闭当前标签页 |
| `Ctrl + Tab` | 切换到下一个标签页 |
| `Ctrl + Shift + Tab` | 切换到上一个标签页 |
| `Ctrl + 滚轮` | 调整终端字体大小 |
| `Ctrl + Shift + C` | 复制选中内容（终端内） |
| `Ctrl + Shift + V` | 粘贴（终端内） |

### 布局调整

- 拖拽面板边界可调整各区域大小
- 点击面板标题栏可折叠/展开面板
- 在设置中可配置各面板显示的模块

## 配置说明

### 本地存储键

| 键名 | 说明 |
|------|------|
| `lazy-term-settings` | 终端和界面外观配置 |
| `lazy-term-slot-config` | 布局插槽配置 |
| `lazy-term-quick-commands` | 快捷命令列表 |
| `lazy-term-tabs` | 标签页状态 |
| `lazy-term-history` | 命令历史 |
| `terminal-sessions-v10` | SSH/RDP/VNC 会话树配置 |

### 数据存储位置

- **Windows**：`%APPDATA%/Lazy Term/`
- **macOS**：`~/Library/Application Support/Lazy Term/`
- **Linux**：`~/.config/Lazy Term/`

## 常见问题

### 本地终端创建失败

优先检查默认 Shell 是否存在，特别是 Windows 下的 `powershell.exe`、`pwsh.exe` 或 Git Bash 路径。可在设置中手动指定 Shell 路径。

### SSH 连接失败

检查主机、端口、用户名、认证方式和私钥格式。应用会在界面中弹出最近一次连接失败的详细信息。支持的私钥格式：OpenSSH、PEM。

### RDP 连接问题

- **IronRDP 模式**：适用于标准 RDP 服务器，支持内嵌渲染
- **Sidecar 模式**：需要 Windows 系统，调用 MsTscAx ActiveX 控件
- **mstsc 模式**：启动系统自带的远程桌面客户端

### 背景图发糊

如果背景图模式希望保持清晰，请将 UI 模式切换为 clear，避免额外的面板毛玻璃模糊叠加。

### 字体显示问题

确保系统中已安装所配置的字体。推荐等宽字体：
- Windows：Cascadia Code、Consolas
- macOS：SF Mono、Menlo
- Linux：Fira Code、JetBrains Mono

### 打包失败

先确认 Rust/Tauri 依赖完整，再分别执行 `npm run build` 和 `npm run tauri:build` 缩小问题范围。常见原因：
- Rust 工具链未安装
- 平台依赖缺失
- 前端构建错误

## 开发约定

- 前端状态统一放在 Zustand store 中，并使用 persist 中间件持久化
- 终端连接统一走 `ITerminalConnector` 抽象，不要在 UI 层直接调用后端命令
- 修改终端尺寸、焦点和容器布局时，优先检查 `TerminalView`、`useTerminal` 以及 App 中的 CSS 变量同步逻辑
- 增加新的 Tauri 命令后，别忘了同步检查权限配置与前端调用点

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | React 19 |
| 开发语言 | TypeScript |
| 构建工具 | Vite 6 |
| 桌面框架 | Tauri 2 |
| 后端语言 | Rust |
| 状态管理 | Zustand |
| 终端渲染 | xterm.js |
| UI 组件 | shadcn/ui |
| 样式方案 | Tailwind CSS v4 |
| 图标库 | lucide-react |
| 动画库 | framer-motion |
| 拖拽库 | @dnd-kit |

## 路线图

- [ ] Telnet 协议支持
- [ ] 多套布局预设管理
- [ ] 会话树云端同步
- [ ] 会话录制与回放
- [ ] 多语言支持
- [ ] 插件系统

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 许可证

[MIT License](./LICENSE)

## 致谢

- [Tauri](https://tauri.app/) - 构建跨平台桌面应用的框架
- [xterm.js](https://xtermjs.org/) - 功能强大的终端组件
- [shadcn/ui](https://ui.shadcn.com/) - 高质量的 React 组件库
- [russh](https://github.com/warp-tech/russh) - Rust SSH 客户端库
- [ironrdp](https://github.com/Devolutions/IronRDP) - Rust RDP 实现
