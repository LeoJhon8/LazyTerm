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

### 6.4 Bug 修复记录

| 日期 | 问题描述 | 修复方案 |
| :--- | :--- | :--- |
| 2026-03-24 | 连续连接两个SSH后自动进入分屏模式 | 修改 `addSession`：新会话替换焦点位置而非追加到 `activeSessionIds` |
| 2026-03-24 | 分屏显示为窄竖线，未对半开 | 修改 `TerminalView.tsx`：分屏面板使用 `w-1/2` 明确宽度分配，添加 `flex-shrink-0` 防止收缩 |
| 2026-03-24 | 点击非活动标签无法切换显示内容 | 修改 `TabBar.tsx`：`handleTabSwitch` 在点击非活动标签时调用 `replaceSplitPane` |






