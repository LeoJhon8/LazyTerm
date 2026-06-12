# Unified Connection Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 SSH、VNC、FreeRDP 和 MSTSCAX 的连接状态遮罩，同时将首帧、尺寸调整和原生窗口避让保留为独立过渡遮罩。

**Architecture:** 新增由 `SessionConnectionStatus` 驱动的 `ConnectionStatusOverlay`，集中完成状态到轻量遮罩或诊断卡片的映射。新增 `SessionTransitionMask` 处理视觉同步，不修改连接状态；各协议视图只提供协议、目标、详情和重连回调。

**Tech Stack:** React、TypeScript、Zustand、Tailwind CSS、Tauri

---

### Task 1: 建立统一遮罩组件

**Files:**
- Create: `src/components/terminal/ConnectionStatusOverlay.tsx`
- Create: `src/components/terminal/SessionTransitionMask.tsx`
- Modify: `src/components/terminal/BaseSessionView.tsx`
- Modify: `src/components/terminal/index.ts`

- [ ] **Step 1: 实现连接状态遮罩**

实现 `ConnectionStatusOverlay`，输入 `status`、`protocol`、`target`、可选详情和重连回调。`connecting`、`authenticating`、`reconnecting` 渲染轻量居中遮罩；`failed`、`disconnected` 渲染完整诊断卡片；其余状态返回 `null`。

- [ ] **Step 2: 实现视觉过渡遮罩**

将现有 `TransitionMask` 样式迁移到 `SessionTransitionMask`，只接收 `visible` 和 `text`，不读取连接状态。

- [ ] **Step 3: 更新公共导出**

从 `BaseSessionView.tsx` 删除旧的 `GraphicalSessionOverlay` 和 `TransitionMask`，在 `index.ts` 导出两个新组件。

### Task 2: 接入终端、VNC 和 FreeRDP

**Files:**
- Modify: `src/components/terminal/TerminalViewClass.tsx`
- Modify: `src/components/terminal/VncViewClass.tsx`
- Modify: `src/components/terminal/RemoteDesktopViewClass.tsx`

- [ ] **Step 1: 替换 SSH/终端顶部胶囊**

使用 `ConnectionStatusOverlay` 替代 `TerminalViewClass` 内联状态 UI，传入协议标签、目标地址和远程协议重连回调。

- [ ] **Step 2: 替换 VNC 连接状态卡片**

使用统一连接遮罩；当状态为 `connected` 且尚无 `frameSize` 时显示 `SessionTransitionMask`，尺寸变化继续使用同一过渡遮罩。

- [ ] **Step 3: 替换 FreeRDP 连接状态卡片**

使用统一连接遮罩；只有连接已建立时才显示首帧或尺寸调整过渡遮罩，避免与连接遮罩重叠。

### Task 3: 收敛 MSTSCAX 遮罩职责

**Files:**
- Modify: `src/components/terminal/NativeRdpHostView.tsx`

- [ ] **Step 1: 接入统一连接状态遮罩**

连接中、失败和断开全部由 session 的 `connectionStatus` 渲染，不再由本地 `overlayMode` 决定卡片样式。

- [ ] **Step 2: 保留原生窗口视觉过渡**

将 host 未视觉就绪、尺寸调整和菜单避让映射到 `SessionTransitionMask`；显示过渡遮罩时继续调用 `connector.setVisible(false)`。

- [ ] **Step 3: 删除重复 UI 状态**

移除仅用于选择连接卡片的本地状态和重复文案，保留连接历史与激活宽限期所需的原生生命周期逻辑。

### Task 4: 验证

**Files:**
- Review: `src/components/terminal/*.tsx`

- [ ] **Step 1: 检查差异和空白错误**

Run: `git diff --check`

Expected: 无 whitespace error。

- [ ] **Step 2: TypeScript 编译检查**

Run: `& 'C:\nvm4w\nodejs\node.exe' '.\node_modules\typescript\bin\tsc' -p tsconfig.json --noEmit`

Expected: exit code 0。

- [ ] **Step 3: Rust 编译检查**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: exit code 0。项目规则禁止默认执行 build 和测试。
