import { useEffect, useRef, useCallback } from "react";
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
  connector?: ITerminalConnector;
  inputDisposable?: { dispose(): void };
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

  // --- 逻辑 0：统一封装的终端激活与刷新机制 ---
  const activateTerminal = useCallback((sessionId?: string | null, requireFocus: boolean = true) => {
    if (!sessionId) return;
    const instance = terminalMap.current.get(sessionId);
    const container = containerMap.current.get(sessionId);

    if (instance && container) {
      requestAnimationFrame(() => {
        try {
          if (container.clientWidth > 0 && container.clientHeight > 0) {
            instance.fitAddon.fit();
            const dims = instance.fitAddon.proposeDimensions();
            if (dims && instance.connector) {
              // 关键修复：只有当行列数真正变化时才通知连接器调整大小
              // 防止仅字体大小变化时触发不必要的 resize 导致 shell 重新输出欢迎信息
              const currentCols = instance.terminal.cols;
              const currentRows = instance.terminal.rows;
              
              if (dims.cols !== currentCols || dims.rows !== currentRows) {
                instance.connector.resize(dims.cols, dims.rows);
              }
            }
          }
          if (requireFocus) {
            instance.terminal.focus();
          }
        } catch (error) {
          console.warn("[TerminalView] 激活/重载终端失败:", error);
        }
      });
    }
  }, []);

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

      const existingInstance = terminalMap.current.get(activeSessionId);
      
      if (existingInstance) {
        // 只是正常的 Tab 来回切换，直接返回
        if (existingInstance.connector === connector) {
          return;
        }

        // --- 核心逻辑：会话降级/重连，仅切换数据流，保留所有终端输出 ---
        console.log(`[TerminalView] 检测到连接器变更 ${activeSessionId}...`);

        // 1. 清理旧的输入监听器（防止 Xterm 按键发给旧连接）
        if (existingInstance.inputDisposable) {
          existingInstance.inputDisposable.dispose();
        }
        
        // 2. 更新为新的连接器
        existingInstance.connector = connector;
        
        // 3. 重新绑定新的输出流 (终极防清屏 + 防重叠策略)
        const connectionSwitchTime = Date.now();
        await connector.onData((data) => {
          // 在连接切换的最初 2 秒内，进行精准拦截
          if (Date.now() - connectionSwitchTime < 2000) {
            data = data
              // 1. 拦截彻底清屏 (2J) 和清空历史缓冲区 (3J)
              .replace(/\x1b\[[23]J/g, '')
              // 2. 拦截终端硬重置 (Reset)
              .replace(/\x1bc/g, '')
              // 3. 将“光标回到屏幕左上角”(H 或 1;1H) 替换为“回车符”(\r)
              // 这样本地 Shell 就会在黄色警告语的下一行立刻开始输出，而不是跳回屏幕顶部覆盖！
              .replace(/\x1b\[1?;?1?[Hf]/g, '\r');
              
              // 注意：这里绝不过滤 \x1b[K，保留终端原生清理当前行的能力，防止新旧字符重叠！
          }
          existingInstance.terminal.write(data);
        });

        // 4. 打印会话切换提示日志
        existingInstance.terminal.write('\r\n\x1b[33m ⚠️ Session connection changed. Output preserved. \x1b[0m\r\n');
        // 5. 重新绑定新的输入流
        existingInstance.inputDisposable = existingInstance.terminal.onData((data) => {
          connector.write(data);
        });
        
        // 6. 激活终端
        activateTerminal(activeSessionId);
        return; 
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

      const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
          e.preventDefault(); 
          e.stopPropagation();
          e.stopImmediatePropagation();

          const currentSize = useSettingsStore.getState().fontSize;
          const delta = e.deltaY > 0 ? -1 : 1;
          const newSize = Math.max(6, Math.min(100, currentSize + delta));
          
          setSettings({ fontSize: newSize });
        }
      };

      containerEl.addEventListener("wheel", handleWheel, { 
        passive: false, 
        capture: true 
      });

      const dataDisposable = term.onData((data) => {
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

      // 首次创建时，正常绑定输出，不拦截清屏指令
      await connector.onData((data) => {
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
        activateTerminal(activeSessionId, false);
      });
      resizeObserver.observe(containerEl);

      const instance: TerminalInstance = {
        terminal: term,
        fitAddon,
        resizeObserver,
        connector,
        inputDisposable: dataDisposable,
        dispose: () => {
          containerEl.removeEventListener("wheel", handleWheel, { capture: true });
          instance.inputDisposable?.dispose();
          keyDisposable.dispose();
          selectionDisposable.dispose();
          resizeObserver.disconnect();
          term.dispose();
        },
      };

      terminalMap.current.set(activeSessionId, instance);

      // 首次加载完毕，统一入口激活
      activateTerminal(activeSessionId);
    };

    initTerminal();
    return () => { isMounted = false; };
  }, [activeSessionId, activeSession?.connector, addHistoryCommand, setSettings, activateTerminal]);

  // --- 逻辑 2：响应设置实时变化 (热更新) ---
  useEffect(() => {
    terminalMap.current.forEach((instance, id) => {
      const { terminal } = instance;
      
      if (terminal.options.fontSize !== fontSize) terminal.options.fontSize = fontSize;
      if (terminal.options.fontFamily !== fontFamily) terminal.options.fontFamily = fontFamily;
      
      terminal.options.theme = {
        background: theme === "light" ? "#ffffff" : "#1e1e1e",
        foreground: theme === "light" ? "#333333" : "#cccccc",
        cursor: theme === "light" ? "#007acc" : "#528bff",
        cursorAccent: theme === "light" ? "#ffffff" : "#1e1e1e",
        selectionBackground: "rgba(82, 139, 255, 0.4)",
      };

      if (id === activeSessionId) {
        activateTerminal(id, false);
      }
    });
  }, [fontSize, fontFamily, theme, activeSessionId, activateTerminal]);

  // --- 逻辑 3：清理已删除的会话 ---
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
    activateTerminal(activeSessionId);
  }, [activeSessionId, activateTerminal]);

  // --- 逻辑 5：浏览器可见性事件 (由其他 Tab/窗口 切回时) ---
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        activateTerminal(activeSessionId);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [activeSessionId, activateTerminal]);

  // --- 逻辑 6：窗口 Resize ---
  useEffect(() => {
    const handleGlobalResize = () => {
      activateTerminal(activeSessionId, false);
    };
    window.addEventListener("resize", handleGlobalResize);
    return () => window.removeEventListener("resize", handleGlobalResize);
  }, [activeSessionId, activateTerminal]);

  // --- 逻辑 7：右键粘贴 ---
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
      onClick={() => activateTerminal(activeSessionId)}
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