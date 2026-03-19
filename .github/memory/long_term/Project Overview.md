# 项目长期记忆（long_term）

## Project Overview
- Lazy Terminal：基于 Tauri 2 的桌面终端应用，前端使用 React 19 + TypeScript，状态管理为 Zustand，终端渲染使用 xterm.js，后端使用 Rust（portable-pty、russh 等）。
- 主要功能：本地 PTY 终端、本地/SSH 会话、SSH 配置树、SFTP 上传、RDP/VNC 支持、可配置的插槽布局与持久化外观设置。

## Core Logic
- 会话生命周期：前端通过 `tabs` store 创建会话 -> 选择 `LocalConnector` / `SshConnector` / `NativeRdpConnector` -> connector.open() 调用 Tauri 命令创建后端会话 -> 前端订阅 `terminal-data-{sessionId}` 事件并写入 xterm，输入由 connector.write() 发回后端。
- Connector 模式：所有连接器实现 `ITerminalConnector`（见 src/types/terminal.ts），UI 与后端通过 connector 抽象交互；不要在 UI 组件中直接散落 `invoke()` 调用。
- 状态持久化：仅持久化可序列化数据（Zustand stores），connector 实例与事件订阅为内存对象，不应持久化。
- SSH/SFTP：后端在 `src-tauri/src/lib.rs` 处理 SSH 会话、认证与 SFTP 上传，前端通过事件跟踪进度与取消。
- 外观与布局：外观由 `src/store/settings.ts` 管理，并在 `src/App.tsx` 应用（主题、背景图、模糊、字体等）。布局采用五插槽（left/top/right/center/bottom），配置保存在 `src/config/default-slot-config.ts` 与 `src/store/slot-config.ts`。

## Conventions
- 目录约定：
  - UI 组件：src/components/
  - 终端与视图：src/components/terminal/
  - 连接器实现：src/connectors/
  - Zustand 存储：src/store/
  - Tauri 后端：src-tauri/src/
- 命名：连接器类以 `*Connector.ts` 后缀（如 `LocalConnector.ts`、`SshConnector.ts`）；Stores 文件使用复数或功能名（如 `tabs.ts`、`settings.ts`）。
- 持久化规则：store 中只保存序列化字段；避免在 store 中保存回调、连接器实例或大型不可序列化对象。
- 事件命名：继续使用 `terminal-data-{sessionId}`、`terminal-close-{sessionId}` 等约定以保持前后端一致性。

## Tech Debt
- SSH 断开处理：目前断开会回退为本地连接的行为不理想，应区分会话类型并改进重连/恢复逻辑。
- Connector 重建：tabs persist metadata 但 connector 为内存对象，重连与恢复流程需要更稳健的重建策略与失败恢复流程。
- Telnet：类型定义存在但未实现，需要移除或实现以避免混淆。
- 布局/渲染时序：TerminalView 与容器尺寸依赖细节导致偶发渲染/焦点问题，需要统一容器 `min-h-0`/伸缩策略并增加更可靠的 resize 同步。
- Windows PTY 兼容性：需持续验证 ConPTY 与 portable-pty 的边界情况与管理员路径行为。
- 测试覆盖率：端到端的 SSH/SFTP、RDP 集成测试与关键路径单元测试不充分，建议补足测试套件并在 CI 中运行 lint/测试。

---

（记录更新于 2026-03-19）
