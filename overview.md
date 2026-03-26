# 终端双屏架构设计文档 (Terminal Dual-Screen Architecture Design)

| 文档版本 | v3.0 (双屏核心版) |
| :--- | :--- |
| **最后更新** | 2026-03-24 |
| **状态** | ✅ 已完成落地 |
| **核心目标** | 基于原单屏逻辑平滑演进至双屏，明确“焦点”与“显示”的分离，预留多屏扩展能力 |

---

## 1. 设计概述 (Overview)

### 1.1 核心理念：焦点继承与显示解耦
本架构的核心在于对原有单屏概念的精准拆分：
*   **操作权（焦点）**：原有的“当前活动会话”概念演变为 **`focusSessionId`**。它唯一决定了**快捷命令栏**和**历史命令栏**的发送目标。无论屏幕上显示多少个会话，用户输入的指令只发送给 `focusSessionId` 指向的会话。
*   **显示权（列表）**：新增 **`activeSessionIds`** 数组，用于管理屏幕上**同时可见**的会话集合。在双屏模式下，该数组长度为 2；在未来扩展模式下，长度可动态增加。

### 1.2 适用范围与扩展性
*   **当前阶段**：严格支持**双屏模式**（最多同时显示 2 个会话）。
*   **未来扩展**：架构设计不硬编码“2”这个数字。通过配置最大槽位数，可平滑升级至 4 屏、6 屏或更多，无需重构核心状态逻辑。

### 1.3 关键约束
*   **类型隔离**：仅文本类会话（如本地终端、SSH）支持分屏显示。图形类会话（如 RDP、VNC）因其资源特性，**严禁**进入分屏列表，只能以单屏独占模式运行。
*   **焦点唯一性**：在任何时刻，`focusSessionId` 必须且只能指向 `activeSessionIds` 中的某一个元素。

---

## 2. 核心数据模型 (Data Model)

系统仅维护以下三个核心变量来驱动所有终端行为：

### 2.1 变量定义

1.  **`focusSessionId`** (字符串 | 空值)
    *   **定义**：当前拥有键盘/鼠标焦点的会话 ID。
    *   **核心职责**：
        *   接收所有键盘输入。
        *   **接收快捷命令栏发送的指令**。
        *   **接收历史命令栏重放的指令**。
        *   决定哪个分屏区域显示高亮边框（激活态）。
    *   **来源**：直接由原单屏架构中的“活动会话 ID”演进而来。

2.  **`activeSessionIds`** (字符串数组)
    *   **定义**：当前在屏幕上可见的所有会话 ID 列表。
    *   **结构**：
        *   单屏时：`[focusSessionId]` (长度为 1)。
        *   双屏时：`[id_A, id_B]` (长度为 2)，其中必有一个等于 `focusSessionId`。
    *   **核心职责**：决定 UI 渲染几个窗口，以及每个窗口显示哪个会话的内容。

3.  **`MAX_SPLIT_PANES`** (整数常量)
    *   **定义**：系统允许的最大分屏数量。
    *   **当前值**：`2`。
    *   **未来值**：可扩展为 `4`, `8` 等。

### 2.2 会话类型规则
    activeSessionIds仅为可视会话，但是RDP、VNC、其他图形协议不允许分屏显示，即activeSessionIds要么没有RDP、VNC、其他图形协议，要么只有RDP、VNC、其他图形协议

---

## 3. 状态变更逻辑 (State Transition Logic)

所有状态变更必须严格遵守以下三种模式，确保 `activeSessionIds` 的长度变化符合预期。

### 3.1 模式一：分屏扩展 (Expand)
*   **触发条件**：用户显式点击“分屏”按钮，并从列表中选择了一个目标会话。
*   **前置检查**：
    1.  当前 `activeSessionIds` 长度 < `MAX_SPLIT_PANES`。
    2.  当前 `focusSessionId` 对应的会话类型允许分屏（非 RDP/VNC）。
    3.  被选中的目标会话类型允许分屏（非 RDP/VNC）。
