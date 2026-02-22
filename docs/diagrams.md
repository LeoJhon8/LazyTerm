# Lazy Terminal 流程图和时序图

本文档包含 Lazy Terminal 应用的完整流程图和时序图，从 应用启动到用户交互的完整生命周期。

---

## 1. 主启动流程图

描述从 Electron 应用启动到第一个可交互终端就绪的完整初始化流程。

```mermaid
flowchart TD
    Start([启动 Electron 应用]) --> AppReady[app.whenReady]

    subgraph MainProcess["Electron 主进程"]
        AppReady --> CreateWindow[创建 BrowserWindow]
        CreateWindow --> SetPreferences[设置 webPreferences<br/>• preload.js<br/>• contextIsolation: true<br/>• nodeIntegration: false]
        SetPreferences --> SetMainWindow[setMainWindow]
        SetMainWindow --> LoadHTML[加载 renderer/index.html]
        LoadHTML --> RegisterIPC[注册 IPC 处理器<br/>• execute-command<br/>• pty-create<br/>• pty-write<br/>• pty-resize<br/>• pty-close<br/>• 等6个通道]
        RegisterIPC --> IPCReady[IPC 系统就绪]
    end

    IPCReady --> HTMLLoaded[index.html 加载完成]

    subgraph RendererProcess["Renderer 进程"]
        HTMLLoaded --> LoadBundle[加载 terminal-main.js<br/>ES6 模块]
        LoadBundle --> DOMContentLoaded[DOMContentLoaded 事件]
        DOMContentLoaded --> NewTerminalMain[new TerminalMain<br/>调用 TabsUI 构造函数]
        NewTerminalMain --> InitUI[UI 模块初始化]

        InitUI --> TabsInit[TabsUI.init<br/>设置 newTabBtn 监听器]
        TabsInit --> PTYListeners[initPTYListeners<br/>注册 onPtyData/Exit/Error]
        PTYListeners --> FontControls[initFontSizeControls<br/>设置字体控制]
        FontControls --> SessionUI[SessionUI.init<br/>设置会话管理]
        SessionUI --> HistoryUI[HistoryUI.init<br/>加载历史命令]
        HistoryUI --> QuickCmdUI[QuickCmdUI.init<br/>快捷命令栏]
        QuickCmdUI --> GlobalEvents[setupGlobalEventListeners]
        GlobalEvents --> ExposeWindow[暴露 window.app API]
        ExposeWindow --> CreateFirstTab[app.createNewTab<br/>创建第一个标签页]

        CreateFirstTab --> AsyncImport[动态导入 xtermWrapper]
        AsyncImport --> CreateXterm[创建 XtermWrapper 实例]
        CreateXterm --> PTYCreate[ptyUI.createSession]
        PTYCreate --> IPCInvoke[window.electronAPI.ptyCreate]
    end

    IPCInvoke --> MainProcessCreate[主进程 'pty-create' 处理]
    MainProcessCreate --> CreatePTY[createPTYSession<br/>或 createSSHSession]
    CreatePTY --> ReturnSessionId[返回 sessionId]
    ReturnSessionId --> UpdateTab[更新 TabData<br/>设置 xtermWrapper]
    UpdateTab --> RenderTab[渲染 Tab DOM 元素]
    RenderTab --> Complete([初始化完成<br/>可交互的终端])

    style Start fill:#e1f5e1
    style Complete fill:#e1f5e1
    style MainProcess fill:#e3f2fd
    style RendererProcess fill:#fff3e0
```

---

## 2. 时序图

展示主进程、预加载脚本、渲染进程和各个 UI 模块之间的时序交互。

