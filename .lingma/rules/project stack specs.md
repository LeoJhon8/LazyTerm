---
trigger: always_on

---

# 🚀 现代桌面终端应用技术栈文档 (Project Stack Specs)

## 1. 项目概览 (Project Overview)
*   **定位**：跨平台、高性能、可高度定制化的现代开发工具。
*   **核心特性**：GPU 加速渲染、多标签/分屏管理、插件化架构、轻量级资源占用。

---

## 2. 核心基础设施 (Core Infrastructure)

| 技术 | 版本 | 描述 |
| :--- | :--- | :--- |
| **Vite** | 6.x | 极速构建工具，支持模块热更新（HMR）。 |
| **React** | 19.x | 使用 React 19 的编译优化、Actions API 和增强的并发渲染模式。 |
| **TypeScript** | 5.x | 全栈类型安全，减少运行时错误。 |
| **Tauri** | 2.x | 桌面宿主框架。后端基于 **Rust**，相比 Electron 内存占用降低 90%，包体积缩小 95%。 |

---

## 3. UI 与交互层 (UI & UX Layer)

### 样式与组件
*   **Tailwind CSS**: 采用原子化 CSS，确保样式高度可复用且包体积极小。
*   **Shadcn/ui**: 基于 Radix UI 的组件库。特点是 **代码所有权归你**（直接拷贝源码到项目），方便对终端复杂的右键菜单、对话框进行深度定制。
*   **Lucide React**: 现代图标库，与 Shadcn 完美契合。
*   **Framer Motion**: 处理终端窗口切换、面板展开等流畅的物理动画。

### 终端渲染核心 (Terminal Engine)
*   **xterm.js**: 工业级终端渲染引擎（VS Code 同款）。
*   **xterm-addon-webgl**: 必须开启，利用 GPU 渲染字符，确保在处理海量日志输出时不掉帧。
*   **xterm-addon-fit**: 自动适配窗口大小缩放。

---

## 4. 状态与数据流 (State & Data Management)

*   **Zustand**:
    *   **用途**：管理全局 UI 状态（当前选中的标签页、主题配置、字体大小、分屏布局）。
    *   **优势**：轻量级，支持持久化中间件（可以直接将配置自动存入本地 JSON）。
*   **TanStack Query (React Query) v5**:
    *   **用途**：管理异步数据（如远程服务器列表、SSH 配置文件读取、插件市场列表获取）。
    *   **优势**：强大的缓存机制和自动重试功能。

---

## 5. 后端与系统交互 (Backend & System Bridge)

由于是应用而非网页，需通过 Tauri 的 **Rust 后端** 处理底层逻辑：
*   **PTY 交互**：使用 Rust 的 `portable-pty` 或 `tokio-process` 库来创建和管理真正的 Shell 进程（bash/zsh/powershell）。
*   **文件系统**：通过 Tauri 的 `fs` 插件读写配置文件，避开浏览器的沙盒限制。
*   **系统通知**：调用原生的桌面通知系统。

---

## 6. 推荐项目结构 (Directory Structure)

```text
├── src-tauri/              # Rust 后端代码 (底层 PTY 逻辑、系统交互)
│   ├── src/main.rs         # 程序的入口与指令注册
│   └── Cargo.toml          # Rust 依赖管理
├── src/                    # 前端代码 (UI 渲染)
│   ├── components/         # Shadcn UI 组件
│   │   ├── ui/             # 基础原子组件
│   │   └── terminal/       # 封装的 xterm 逻辑组件
│   ├── hooks/              # 自定义钩子 (useTerminal, useConfig)
│   ├── store/              # Zustand 状态仓库 (tabs, settings)
│   ├── services/           # TanStack Query 异步逻辑
│   ├── App.tsx             # 路由与布局
│   └── main.tsx            # 入口文件
├── tailwind.config.js      # Tailwind 配置
└── package.json            # Node.js 依赖管理
```

---

## 7. 必备 VS Code 插件清单

| 插件名称 | 作用 |
| :--- | :--- |
| **Tauri** | 提供 Rust 后端与前端的关联调试支持。 |
| **rust-analyzer** | 编写 Tauri 后端时的 Rust 代码补全与类型检查。 |
| **Tailwind CSS IntelliSense** | 类名自动补全、实时预览。 |
| **ESLint / Prettier** | 保持 React 19 代码规范。 |
| **Console Ninja** | 在编辑器内直接显示终端进程的调试输出。 |
| **Error Lens** | TS/Rust 报错直接显示在行尾。 |
| **shadcn/ui** | 快速在项目中添加/更新组件。 |

---

## 8. 开发路线图建议 (Roadmap)

1.  **第一阶段**：搭建 Vite + Tauri + React 19 环境，跑通一个简单的 "Hello World" 桌面窗口。
2.  **第二阶段**：集成 `xterm.js`，通过 Tauri 的 `command` 让前端 React 能给 Rust 后端发指令。
3.  **第三阶段**：在 Rust 中实现 PTY 转发，实现真正的 Shell 交互。
4.  **第四阶段**：使用 **Shadcn/ui** 开发多标签页系统，用 **Zustand** 管理标签状态。
5.  **第五阶段**：配置 **Tailwind** 主题切换，实现透明毛玻璃窗口效果（Tauri v2 特性）。

---

## 9. 为什么选择这套组合？
*   **性能**：Tauri + Rust + WebGL 保证了作为工具软件的响应速度。
*   **效率**：React 19 + Shadcn 让你可以快速构建极其美观的界面。
*   **维护性**：Zustand 和 TypeScript 确保了随着功能增加，代码逻辑依然清晰可控。