*   **执行动作**：
    1.  将目标会话 ID **追加** 到 `activeSessionIds` 数组末尾。
    2.  将 `focusSessionId` 更新为**目标会话 ID**（新分屏自动获得焦点）。
*   **结果**：数组长度 +1（从 1 变 2），界面从单屏变为双屏。

### 3.2 模式二：内容替换 (Replace)
*   **触发条件**：
    *   用户点击标签栏中**不在**当前分屏里的其他标签。
    *   用户新建一个标签。
    *   用户在分屏区域内拖拽替换会话。
*   **核心逻辑**：**只换人，不换座**。
*   **执行动作**：
    1.  找到 `focusSessionId` 在 `activeSessionIds` 数组中的索引位置（Index）。
    2.  用新会话 ID **覆盖** 该索引位置的原 ID。
    3.  将 `focusSessionId` 更新为**新会话 ID**。
    4.  原会话 ID 从 `activeSessionIds` 中移除（回归后台标签列表，但不关闭）。
*   **结果**：数组长度 **保持不变**（仍为 2），界面布局不变，仅当前焦点所在的屏幕内容刷新。

### 3.3 模式三：分屏收缩 (Shrink)
*   **触发条件**：
    *   用户关闭了 `activeSessionIds` 中的某个会话。
    *   用户执行“取消分屏”操作。
*   **执行动作**：
    1.  从 `activeSessionIds` 数组中**移除**指定的会话 ID。
    2.  **焦点转移**：
        *   若数组剩余元素不为空，将 `focusSessionId` 设置为剩余元素中的某一项（优先保留原索引位置，若越界则取最后一项）。
    3.  **布局退化**：
        *   若移除后数组长度变为 1，系统自动退出双屏模式，恢复单屏全屏显示。
*   **结果**：数组长度 -1（从 2 变 1），界面从双屏变回单屏。

---

## 4. 交互与命令路由规范 (Interaction & Routing)

### 4.1 命令发送目标 (Command Routing)
这是本架构最关键的行为准则，所有外部输入必须严格路由到 **`focusSessionId`**。

*   **快捷命令栏 (Quick Command Bar)**：
    *   当用户点击快捷命令栏中的任一指令（如 `ls -l`, `cd /var`）时，系统读取当前的 `focusSessionId`。
    *   指令**仅发送**给 `focusSessionId` 对应的会话实例。
    *   *场景示例*：左屏是服务器 A，右屏是服务器 B。若焦点在右屏，点击快捷命令，指令只发给服务器 B。

*   **历史命令栏 (History Command Bar)**：
    *   当用户从历史记录中选择一条命令进行回放时，系统读取当前的 `focusSessionId`。
    *   命令**仅发送**给 `focusSessionId` 对应的会话实例。
    *   *场景示例*：用户在右屏操作了一半，想复用左屏的历史记录。必须先点击左屏（切换焦点），再点击历史记录，命令才会发给左屏。

*   **键盘直接输入**：
    *   所有键盘敲击字符、快捷键（Ctrl+C, Ctrl+Z 等）均直接发送至 `focusSessionId`。

### 4.2 焦点切换交互
*   **鼠标点击**：用户点击任意分屏区域内部，该区域对应的会话 ID 立即成为新的 `focusSessionId`。
*   **视觉反馈**：
    *   `focusSessionId` 对应的分屏容器显示高亮边框（或特定激活色）。
    *   非焦点的分屏容器显示普通边框（或弱化色）。
    *   标签栏中，对应 `focusSessionId` 的标签应呈现“当前激活”样式。

### 4.3 标签栏交互逻辑
*   **点击“非活动”标签**（即不在 `activeSessionIds` 中的标签）：
    *   触发 **模式二 (Replace)**。
    *   当前焦点所在的屏幕内容被新标签替换。
    *   分屏数量不变。
*   **点击“活动”标签**（即在 `activeSessionIds` 中但非焦点的标签）：
    *   仅触发焦点切换。
    *   `focusSessionId` 更新为该标签 ID。
    *   分屏内容和数量均不变。

