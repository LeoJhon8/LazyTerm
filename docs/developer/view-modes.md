# 视图模式

LazyTerm 提供三种互斥视图模式：

| 模式 | 快捷键 | 说明 |
| --- | --- | --- |
| `normal` | 无 | 标准布局，所有插槽和面板按用户配置显示 |
| `focus` | `Ctrl + Shift + F` | 隐藏左右侧边栏和底栏，保留标题栏和顶部标签 |
| `immersive` | `F11` | 隐藏标题栏和所有插槽，终端区域占满窗口 |

## UI 状态

| 区域 | normal | focus | immersive |
| --- | --- | --- | --- |
| CustomTitleBar | 显示 | 显示 | 隐藏 |
| 顶部插槽 | 显示 | 显示 | 隐藏 |
| 左右插槽 | 显示 | 隐藏 | 隐藏 |
| 底部插槽 | 显示 | 隐藏 | 隐藏 |
| PaneContainer | 标准布局 | 占满横向可用区域 | 占满窗口 |
| 分屏调整手柄 | 显示 | 显示 | 显示 |
| 面板控制按钮 | 显示 | 显示 | 显示 |

## 状态模型

`settings.ts` 中维护：

```typescript
type ViewMode = "normal" | "focus" | "immersive";
```

视图模式属于当前运行态，不应作为必须恢复的会话状态。应用重启后默认回到 `normal`。

## CSS 变量

| 模式 | `--lw` | `--rw` | `--th` | `--bh` |
| --- | --- | --- | --- | --- |
| normal | 用户设置 | 用户设置 | 用户设置 | 用户设置 |
| focus | `0px` | `0px` | 用户设置 | `0px` |
| immersive | `0px` | `0px` | `0px` | `0px` |

## 交互规则

- `F11`：`normal` 或 `focus` 进入 `immersive`，`immersive` 回到 `normal`。
- `Ctrl + Shift + F`：`normal` 或 `immersive` 进入 `focus`，`focus` 回到 `normal`。
- 三种模式互斥，切换时直接替换当前模式。

## 维护注意事项

- 新增布局插槽时，需要明确它在三种模式下是否显示。
- 修改窗口标题栏或标签栏时，需要检查沉浸模式悬浮栏。
- RDP/VNC 视图在 `immersive` 下仍需要保持输入转发和尺寸同步。
- 树形多面板分屏逻辑不应依赖左右或底部插槽是否显示。