```mermaid
sequenceDiagram
    autonumber

    participant User as 用户
    participant Main as Electron 主进程<br/>(index.ts)
    participant Preload as Preload 脚本<br/>(preload.ts)
    participant Renderer as Renderer 进程<br/>(terminal-main.ts)
    participant TabsUI as TabsUI
    participant PTYUI as PTYUI
    participant PTYService as PTY Service
    participant Xterm as XtermWrapper

    rect rgb(232, 245, 233)
        Note over User,Main: 应用启动阶段
        User->>Main: 启动应用
        Main->>Main: app.whenReady()
        Main->>Main: createWindow()
        Main-->>Renderer: 加载 index.html
        Renderer-->>Preload: 执行 preload.js
        Preload->>Preload: contextBridge.exposeInMainWorld<br/>(electronAPI)
    end

    rect rgb(227, 242, 253)
        Note over Renderer,TabsUI: 初始化阶段
        Renderer->>Renderer: DOMContentLoaded 事件
        Renderer->>Renderer: new TerminalMain()
        Renderer->>TabsUI: super.init()
        TabsUI->>TabsUI: initListeners()<br/>绑定 newTabBtn 点击事件
        Renderer->>Renderer: initPTYListeners()<br/>注册 IPC 事件监听
        Renderer->>PTYUI: sessionUI.init()<br/>historyUI.init()<br/>quickCmdUI.init()
        Renderer->>Renderer: 创建第一个 Tab<br/>app.createNewTab()
    end

    rect rgb(255, 243, 224)
        Note over User,Xterm: 用户交互 - 创建新标签页
        User->>TabsUI: 点击 "+" 按钮
        TabsUI->>TabsUI: createNewTab()
        TabsUI->>Renderer: 创建动态导入 xtermWrapper
        Renderer->>Renderer: new XtermWrapper(container)
        Xterm-->>Renderer: xterm 实例创建
        Renderer->>PTYUI: 创建 PTY 会话<br/>ptyUI.createSession('local')
        PTYUI->>Preload: window.electronAPI.ptyCreate('local', params)
        Preload->>Main: ipcRenderer.invoke('pty-create', 'local')
        Main->>Main: ipcMain.handle('pty-create')
        Main->>PTYService: createPTYSession(params)
        PTYService->>PTYService: node-pty.spawn shell
        PTYService-->>Main: 返回 sessionId
        Main-->>Preload: { success, sessionId }
        Preload-->>PTYUI: 返回 sessionId
        PTYUI-->>Renderer: 返回 sessionId
        Renderer->>TabsUI: updateTabSession(tabId, sessionId, xtermWrapper)
        TabsUI->>TabsUI: render()<br/>渲染 Tab
    end

    rect rgb(252, 232, 243)
        Note over Main,Xterm: PTY 数据流动
        PTYService->>Main: PTY 输出数据<br/>session.on('data')
        Main->>Preload: webContents.send('pty-data', {sessionId, data})
        Preload->>Renderer: ipcRenderer.on('pty-data')
        Renderer->>PTYUI: onPtyData(event, {sessionId, data})
        PTYUI->>Xterm: 根据 sessionId 查找 wrapper
        Xterm->>Xterm: wrapper.write(data)
        Xterm-->>User: 终端显示输出
    end

    rect rgb(243, 229, 245)
        Note over User,Xterm: 用户输入命令
        User->>Xterm: 键盘输入
        Xterm->>Preload: window.electronAPI.ptyWrite(sessionId, data)
        Preload->>Main: ipcRenderer.invoke('pty-write', sessionId, data)
        Main->>PTYService: getPTYSession(id)?.write(data)
        PTYService->>PTYService: 写入 PTY stdin
    end
```

---

## 3. 用户交互流程图

详细展示四个主要用户交互场景。

### 3.1 SSH 连接流程

```mermaid
flowchart TD
    subgraph "用户交互 - SSH 连接"
        SSHStart([用户打开 SSH 连接模态框]) --> SSHInput[填写连接参数<br/>host, port, user, auth]
        SSHInput --> TestConn[点击 "测试连接"]
        TestConn --> IPCTest[electronAPI.testConnection]
        IPCTest --> MainTest[主进程 test-connection]
        MainTest --> SSHConnect[ssh2 Client.connect]
        SSHConnect --> ConnResult{连接结果}
        ConnResult -->|成功| ShowSuccess[显示 "连接成功"]
        ConnResult -->|失败| ShowError[显示错误信息]
        ShowSuccess --> SaveSSHB[保存会话配置]
        ShowError --> SSHRetry[调整参数重试]
        SaveSSHB --> NewSSH[在新建 Tab 中打开 SSH 会话]
        NewSSH --> SSHPTYCreate[ptyUI.createSession 'ssh']
        SSHPTYCreate --> SSHMainCreate[主进程 createSSHSession]
        SSHMainCreate --> SSHStream[建立 SSH Stream]
        SSHStream --> SSHReady([SSH 终端就绪])
    end

    style SSHStart fill:#ffe0b2
    style SSHReady fill:#e1f5e1
```

### 3.2 快捷命令执行流程

```mermaid
flowchart TD
    subgraph "用户交互 - 快捷命令"
        QCStart([用户查看快捷命令栏]) --> QCClick[点击快捷命令项]
        QCClick --> QCMulti[executeMultiLineCommand]
        QCMulti --> SplitLines[按行分割命令]
        SplitLines --> ForEach[遍历命令行]
        ForEach --> QCWrite[ptyWrite 输入命令]
        QCWrite --> QCHistory[addCommandToHistory<br/>添加到历史记录]
        QCWrite --> QCResponse[PTY 返回结果]
        QCResponse --> QCNext{下一行?}
        QCNext -->|是| ForEach
        QCNext -->|否| QCDone([命令执行完成])
    end

    style QCStart fill:#b2dfdb
    style QCDone fill:#e1f5e1
```

### 3.3 Tab 切换流程