---

## 5. 模块职责简述 (Module Responsibilities)

### 5.1 状态管理中心
*   维护 `focusSessionId` 和 `activeSessionIds` 的唯一真实数据源。
*   执行上述三种模式（Expand, Replace, Shrink）的原子操作。
*   执行会话类型校验（拦截 RDP/VNC 进入分屏）。

### 5.2 布局渲染引擎
*   监听 `activeSessionIds` 的长度变化。
*   **长度为 1**：渲染单个全屏容器。
*   **长度为 2**：渲染两个并排的容器，各占 50% 空间。
*   **未来扩展**：设计代码时，需要考虑未来扩展长度为可配置

### 5.3 输入路由控制器
*   拦截全局键盘事件和工具栏点击事件。
*   读取当前的 `focusSessionId`。
*   将事件 payload 转发给该 ID 对应的终端实例处理器。

---

## 6. 实现落地记录 (Implementation)

### 6.1 实现状态：✅ 已完成

本架构设计已于 2026-03-24 正式落地实现。

### 6.2 修改的文件清单

| 文件路径 | 修改类型 | 核心变更 |
| :--- | :--- | :--- |
| `src/store/tabs.ts` | 重构 | 核心状态管理重构，新增 `focusSessionId`、`activeSessionIds`、`MAX_SPLIT_PANES`，以及 `expandSplitPane`、`shrinkSplitPane`、`replaceSplitPane`、`setFocusSession`、`isGraphicalSession`、`getFocusSession`、`canExpandSplitPane`、`getSplittableSessions` 等分屏相关方法 |
| `src/components/terminal/TerminalView.tsx` | 增强 | 支持多屏渲染，根据 `activeSessionIds` 渲染对应数量的终端面板，焦点面板显示高亮边框 |
| `src/App.tsx` | 适配 | 使用 `focusSessionId` 替代 `activeSessionId`，图形协议会话或分屏模式下隐藏快捷命令栏 |
| `src/components/modules/QuickCmdBar.tsx` | 适配 | 命令发送目标改为焦点会话 (`focusSessionId`) |
| `src/components/modules/TabBar.tsx` | 增强 | 添加分屏交互，TabBar 上下文菜单新增"与其他标签页分屏"和"取消分屏"选项，添加分屏目标选择对话框 |

### 6.3 关键实现细节

**分屏状态管理**
*   `focusSessionId`：命令路由目标，决定快捷命令栏和历史命令栏的发送目标
*   `activeSessionIds`：可见会话列表，支持 1-2 个会话同时显示
*   `MAX_SPLIT_PANES`：最大分屏数，当前为 2

**新建会话行为**
*   新建会话时，新会话 ID 会**替换** `activeSessionIds` 中焦点位置的会话
*   这样确保新建会话始终单屏全屏显示，不会自动触发分屏

**标签切换行为**
*   点击**非活动标签**（不在 `activeSessionIds` 中）：触发 `replaceSplitPane`，替换焦点面板内容
*   点击**活动标签**（在 `activeSessionIds` 中但非焦点）：仅切换焦点，不改变分屏布局

**三种分屏模式**
1.  **Expand（扩展）**：单屏→双屏，通过 TabBar 上下文菜单选择目标会话
2.  **Replace（替换）**：点击非活动标签，只换内容不换布局
3.  **Shrink（收缩）**：关闭会话或"取消分屏"→ 双屏→单屏

**图形协议限制**
*   RDP/VNC 会话不支持分屏，存储在 `isGraphicalSession()` 方法中校验
*   图形会话激活时，自动隐藏底部快捷命令栏

### 6.4 视图组件重构：模板方法模式 (2026-03-25)

#### 设计目标
将三个视图组件（TerminalView、RemoteDesktopView、VncView）抽象出一个共同的父类，使用**模板方法模式**统一架构。

#### 架构设计

**抽象基类 `BaseSessionView`**
- 定义模板方法 `render()`，规定渲染算法骨架
- 提供 `useBaseSessionView()` Hook，封装通用状态管理
- 定义抽象方法 `renderContent()` 和 `getViewType()`，子类必须实现

