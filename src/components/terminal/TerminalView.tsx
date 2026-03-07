import { useEffect, useRef } from "react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { useHistoryStore } from "@/store/history";
import type { ITerminalConnector } from "@/types/terminal";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import "@xterm/xterm/css/xterm.css";

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  resizeObserver: ResizeObserver;
  connector?: ITerminalConnector; // 当前绑定的连接器
  isConnectorBound: boolean; // 标记是否已绑定 connector 输出
  savedBuffer: string; // 保存的终端缓冲区内容
  inputDisposable?: { dispose(): void }; // 输入监听解绑函数
  dispose: () => void;
}

export function TerminalView() {
  const { activeSessionId, sessions } = useTabsStore();
  const { addCommand: addHistoryCommand } = useHistoryStore();
  const { fontSize, fontFamily, theme, setSettings } = useSettingsStore();

  const containerMap = useRef(new Map<string, HTMLDivElement>());
  const terminalMap = useRef(new Map<string, TerminalInstance>());
  const lastCommandRef = useRef<string>("");

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // --- 逻辑 1：初始化终端实例 ---
  useEffect(() => {
    if (!activeSessionId || !activeSession || !activeSession.connector) return;
    
    const { connector } = activeSession;
    const containerEl = containerMap.current.get(activeSessionId);
    if (!containerEl) return;

    let isMounted = true;

    const initTerminal = async () => {
      // 等待连接器就绪
      while (!connector.isConnected && isMounted) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!isMounted || !connector.isConnected) return;

      // 检查是否已存在终端实例（复用 Terminal，不清空内容）
      const existingInstance = terminalMap.current.get(activeSessionId);
      
      if (existingInstance) {
        // Terminal 已存在，只需要切换 connector 的数据绑定
        console.log(`[TerminalView] Switching connector for session ${activeSessionId}, preserving terminal content...`);
        
        // 1. 保存当前终端内容
        const buffer = existingInstance.terminal.buffer.active;
        let savedContent = '';
        for (let i = 0; i < buffer.length; i++) {
          const line = buffer.getLine(i);
          if (line) {
            savedContent += line.translateToString(true) + '\n';
          }
        }
        existingInstance.savedBuffer = savedContent;
        console.log(`[TerminalView] Saved buffer content: ${savedContent.length} chars`);
        
        // 2. 断开旧的输入监听
        if (existingInstance.inputDisposable) {
          existingInstance.inputDisposable.dispose();
        }
        
        // 3. 标记旧的 connector 为未绑定（停止接收数据）
        existingInstance.isConnectorBound = false;
        
        // 4. 更新 connector 引用
        existingInstance.connector = connector;
        existingInstance.isConnectorBound = true;
        
        // 5. 重新绑定输出
        const boundConnector = connector;
        await boundConnector.onData((data) => {
          if (existingInstance.isConnectorBound && existingInstance.connector === boundConnector) {
            existingInstance.terminal.write(data);
          }
        });
        
        // 6. 重新绑定输入（关键修复！）
        const termRef = existingInstance.terminal;
        const newInputDisposable = termRef.onData((data) => {
          console.log(`[TerminalView] Input data after switch:`, data.substring(0, 50));
          connector.write(data);
        });
        existingInstance.inputDisposable = newInputDisposable;
        console.log(`[TerminalView] Input listener rebound to new connector`);
        
        // 7. 恢复终端内容（如果有）
        if (savedContent) {
          console.log(`[TerminalView] Restoring buffer content...`);
          existingInstance.terminal.clear();
          existingInstance.terminal.write(savedContent);
        }
        
        // 8. 确保焦点
        requestAnimationFrame(() => {
          existingInstance.terminal.focus();
        });
        
        console.log(`[TerminalView] Connector switched successfully!`);
        return; // 直接返回，不重新创建 Terminal
      }

      // --- 首次创建 Terminal ---
      const term = new Terminal({
        fontFamily: fontFamily,
        fontSize: fontSize,
        theme: {
          background: theme === "light" ? "#ffffff" : "#1e1e1e",
          foreground: theme === "light" ? "#333333" : "#cccccc",
          cursor: theme === "light" ? "#007acc" : "#528bff",
          cursorAccent: theme === "light" ? "#ffffff" : "#1e1e1e",
          selectionBackground: "rgba(82, 139, 255, 0.4)",
        },
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 10000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      try {
        term.loadAddon(new WebglAddon());
      } catch (e) {
        console.warn("WebGL Addon failed", e);
      }

      term.open(containerEl);

      // --- 核心修复：强制拦截滚轮事件 ---
      const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
          // 1. 阻止浏览器默认行为（如缩放页面）
          e.preventDefault(); 
          // 2. 停止事件冒泡，防止触发父级滚动
          e.stopPropagation();
          // 3. 关键：停止立即传播，防止 xterm 内部逻辑收到此滚轮事件进行滚动
          e.stopImmediatePropagation();

          const currentSize = useSettingsStore.getState().fontSize;
          const delta = e.deltaY > 0 ? -1 : 1;
          const newSize = Math.max(6, Math.min(100, currentSize + delta));
          
          setSettings({ fontSize: newSize });
        }
      };

      // 使用 capture: true 在捕获阶段拦截，并在 xterm 处理之前将其切断
      containerEl.addEventListener("wheel", handleWheel, { 
        passive: false, 
        capture: true 
      });

      const dataDisposable = term.onData((data) => {
        console.log(`[TerminalView] Initial input data:`, data.substring(0, 50));
        connector.write(data);
      });
            
      const keyDisposable = term.onKey(({ domEvent }) => {
        if (domEvent.key === "Enter") {
          const buffer = term.buffer.active;
          const line = buffer.getLine(buffer.cursorY + buffer.baseY);
          if (line) {
            let text = line.translateToString(true).trimEnd();
            const lastPrompt = Math.max(text.lastIndexOf("$"), text.lastIndexOf("#"));
            if (lastPrompt !== -1) text = text.slice(lastPrompt + 1).trim();
            if (text && text !== lastCommandRef.current) {
              addHistoryCommand(text);
              lastCommandRef.current = text;
            }
          }
        }
      });

      // 绑定输出 (由 connector.close() 统一清理)
      const connectorDataUnlisten = await connector.onData((data) => {
        term.write(data);
      });

      const selectionDisposable = term.onSelectionChange(async () => {
        if (term.hasSelection()) {
          const selection = term.getSelection();
          if (selection) {
            try { await writeText(selection); } catch (e) { console.error(e); }
          }
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        if (containerEl.clientWidth > 0 && containerEl.clientHeight > 0) {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) connector.resize(dims.cols, dims.rows);
        }
      });
      resizeObserver.observe(containerEl);

      terminalMap.current.set(activeSessionId, {
        terminal: term,
        fitAddon,
        resizeObserver,
        connector,
        isConnectorBound: true,
        savedBuffer: '',
        inputDisposable: dataDisposable,
        dispose: () => {
          containerEl.removeEventListener("wheel", handleWheel, { capture: true });
          dataDisposable.dispose();
          keyDisposable.dispose();
          selectionDisposable.dispose();
          resizeObserver.disconnect();
          term.dispose();
        },
      });

      requestAnimationFrame(() => {
        fitAddon.fit();
        term.focus();
      });
    };

    initTerminal();
    return () => { isMounted = false; };
  }, [activeSessionId, activeSession?.connector, addHistoryCommand, setSettings]);

  // --- 逻辑 2：响应设置实时变化 (热更新) ---
  useEffect(() => {
    terminalMap.current.forEach((instance, id) => {
      const { terminal, fitAddon } = instance;
      
      if (terminal.options.fontSize !== fontSize) terminal.options.fontSize = fontSize;
      if (terminal.options.fontFamily !== fontFamily) terminal.options.fontFamily = fontFamily;
      
      terminal.options.theme = {
        background: theme === "light" ? "#ffffff" : "#1e1e1e",
        foreground: theme === "light" ? "#333333" : "#cccccc",
        cursor: theme === "light" ? "#007acc" : "#528bff",
        cursorAccent: theme === "light" ? "#ffffff" : "#1e1e1e",
        selectionBackground: "rgba(82, 139, 255, 0.4)",
      };

      requestAnimationFrame(() => {
        fitAddon.fit();
        if (id === activeSessionId) {
          const dims = fitAddon.proposeDimensions();
          if (dims && activeSession?.connector) {
            activeSession.connector.resize(dims.cols, dims.rows);
          }
        }
      });
    });
  }, [fontSize, fontFamily, theme, activeSessionId, activeSession?.connector]);

  // --- 逻辑 3：清理会话 ---
  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));
    terminalMap.current.forEach((instance, id) => {
      if (!currentIds.has(id)) {
        instance.dispose();
        terminalMap.current.delete(id);
      }
    });
  }, [sessions]);

  // --- 逻辑 4：Tab 切换聚焦 ---
  useEffect(() => {
    if (!activeSessionId) return;
    const instance = terminalMap.current.get(activeSessionId);
    if (instance) {
      requestAnimationFrame(() => {
        instance.fitAddon.fit();
        instance.terminal.focus();
      });
    }
  }, [activeSessionId]);

  // --- 逻辑 5：窗口 Resize ---
  useEffect(() => {
    const handleGlobalResize = () => {
      if (!activeSessionId) return;
      terminalMap.current.get(activeSessionId)?.fitAddon.fit();
    };
    window.addEventListener("resize", handleGlobalResize);
    return () => window.removeEventListener("resize", handleGlobalResize);
  }, [activeSessionId]);

  // --- 逻辑 6：右键粘贴 ---
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!activeSessionId || !activeSession?.connector) return;
    const instance = terminalMap.current.get(activeSessionId);
    if (!instance) return;

    if (instance.terminal.hasSelection()) {
      instance.terminal.clearSelection();
    } else {
      try {
        const text = await readText();
        if (text) activeSession.connector.write(text);
      } catch (err) {
        console.error("Native paste failed", err);
      }
    }
  };

  if (sessions.length === 0 || !activeSession) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-6xl mb-4">💻</div>
          <h2 className="text-xl font-semibold mb-2">欢迎使用 Lazy Terminal</h2>
          <p className="text-muted-foreground">从左侧会话管理创建您的第一个终端会话</p>
        </div>
      </div>
    );
  }

  return (
    <main
      className="relative h-full w-full overflow-hidden"
      style={{
        gridArea: "mid-main",
        backgroundColor: theme === "light" ? "#ffffff" : "#1e1e1e",
      }}
      onClick={() => {
        if (activeSessionId) {
          terminalMap.current.get(activeSessionId)?.terminal.focus();
        }
      }}
      onContextMenu={handleContextMenu}
    >
      {sessions.map((s) => (
        <div
          key={s.id}
          ref={(el) => { if (el) containerMap.current.set(s.id, el); }}
          className={s.id === activeSessionId ? "h-full w-full absolute inset-0 px-2" : "hidden"}
        />
      ))}
    </main>
  );
}