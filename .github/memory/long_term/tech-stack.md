# 项目技术栈记录 — lazy-terminal
记录时间: 2026-03-19

## Project Overview
- 应用类型：基于 Tauri 的桌面终端应用（混合前端 + 原生后端）。
- 主要功能：本地终端、SSH 会话、SSH 配置树、SFTP 上传、多插槽布局、外观持久化。

## Tech Stack
- 前端
  - 框架/语言：React 19, TypeScript
  - 构建/工具链：Vite（项目配置）、esbuild（部分构建任务）、npm
  - 样式：Tailwind CSS, PostCSS
  - 组件/UI：Radix UI 风格组件、Tailwind 实用类
  - 状态管理：Zustand（持久化存储 UI 与会话元数据）
  - 终端呈现：xterm.js（TerminalView），前端 connector 模式（LocalConnector、SshConnector 等）
  - 质量工具：ESLint、Prettier、TypeScript 配置

- 后端 / 原生桥接
  - 桌面壳：Tauri（Rust）
  - Rust 相关：Cargo、portable-pty（本地 PTY 支持）、russh、russh-sftp（SSH/SFTP）、相关 Tauri 命令在 `src-tauri/src/lib.rs` 中
  - 原生宿主：C# 项目 `msrdpax-host` 用于 RDP 原生宿主

- 主要语言：TypeScript、Rust、C#

## Core Logic（核心逻辑）
- 会话生命周期：前端通过 Zustand 管理会话元数据，Connector 实例为内存对象；创建会话时由 connector.open() 触发 Tauri 后端命令，后端返回 sessionId 并以事件驱动方式发送终端数据。
- Connector 模式：封装不同会话类型（local、ssh、rdp、vnc），前端通过 `ITerminalConnector` 接口与会话交互；禁止将 connector 实例持久化到 store 中。
- 布局与持久化：五区 slot 布局（left/top/center/right/bottom），slot 配置存于 `src/store/slot-config.ts` 并持久化。

## Conventions（项目约定）
- 只在 `.github/memory/short_term` 和 `.github/memory/long_term` 下存储 AI 管理的记忆；长期记忆允许修改、短期记忆仅追加。
- Store 仅持久化可序列化状态；事件订阅和 Connector 实例不应持久化。
- 插件/组件结构：`src/components/modules` 管理模块级 UI，`src/connectors` 包含连接器实现，`src-tauri/src` 包含 Rust 后端实现。

## Tech Debt（已知的系统局限/待办重构点）
- `telnet` 类型声明存在但未实现具体连接逻辑。
- SSH 断开 currently fallback 到本地连接，需改进断线恢复策略与用户通知流程。
- `SettingsModule` 为占位，实际设置 UI 分散在布局组件，可能需要统一重构以便扩展。
- DnD（拖拽排序）行为对树结构移动需更严格的祖先校验（防止移动到自身后代）。

## Sources / 参考
- 源文件摘录：`src/App.tsx`, `src/components/modules/SessionModule.tsx`, `src/components/terminal/TerminalView.tsx`, `src/store/*`, `src/connectors/*`, `src-tauri/src/lib.rs`。
---