```mermaid
flowchart TD
    subgraph "用户交互 - Tab 切换"
        TabSwitchStart([用户点击 Tab]) --> TabSwitch[switchTab tabId]
        TabSwitch --> CheckActive{是否为当前Tab?}
        CheckActive -->|是| TabDone[无操作]
        CheckActive -->|否| SaveCurrent[保存当前Tab<br/>保存 scrollTop]
        SaveCurrent --> UpdateActive[activeTabId = 新ID]
        UpdateActive --> TabRender[render 刷新 UI]
        TabRender --> LoadActive[loadActiveTab]
        LoadActive --> FocusXterm[xtermWrapper.focus]
        FocusXterm --> TabDone
    end

    style TabSwitchStart fill:#d1c4e9
```

### 3.4 命令历史查看流程

```mermaid
flowchart TD
    subgraph "用户交互 - 命令历史"
        HistoryStart([用户点击历史打开按钮]) --> HistoryToggle[historyUI.toggle]
        HistoryToggle --> HistoryList[renderHistoryList<br/>渲染历史列表]
        HistoryList --> ClickHistory[点击历史项]
        ClickHistory --> GetCommand[获取命令文本]
        GetCommand --> WriteCommand[ptyWrite 写入 PTY]
        WriteCommand --> HistoryEnd([命令执行])
    end

    style HistoryStart fill:#f8bbd0
    style HistoryEnd fill:#e1f5e1
```

---

## 4. 架构概览

### 4.1 IPC 通信通道

```mermaid
flowchart LR
    subgraph MainProcess["主进程 IPC Handlers"]
        M1[execute-command]
        M2[test-connection]
        M3[pty-create]
        M4[pty-write]
        M5[pty-resize]
        M6[pty-close]
        M7[pty-set-tab]
        M8[pty-get-active-session]
    end

    subgraph IPCBridge["IPC 桥接 (preload.ts)"]
        B1[contextBridge]
        B2[electronAPI]
    end

    subgraph RendererProcess["Renderer API"]
        R1[executeCommand]
        R2[testConnection]
        R3[ptyCreate]
        R4[ptyWrite]
        R5[ptyResize]
        R6[ptyClose]
        R7[onPtyData]
        R8[onPtyExit]
        R9[onPtyError]
    end

    M1 -.-> B1
    M2 -.-> B1
    M3 -.-> B1
    M4 -.-> B1
    M5 -.-> B1
    M6 -.-> B1
    M7 -.-> B1
    M8 -.-> B1

    B1 --> B2
    B2 -.-> R1
    B2 -.-> R2
    B2 -.-> R3
    B2 -.-> R4
    B2 -.-> R5
    B2 -.-> R6
    R7 -.-> B1
    R8 -.-> B1
    R9 -.-> B1

    style MainProcess fill:#e3f2fd
    style IPCBridge fill:#fff3e0
    style RendererProcess fill:#f1f8e9
```

---

## 图表说明

### 主要流程图

**启动流程**：描述从 Electron 应用启动到第一个可交互终端就绪的完整初始化流程
- **主进程**：创建 BrowserWindow、配置 preload、注册 IPC 处理器
- **Renderer 进程**：加载模块、初始化 UI、创建第一个 Tab
- **PTY 创建**：通过 IPC 通信创建 PTY 会话并建立 Xterm 终端

### 时序图

展示主进程、预加载脚本、渲染进程和各个 UI 模块之间的时序交互

主要交互流程：
1. **启动阶段**：Electron 启动、preload 注入 API
2. **初始化阶段**：HTML 加载、DOM 事件、UI 模块初始化
3. **用户交互**：创建新标签页的完整流程
4. **PTY 数据流**：从 PTY Service 到 Xterm 的数据传输
5. **用户输入**：键盘输入到 PTY 的写入流程

### 用户交互子流程图

详细展示四个主要用户交互场景：
- **SSH 连接**：模态框 → 测试连接 → 保存 → 创建会话
- **快捷命令**：多行命令执行 → 历史记录
- **Tab 切换**：保存状态 → 切换 → 聚焦
- **命令历史**：查看历史 → 点击执行

---

## 技术语境

这些图表基于以下关键文件的深入分析：

### 主进程文件
- `src/main/index.ts` - Electron 主进程入口，负责窗口管理和 IPC 处理
- `src/main/preload.ts` - 预加载脚本，通过 contextBridge 暴露安全的 API

### Renderer 文件
- `src/renderer/index.html` - HTML 入口，加载应用
- `src/renderer/ui/terminal-main.ts` - 主控制器，协调所有 UI 模块
- `src/renderer/ui/tabs-ui.ts` - 标签页管理
- `src/renderer/ui/pty-ui.ts` - PTY 会话管理
- `src/renderer/ui/session-ui.ts` - SSH/会话管理
- `src/renderer/ui/history-ui.ts` - 命令历史管理
- `src/renderer/ui/quickcmd-ui.ts` - 快捷命令管理
- `src/renderer/ui/logger.ts` - 日志工具

### 核心依赖
- **Electron** - 桌面应用框架
- **node-pty** - 本地 PTY 模拟
- **ssh2** - SSH 连接库
- **xterm.js** - 终端模拟器

---

**生成日期**：2026-02-22
**应用名称**：Lazy Terminal
**版本**：1.0.0
