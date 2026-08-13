# 视图模式

> **简体中文** | [English](../en/developer/view-modes.md)

LazyTerm 提供三种互斥视图模式：

| 模式 | 快捷键 | 说明 |
| --- | --- | --- |
| `normal` | 无 | 标准布局，按用户插槽配置展示界面 |
| `focus` | `Ctrl/Command + Shift + F` | 隐藏左右与底部插槽，保留标题栏和顶部插槽 |
| `immersive` | `F11` | 隐藏标题栏和全部插槽，会话区域占满窗口 |

## 状态模型

`src/store/settings.ts` 定义：

```typescript
type ViewMode = "normal" | "focus" | "immersive";
```

`viewMode` 存在于 Settings Store，但被 `partialize` 明确排除，不写入持久化数据。应用启动时为 `normal`；所有会话关闭时 `useViewMode` 也会自动恢复 `normal`。

## 可见性矩阵

| 区域 | `normal` | `focus` | `immersive` |
| --- | --- | --- | --- |
| `CustomTitleBar` | 显示 | 显示 | 隐藏 |
| `ImmersiveHoverBar` | 隐藏 | 隐藏 | 显示 |
| 顶部插槽 / 标签栏 | 按配置 | 按配置 | 隐藏 |
| 左右插槽 | 按配置 | 隐藏 | 隐藏 |
| 底部插槽 | 按配置 | 隐藏 | 隐藏 |
| `PaneContainer` | 剩余空间 | 扩展到侧边和底部空间 | 扩展到整个窗口 |
| 分屏和面板控制 | 显示 | 显示 | 显示 |

空插槽或无有效模块的插槽即使在 `normal` 下也会隐藏，因此实际尺寸不只取决于 `viewMode`。

## 布局计算

`App.tsx` 与 `SlotManager.tsx` 根据视图模式、插槽折叠状态和有效模块数量计算布局。关键尺寸包括：

- 左右插槽的有效宽度。
- 顶部插槽高度 `th`。
- 底部行高度 `bh`。
- 标题栏高度。

这些值会影响 WebView 中的会话视图，也会通过 `windowResizeCoordinator` 影响 MsTscAx 原生 RDP 的矩形同步。不要仅用 CSS 隐藏原生 RDP 上方的区域，而不通知原生宿主。

## 快捷键与切换规则

`useViewMode` 优先通过 Tauri global-shortcut 注册：

- `F11`：当前不是 `immersive` 时进入 `immersive`；已在 `immersive` 时返回 `normal`。
- `Ctrl/Command + Shift + F`：当前不是 `focus` 时进入 `focus`；已在 `focus` 时返回 `normal`。

因此从 `focus` 按 `F11` 会直接进入 `immersive`，从 `immersive` 按专注快捷键会直接进入 `focus`。注册失败时，应用会回退到窗口内 `keydown` 监听。

## 图形会话影响

- 面板在任一模式中保持相同的会话与 Connector，不因布局隐藏而重新创建。
- `PaneView` 把实际可见性报告给 `ConnectionQualityScheduler`，影响 RDP/VNC 质量预算。
- FreeRDP/VNC 需要在尺寸稳定后调整 Canvas 或请求远端尺寸/刷新。
- MsTscAx 需要同步 placeholder 矩形、显示状态、焦点和遮罩区域。
- 沉浸悬浮栏出现或隐藏时不得遮挡未更新 overlay 的原生 RDP surface。

## 维护检查

修改标题栏、插槽、视图模式或窗口尺寸逻辑时至少检查：

1. 三种模式下各区域是否符合可见性矩阵。
2. 从任意模式触发两个快捷键后的目标模式。
3. 关闭最后一个会话是否回到 `normal`。
4. 终端、FreeRDP、VNC 的尺寸与焦点是否正常。
5. MsTscAx 在标签切换、最小化、恢复、DPI 变化和弹窗覆盖时是否正确同步。
6. 会话质量调度是否把隐藏面板降为后台或暂停模式。
