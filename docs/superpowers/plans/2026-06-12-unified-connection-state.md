# Unified Connection State Implementation Plan

> **For agentic workers:** Execute inline. Project rules prohibit creating or running tests.

**Goal:** 统一全部会话协议的连接状态、断开行为和手动重连界面。

**Architecture:** Connector 通过统一事件接口上报生命周期；`tabs.ts` 订阅并维护 Session 状态，作为 UI 唯一数据源。视图保留首帧、画面同步等视觉状态，不再自行推断协议连接结果。

**Tech Stack:** React 19、TypeScript、Zustand、Tauri 2

---

### Task 1: 状态类型与事件基础设施

**Files:**
- Modify: `src/types/terminal.ts`
- Create: `src/connectors/ConnectionStateEmitter.ts`

- [x] 定义统一阶段、事件和 Session 状态类型。
- [x] 扩展 Connector 接口并实现可复用状态事件发射器。

### Task 2: Connector 生命周期接入

**Files:**
- Modify: `src/connectors/*.ts`

- [x] 为所有文本协议 Connector 上报连接、成功、失败、断开和关闭。
- [x] 为图形协议基类和 Native RDP 映射统一状态。
- [x] 简化 `ConnectorFactory`，移除协议专用断开回调。

### Task 3: Session 状态源

**Files:**
- Modify: `src/store/tabs.ts`

- [x] 每个 Session 保存统一连接状态。
- [x] 集中订阅和释放 Connector 状态监听。
- [x] 本地终端自动重建，其他协议保留会话并手动重连。
- [x] 删除 SSH 降级和串口专用状态。

### Task 4: 统一状态界面

**Files:**
- Modify: `src/components/terminal/*.tsx`
- Modify: `src/components/modules/TabBar.tsx`

- [x] 文本终端显示统一状态提示和重连操作。
- [x] 图形视图读取 Session 状态。
- [x] 标签页增加状态色点。

### Task 5: 编译检查

- [x] 运行 TypeScript `tsc --noEmit`。
- [x] 运行 Rust `cargo check`。
- [x] 运行 `git diff --check` 并审查状态流转。
