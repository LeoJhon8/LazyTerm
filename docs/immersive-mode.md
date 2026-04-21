# 视图模式设计文档

## 1. 概述

LazyTerm 提供三种视图模式，满足不同专注程度的需求：

| 模式 | 快捷键 | 说明 |
|------|--------|------|
| **正常模式** (normal) | — | 标准布局，所有面板正常显示 |
| **专注模式** (focus) | `Ctrl+Shift+F` | 仅隐藏左右侧边栏和底栏，保留标题栏和标签栏 |
| **沉浸模式** (immersive) | `F11` | 隐藏一切 UI，终端全屏，鼠标移至顶部唤出悬浮栏 |

三种模式互斥，切换时直接替换。

## 2. UI 状态对比

| 区域 | 正常模式 | 专注模式 | 沉浸模式 |
|------|---------|---------|---------|
| CustomTitleBar | 显示 | 显示 | **隐藏** |
| 顶部插槽 (TabBar) | 显示 | 显示 | **隐藏** |
| 左/右插槽 (侧边栏) | 显示 | **隐藏** | **隐藏** |
| 底部插槽 (QuickCmdBar) | 显示 | **隐藏** | **隐藏** |
| 背景装饰球 | 显示 | 显示 | **隐藏** |
| 背景图片 | 按用户配置 | 按用户配置 | 按用户配置 |
| PaneContainer / 终端内容 | 受布局约束 | 宽度占满 | **占满全屏** |
| 分屏调整手柄 | 显示 | 保持 | 保持 |
| 面板控制按钮 | 悬浮显示 | 保持 | 保持 |

## 3. 交互设计

### 3.1 快捷键

| 快捷键 | 效果 |
|--------|------|
| `F11` | 切换沉浸模式（normal/focus → immersive，immersive → normal） |
| `Ctrl+Shift+F` | 切换专注模式（normal/immersive → focus，focus → normal） |

### 3.2 悬浮标题栏（仅沉浸模式）

| 操作 | 效果 |
|------|------|
| 鼠标移至屏幕最顶部 (0-4px) | 唤出悬浮标题栏 |
| 鼠标离开悬浮栏 800ms | 自动隐藏 |

悬浮栏包含：
- 半透明 `bg-background/80 backdrop-blur-xl`
- 品牌名 + 当前会话标题 + 会话类型标签
- 窗口控制按钮（最小化/最大化/关闭）
- 多标签时上方显示极简标签条

## 4. 数据模型

### settings.ts

```typescript
type ViewMode = "normal" | "focus" | "immersive";

viewMode: ViewMode;                  // 当前视图模式（不持久化，默认 normal）
immersiveHoverBarDelay: number;      // 悬浮标题栏消失延迟 (ms)，默认 800
immersiveShowTabStrip: boolean;      // 沉浸模式下是否显示悬浮标签条，默认 true
```

### CSS 变量覆盖

| 模式 | `--lw` | `--rw` | `--th` | `--bh` |
|------|--------|--------|--------|--------|
| normal | 按设置 | 按设置 | 按设置 | 按设置 |
| focus | 0px | 0px | 按设置 | 0px |
| immersive | 0px | 0px | 0px | 0px |

## 5. 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/store/settings.ts` | 修改 | `ViewMode` 类型 + `viewMode` 字段 |
| `src/hooks/useViewMode.ts` | 新增 | F11 / Ctrl+Shift+F 快捷键 & 视图模式管理 |
| `src/components/layout/ImmersiveHoverBar.tsx` | 新增 | 沉浸模式悬浮标题栏 + 标签条 |
| `src/App.tsx` | 修改 | 三种模式条件渲染 & CSS 变量覆盖 |
| `src-tauri/Cargo.toml` | 修改 | 添加 `tauri-plugin-global-shortcut` 依赖 |
| `src-tauri/src/lib.rs` | 修改 | 注册 global-shortcut 插件 |
| `src-tauri/capabilities/default.json` | 修改 | 添加 global-shortcut 权限 |

## 6. 边界情况

| 场景 | 处理策略 |
|------|---------|
| 关闭最后一个会话 | 自动回到 normal 模式 |
| RDP/VNC 全屏 | 不冲突，全屏是终端内行为 |
| 窗口失焦再获焦 | 保持当前视图模式不变 |
| 应用重启 | viewMode 不持久化，默认 normal |
| 分屏 + 专注/沉浸模式 | 正常工作，面板占满可用区域 |