**子类实现**
| 子类 | 实现内容 | 视图类型 |
|------|----------|----------|
| `TerminalViewClass` | xterm.js 终端渲染 | terminal |
| `RemoteDesktopViewClass` | Canvas RDP 画面渲染 | rdp |
| `VncViewClass` | Canvas VNC 画面渲染 | vnc |

#### 核心代码结构
```typescript
// 基类定义模板方法
abstract class BaseSessionView {
  public render(props): ReactElement {
    const baseResult = this.useBaseViewLogic(props);  // 步骤1
    return this.renderWrapper(baseResult, props);      // 步骤2
  }
  
  protected abstract renderContent(result, props): ReactNode;  // 子类实现
  protected abstract getViewType(): string;                    // 子类实现
}

// 子类通过 Hook 组合实现
function TerminalViewClass(props) {
  const baseResult = useBaseSessionView(props);  // 复用基类逻辑
  // ... 特有逻辑
  return <main data-view-type="terminal">{/* 内容 */}</main>;
}
```

#### 新增文件
| 文件路径 | 说明 |
|----------|------|
| `src/components/terminal/BaseSessionView.tsx` | 抽象基类，定义模板方法和共享组件 |
| `src/components/terminal/TerminalViewClass.tsx` | 终端视图子类 |
| `src/components/terminal/RemoteDesktopViewClass.tsx` | RDP 视图子类 |
| `src/components/terminal/VncViewClass.tsx` | VNC 视图子类 |
| `src/components/terminal/index.ts` | 统一导出 |
| `src/components/terminal/README.md` | 架构文档 |

#### 修改文件
| 文件路径 | 修改内容 |
|----------|----------|
| `src/components/layout/PaneView.tsx` | 使用新的 Class 组件替换原有组件 |
| `src/components/terminal/TerminalView.tsx` | 删除 | 已被 `TerminalViewClass.tsx` 替代 |
| `src/components/terminal/RemoteDesktopView.tsx` | 删除 | 已被 `RemoteDesktopViewClass.tsx` 替代 |
| `src/components/terminal/VncView.tsx` | 删除 | 已被 `VncViewClass.tsx` 替代 |

#### 代码清理 (2026-03-25)

**删除重复文件：**
删除了 `terminal` 目录下的 3 个旧版本文件：
- `TerminalView.tsx` → 使用 `TerminalViewClass.tsx`
- `RemoteDesktopView.tsx` → 使用 `RemoteDesktopViewClass.tsx`
- `VncView.tsx` → 使用 `VncViewClass.tsx`

**当前文件结构：**
```
src/components/terminal/
├── BaseSessionView.tsx           # 抽象基类
├── BaseGraphicSessionView.tsx    # 图形化视图抽象子类
├── TerminalViewClass.tsx         # 终端视图
├── RemoteDesktopViewClass.tsx    # RDP 视图
├── VncViewClass.tsx              # VNC 视图
├── NativeRdpHostView.tsx         # Native RDP 宿主视图
├── index.ts                      # 统一导出
└── README.md                     # 架构文档
```

#### Pane 工具属性重构 (2026-03-25)

**设计目标：**
将 Pane 相关的操作逻辑从 Store 中抽取出来，形成独立的工具属性文件，支持：
- 被外部直接调用操作（新增、减少 Pane）
- 最少可为 0 个 Pane（`MIN_PANES = 0`）- 没有 pane 时展示桌面首页
- 最多支持 2 个 Pane（`MAX_PANES = 2`）
- 默认初始化：当 MIN_PANES = 0 时为空数组，否则创建默认 Pane
- **分屏状态不持久化**：每次打开应用重置，分屏是"本次会话"的布局选择

**重构方案：**

1. **新建 `src/lib/pane-utils.ts`**
   - 纯函数式的 Pane 操作工具
   - 导出常量 `MIN_PANES` / `MAX_PANES`
   - 提供完整的 CRUD 操作函数

