# LazyTerm 文档索引

本文档目录按读者拆分为两部分：

- `user/`：面向终端用户，说明如何安装、启动、使用功能和排查常见问题。
- `developer/`：面向维护者，说明项目架构、开发环境、日常工作流和关键设计。

## 用户文档

| 文档 | 内容 |
| --- | --- |
| [快速开始](./user/getting-started.md) | 环境要求、安装依赖、启动应用和首次使用 |
| [功能说明](./user/features.md) | 本地终端、SSH、RDP、VNC、串口、Telnet、SFTP、布局和同步能力 |
| [快捷键](./user/shortcuts.md) | 常用全局快捷键和终端快捷操作 |
| [常见问题](./user/troubleshooting.md) | 连接、构建、RDP/VNC、串口和环境问题排查 |

## 开发者文档

| 文档 | 内容 |
| --- | --- |
| [架构概览](./developer/architecture.md) | 前端、连接器、Tauri IPC、Rust 后端和持久化模型 |
| [Windows 开发环境](./developer/development-setup-windows.md) | Windows 新机器所需工具链和项目依赖 |
| [开发工作流](./developer/development-workflow.md) | 日常命令、代码检查、目录约定和变更注意事项 |
| [RDP 架构](./developer/rdp-architecture.md) | FreeRDP、MsTscAx sidecar 和性能路径 |
| [视图模式](./developer/view-modes.md) | normal、focus、immersive 三种视图模式的维护说明 |
