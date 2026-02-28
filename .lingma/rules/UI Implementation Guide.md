---
trigger: always_on
---

# Part 2: UI 界面构建逻辑 (AI Implementation Guide)

**请将以下逻辑输入给 AI，作为初始化 UI 框架的指令：**

### 1. 扁平化 DOM 结构要求
严禁使用深层嵌套的容器。HTML 结构必须保持以下 5 个顶级插槽（Slots）同级排列：
```html
<div id="lazy-terminal-root">
  <aside id="slot-left"></aside>      <!-- 多模块容器：会话/工具 -->
  <header id="slot-mid-top"></header> <!-- 单模块容器：Tab页 -->
  <main id="slot-mid-main"></main>    <!-- 核心区域：活动终端 -->
  <footer id="slot-mid-bottom"></footer> <!-- 单模块容器：快捷键 -->
  <aside id="slot-right"></aside>     <!-- 多模块容器：历史/扩展 -->
</div>
```

### 2. CSS Grid Area 布局逻辑
使用 CSS Grid 实现“三列三行”的视觉结构，配置如下：
*   **网格定义**：
    ```css
    #lazy-terminal-root {
      display: grid;
      grid-template-areas: 
        "left mid-top    right"
        "left mid-main   right"
        "left mid-bottom right";
      grid-template-columns: var(--lw) 1fr var(--rw);
      grid-template-rows: var(--th) 1fr var(--bh);
      height: 100vh;
    }
    ```
*   **区域跨度**：`#slot-left` 和 `#slot-right` 必须设置 `grid-row: 1 / 4`，以占据全高。
*   **动态尺寸**：当插槽收起时，对应的 CSS 变量（`--lw`, `--rw`, `--th`, `--bh`）应平滑过渡至 `0px`。

### 3. 插槽功能逻辑 (Slot Logic)
*   **MidMain (核心)**：
    *   内部固定渲染 `TerminalEngine`（基于 xterm.js）。
    *   必须挂载 `ResizeObserver`，在任何插槽变动导致尺寸变化时自动调用 `fit()`。
*   **MidTop / MidBottom (单模块)**：
    *   通过 `moduleID` 映射，直接渲染一个功能模块组件（如 `TabBar` 或 `QuickCmdBar`）。
*   **Left / Right (多模块)**：
    *   **侧边导航条**：内部左侧（或右侧）保留 40px 宽的垂直图标栏。
    *   **模块切换**：点击图标，动态切换该插槽内显示的功能模块。

### 4. 模块化映射表 (Module Registry)
AI 需建立一个简单的映射机制：
*   `TabModule` -> 渲染标签页切换器。
*   `SessionModule` -> 渲染会话树状列表。
*   `HistoryModule` -> 渲染历史记录列表。
*   `QuickCmdModule` -> 渲染快捷命令按钮组。

### 5. 交互规范 (Interaction)
1.  **分界线**：在 Slots 之间插入 `PanelResizeHandle`（推荐使用 `react-resizable-panels` 的逻辑）。
2.  **收起按钮**：每个非核心插槽边缘必须存在一个极简的收起/展开触发器。
3.  **字体缩放**：在 `MidMain` 上监听 `wheel` 事件，若 `ctrlKey` 为真，则计算新字号并更新全局状态。

---