2. **简化 `src/store/panes.ts`**
   - Store 只负责状态管理和持久化
   - 具体操作委托给 `pane-utils.ts`
   - 保持原有接口不变（向后兼容）

**工具函数列表：**

| 类别 | 函数 | 说明 |
|------|------|------|
| **常量** | `MIN_PANES` / `MAX_PANES` | 0 / 2 |
| **创建** | `createDefaultPane()` | 创建默认 Pane |
| | `initializePanes()` | 初始化 Pane 列表 |
| **查询** | `findPaneById()` | 根据 ID 查找 |
| | `findPaneBySession()` | 根据会话查找 |
| | `canAddPane()` / `canRemovePane()` | 检查操作可行性 |
| **核心操作** | `addPane()` | 新增 Pane |
| | `removePane()` | 移除 Pane |
| | `splitPane()` | 拆分 Pane |
| | `mergePane()` | 合并 Pane |
| **修改** | `setPaneSession()` | 设置会话 |
| | `swapPaneSessions()` | 交换会话 |
| | `setPaneSize()` | 设置大小 |
| **焦点** | `focusPane()` | 切换焦点 |
| | `getNextFocusablePane()` | 获取下一个焦点 |

**使用示例：**

```typescript
// 直接调用工具函数（不经过 Store）
import { addPane, removePane, canAddPane, MAX_PANES } from "@/lib/pane-utils";

// 检查是否可以添加
if (canAddPane(currentPanes)) {
  const result = addPane(currentPanes, "session-123");
  if (result.success) {
    // result.panes - 新的 Pane 列表
    // result.focusedPaneId - 新 Pane 的 ID
  }
}
```

#### 图形化视图抽象子类 (2026-03-25)

**设计目标：**
RDP 和 VNC 都是图形化远程桌面协议，具有大量共同点：
- Canvas 渲染（RGBA/JPEG/PNG）
- 鼠标/键盘输入处理
- 指针位置计算
- 帧大小管理

**解决方案：**
创建 `BaseGraphicSessionView.tsx` 作为 `BaseSessionView` 的图形化抽象子类。

**继承层次：**
```
BaseSessionView (基础抽象类)
    │
    ├── TerminalViewClass (终端视图 - 文本模式)
    │
    └── BaseGraphicSessionView (图形化抽象子类)
            │
            ├── RemoteDesktopViewClass (RDP 视图)
            └── VncViewClass (VNC 视图)
```

**提供的功能：**

| 功能 | 说明 |
|------|------|
| `useBaseGraphicSessionView` | Hook，提供 Canvas/容器引用、帧渲染工具 |
| `renderRgbaFrame` | 渲染 RGBA 帧到 Canvas |
| `renderBlobFrame` | 渲染 Blob 帧（JPEG/PNG）到 Canvas |
| `getPointerPositionCentered` | 居中缩放模式的指针位置计算 |
| `getPointerPositionScaled` | 填充模式的指针位置计算 |
| `RDP_SCANCODE_MAP` | RDP 扫描码映射表 |
| `VNC_KEYSYM_MAP` | VNC Keysym 映射表 |
| `getRdpScancode` | 获取 RDP 扫描码 |
| `mapVncKeyboardEvent` | 映射 VNC 键盘事件 |
| `buildCursorStyleFromRgba` | 从 RGBA 数据构建光标样式 |

**收益：**
- RDP 和 VNC 的 Canvas 渲染逻辑统一
- 指针位置计算算法复用
- 键盘映射表集中管理
- 新增图形协议时可直接继承图形化抽象子类

#### 代码冗余优化 (2026-03-25 后续)

对重构后的代码进行冗余检查并优化：

