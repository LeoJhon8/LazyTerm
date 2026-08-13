# LazyTerm 文档

> **简体中文** | [English](./en/README.md)

这里收录 LazyTerm 的用户指南和维护者文档。项目入口、功能摘要与构建命令见仓库根目录的 [README](../README.md)。

## 用户文档

| 文档 | 内容 |
| --- | --- |
| [快速开始](./user/getting-started.md) | 获取应用、源码运行、首次使用和数据边界 |
| [功能说明](./user/features.md) | 协议、工作区、终端、文件传输、AI 和配置同步 |
| [快捷键](./user/shortcuts.md) | 全局、标签页和终端快捷操作 |
| [常见问题](./user/troubleshooting.md) | 连接、凭据、SFTP、原生依赖和开发环境排查 |

## 开发者文档

| 文档 | 内容 |
| --- | --- |
| [架构设计](./developer/architecture.md) | 工作区与会话模型、连接编排、Tauri IPC、Rust 后端和持久化边界 |
| [Windows 开发环境](./developer/development-setup-windows.md) | Windows 工具链、原生依赖、环境变量与初始化脚本 |
| [开发工作流](./developer/development-workflow.md) | 日常命令、验证规则、协议扩展和双语文档维护 |
| [RDP 架构](./developer/rdp-architecture.md) | FreeRDP、MsTscAx sidecar、连接状态和性能路径 |
| [视图模式](./developer/view-modes.md) | `normal`、`focus`、`immersive` 的状态与布局规则 |
| [依赖许可证审计](./developer/dependency-license-audit.md) | 已执行的 npm、Cargo 和原生依赖许可证基线 |
| [仓库公开前检查清单](./developer/public-release-checklist.md) | 许可证、敏感信息、社区设置和发布完整性 |

## 维护规则

- `docs/user/` 面向使用者，避免依赖内部实现才能理解的说明。
- `docs/developer/` 面向维护者，记录架构边界、构建依赖和变更约束。
- `docs/en/` 与中文目录保持相同结构；新增或修改文档时应同步更新对应英文版和两份索引。
- 历史审计、发布清单等记录应保留实际执行日期，不应仅因翻译或排版修改而刷新日期。