**发现的冗余：**
| 问题 | 位置 | 解决方案 |
|------|------|----------|
| 重复的 `clamp` 函数 | `RemoteDesktopViewClass.tsx`, `VncViewClass.tsx` | 提取到 `BaseSessionView.tsx` 并统一导出 |
| 未使用的图标导入 | `MousePointer2`, `RefreshCcw` | 删除未使用的导入 |
| 重复的容器样式类名 | 三个视图的 `main` 容器 | 提取常量 `VIEW_CONTAINER_CLASSNAME` |
| 重复的 Canvas 样式 | RDP 和 VNC 的 `canvas` 元素 | 提取常量 `CANVAS_CLASSNAME`, `HIDDEN_CLASSNAME` |
| 重复的交互容器样式 | RDP 和 VNC 的交互层 | 提取常量 `INTERACTIVE_CONTAINER_CLASSNAME` |

**分屏状态不持久化设计决策：**

| 特性 | 持久化 | 不持久化 |
|------|--------|----------|
| 会话列表 | ✓ | 保留用户连接的会话 |
| SSH 配置 | ✓ | 保留用户保存的连接配置 |
| 设置偏好 | ✓ | 保留用户界面设置 |
| **分屏布局** | ✗ | **每次打开应用重置** |

**理由：**
1. 分屏是"本次工作"的布局选择，而非用户长期偏好
2. 不同使用场景需要不同布局（单屏调试 vs 双屏对比）
3. 避免重新打开应用时继承上一次可能不合适的分屏状态
4. 简化状态管理，减少潜在 bug

**新建标签页适配 Pane 系统：**

修改所有新建标签页的操作，使其适配 pane 和新的后端渲染流程：

1. **修改 `addSession` 返回类型**：从 `void` 改为 `string`（返回 session ID）

2. **修改 `TabBar.tsx`**：`handleAddTab` 创建 session 后自动关联到当前 pane

3. **修改 `SessionModule.tsx`**：
   - `handleAction`（连接 SSH/RDP/VNC）创建 session 后自动处理 pane
   - `handleDirectConnect`（本地 shell）创建 session 后自动处理 pane
   - `handleDirectRdpConnect` 创建 session 后自动处理 pane
   - `handleDirectVncConnect` 创建 session 后自动处理 pane
   - `SshConnectDialog` 直接连接回调处理 pane 关联

4. **修改 `App.tsx`**：添加同步 effect，当焦点会话没有对应 pane 时自动创建

** pane 关联逻辑：**
```typescript
if (sessionId) {
  if (focusedPaneId) {
    // 有焦点 pane，直接关联
    setPaneSession(focusedPaneId, sessionId);
  } else if (panes.length === 0) {
    // 没有 pane，创建新 pane 并关联
    addPane(sessionId);
  }
}
```

**新增导出：**
```typescript
// BaseSessionView.tsx
export const VIEW_CONTAINER_CLASSNAME = "terminal-container relative z-0...";
export const CANVAS_CLASSNAME = "max-h-full max-w-full select-none object-contain";
export const HIDDEN_CLASSNAME = "hidden";
export const INTERACTIVE_CONTAINER_CLASSNAME = "relative flex h-full...";
export function clamp(value: number, min: number, max: number): number;
```

#### 设计优势
1. **代码复用**：通用状态管理、连接状态处理逻辑集中在基类 Hook
2. **结构统一**：所有视图遵循相同的渲染流程和样式常量
3. **易于扩展**：添加新视图类型只需实现抽象方法并复用样式常量
4. **类型安全**：TypeScript 确保子类实现完整性
5. **维护便捷**：样式统一在基类管理，修改一处全局生效

### 6.5 Bug 修复记录

| 日期 | 问题描述 | 修复方案 |
| :--- | :--- | :--- |
| 2026-03-24 | 连续连接两个SSH后自动进入分屏模式 | 修改 `addSession`：新会话替换焦点位置而非追加到 `activeSessionIds` |
| 2026-03-24 | 分屏显示为窄竖线，未对半开 | 修改 `TerminalView.tsx`：分屏面板使用 `w-1/2` 明确宽度分配，添加 `flex-shrink-0` 防止收缩 |
| 2026-03-24 | 点击非活动标签无法切换显示内容 | 修改 `TabBar.tsx`：`handleTabSwitch` 在点击非活动标签时调用 `replaceSplitPane` |






