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
  dataUnsubscribe?: () => void;
  dispose: () => void;

  // 用于在切换连接的一瞬间拦截终端破坏性重置指令的状态
  termState: {
    isTransitioning: boolean;
    timeoutId?: number;
  };
}

export function TerminalView() {
  const { activeSessionId, sessions } = useTabsStore();
  const { addCommand: addHistoryCommand } = useHistoryStore();
  const { fontSize, fontFamily, theme, setSettings } = useSettingsStore();

  const containerMap = useRef(new Map<string, HTMLDivElement>());
  const terminalMap = useRef(new Map<string, TerminalInstance>());
  const lastCommandRef = useRef<string>("");

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // =============================
  // 激活终端 & 调整自适应大小
  // =============================
  const activateTerminal = useCallback(
    (sessionId?: string | null, requireFocus: boolean = true) => {
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
                if (
                  dims.cols !== instance.terminal.cols ||
                  dims.rows !== instance.terminal.rows
                ) {
                  instance.connector.resize?.(dims.cols, dims.rows);
                }
              }
            }
            if (requireFocus) instance.terminal.focus();
          } catch (error) {
            console.warn("Terminal activate failed:", error);
          }
        });
      }
    },
    []
  );

  // =============================
  // 初始化终端核心逻辑
  // =============================
  useEffect(() => {
    if (!activeSessionId || !activeSession?.connector) return;

    const { connector } = activeSession;
    const containerEl = containerMap.current.get(activeSessionId);
    if (!containerEl) return;

    let isMounted = true;

    // 【修复1：早期缓冲区】防止后端刚连接上时发出的欢迎信息（MOTD）因前端还没准备好而丢失
    let tempBuffer = ""; 
    let currentTermInstance: TerminalInstance | null = null;
    let isCurrentConnector = true;

    // 立即监听数据流，不要等 isConnected 的 while 循环
    const setupEarlyListener = async () => {
      return await connector.onData((data) => {
        if (!isCurrentConnector) return;
        if (currentTermInstance) {
          currentTermInstance.terminal.write(data);
        } else {
          tempBuffer += data; // 终端 DOM 还没准备好，先存入内存缓冲区
        }
      });
    };
    
    // 保存可能的解除监听函数，防止内存泄漏
    const unsubPromise = setupEarlyListener();

    const initTerminal = async () => {
      // 仍然等待 isConnected 以确保连接状态，但数据不会丢，因为已经缓存在 tempBuffer 中
      while (!connector.isConnected && isMounted) {
        await new Promise((r) => setTimeout(r, 100));
      }

      if (!isMounted || !connector.isConnected) return;

      const existingInstance = terminalMap.current.get(activeSessionId);

      // =============================
      // Connector 切换 (降级/重连) 处理
      // =============================
      if (existingInstance) {
        if (existingInstance.connector === connector) return;

        console.log("Connector changed:", activeSessionId);

        existingInstance.dataUnsubscribe?.();
        existingInstance.inputDisposable?.dispose();
        existingInstance.connector?.close();
        existingInstance.connector = connector;

        existingInstance.termState.isTransitioning = true;
        if (existingInstance.termState.timeoutId) {
          clearTimeout(existingInstance.termState.timeoutId);
        }
        existingInstance.termState.timeoutId = window.setTimeout(() => {
          existingInstance.termState.isTransitioning = false;
        }, 2000);

        let spacer = "\r\n";
        for (let i = 0; i < existingInstance.terminal.rows; i++) {
          spacer += "\r\n";
        }

        existingInstance.terminal.write(
          "\r\n\x1b[33m ⚠️ Session connection changed. Output preserved. \x1b[0m" + spacer
        );

        // 接管输入输出
        currentTermInstance = existingInstance;
        existingInstance.dataUnsubscribe = () => {
          isCurrentConnector = false;
          // 【修复 TS 报错】：使用 any 断言，兼容 onData 返回 void 的情况
          unsubPromise.then((unsub: any) => { 
            if(typeof unsub === 'function') unsub(); 
          });
        };
        existingInstance.inputDisposable = existingInstance.terminal.onData((data) => {
          connector.write(data);
        });

        // 写入重连期间积压的数据
        if (tempBuffer) {
          existingInstance.terminal.write(tempBuffer);
          tempBuffer = "";
        }

        activateTerminal(activeSessionId);
        return;
      }

      // =============================
      // 创建全新 Terminal 实例
      // =============================
      const termState = { isTransitioning: false, timeoutId: undefined };

      const term = new Terminal({
        fontFamily,
        fontSize,
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 10000,
        allowProposedApi: true,
        theme: {
          background: theme === "light" ? "#ffffff" : "#1e1e1e",
          foreground: theme === "light" ? "#333333" : "#cccccc",
          cursor: theme === "light" ? "#007acc" : "#528bff",
          cursorAccent: theme === "light" ? "#ffffff" : "#1e1e1e",
          selectionBackground: "rgba(82,139,255,0.4)",
        },
      });

      term.parser.registerEscHandler({ final: "c" }, () => {
        if (termState.isTransitioning) return true; 
        return false;
      });

      term.parser.registerCsiHandler({ final: "J" }, (params) => {
        if (termState.isTransitioning && params[0] === 3) return true; 
        return false;
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      try {
        term.loadAddon(new WebglAddon());
      } catch (e) {
        console.warn("WebGL failed", e);
      }

      term.open(containerEl);

      // 【修复2：强制触发初始 Resize】部分后端 Shell 需要明确知道终端尺寸才会打印欢迎信息
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && connector.resize) {
          connector.resize(dims.cols, dims.rows);
        }
      } catch (e) {
        console.warn("Initial fit failed:", e);
      }

      // =============================
      // 事件绑定
      // =============================
      const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          const currentSize = useSettingsStore.getState().fontSize;
          const delta = e.deltaY > 0 ? -1 : 1;
          const newSize = Math.max(6, Math.min(100, currentSize + delta));
          setSettings({ fontSize: newSize });
        }
      };

      containerEl.addEventListener("wheel", handleWheel, {
        passive: false,
        capture: true,
      });

      const inputDisposable = term.onData((data) => {
        connector.write(data);
      });

      const dataUnsubscribe = () => {
        isCurrentConnector = false;
        // 真正触发 Tauri 的解除监听函数，防止内存泄漏
        unsubPromise.then((unsub: any) => { 
          if(typeof unsub === 'function') unsub(); 
        });
      };

      const keyDisposable = term.onKey(({ domEvent }) => {
        if (domEvent.key === "Enter") {
          const buffer = term.buffer.active;
          const line = buffer.getLine(buffer.cursorY + buffer.baseY);

          if (line) {
            let text = line.translateToString(true).trimEnd();
            const lastPrompt = Math.max(text.lastIndexOf("$"), text.lastIndexOf("#"));

            if (lastPrompt !== -1) {
              text = text.slice(lastPrompt + 1).trim();
            }

            if (text && text !== lastCommandRef.current) {
              addHistoryCommand(text);
              lastCommandRef.current = text;
            }
          }
        }
      });

      const selectionDisposable = term.onSelectionChange(async () => {
        if (term.hasSelection()) {
          try {
            await writeText(term.getSelection());
          } catch (e) {
            console.error(e);
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
        inputDisposable,
        dataUnsubscribe,
        termState,

        dispose: () => {
          dataUnsubscribe();
          connector?.close();
          containerEl.removeEventListener("wheel", handleWheel, { capture: true });
          inputDisposable.dispose();
          keyDisposable.dispose();
          selectionDisposable.dispose();
          resizeObserver.disconnect();
          if (termState.timeoutId) clearTimeout(termState.timeoutId);
          term.dispose();
        },
      };

      terminalMap.current.set(activeSessionId, instance);

      // 【将实例标记为 ready，并将积攒的缓冲数据一次性写入】
      currentTermInstance = instance;
      if (tempBuffer) {
        term.write(tempBuffer);
        tempBuffer = "";
      }

      activateTerminal(activeSessionId);
    };

    initTerminal();

    return () => {
      isMounted = false;
      isCurrentConnector = false;
      // 保证组件卸载时及时清理监听器，同样使用 any 断言防止 TS 报错
      unsubPromise.then((unsub: any) => { 
        if(typeof unsub === 'function') unsub(); 
      });
    };
  }, [activeSessionId, activeSession?.connector, activateTerminal, addHistoryCommand, fontFamily, theme]);

  // =============================
  // 监听设置变化 (字体缩放 & 主题)
  // =============================
  useEffect(() => {
    terminalMap.current.forEach((instance, id) => {
      const { terminal, fitAddon, connector } = instance;

      terminal.options.fontSize = fontSize;
      terminal.options.fontFamily = fontFamily;
      terminal.options.theme = {
        background: theme === "light" ? "#ffffff" : "#1e1e1e",
        foreground: theme === "light" ? "#333333" : "#cccccc",
        cursor: theme === "light" ? "#007acc" : "#528bff",
        cursorAccent: theme === "light" ? "#ffffff" : "#1e1e1e",
        selectionBackground: "rgba(82,139,255,0.4)",
      };

      if (id === activeSessionId) {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims && connector) {
              connector.resize?.(dims.cols, dims.rows);
            }
          } catch (e) {
            console.warn("Terminal fit failed after settings change:", e);
          }
        });
      }
    });
  }, [fontSize, fontFamily, theme, activeSessionId]);

  // =============================
  // 清理已被关闭的会话
  // =============================
  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));

    terminalMap.current.forEach((instance, id) => {
      if (!currentIds.has(id)) {
        instance.dispose();
        terminalMap.current.delete(id);
      }
    });
  }, [sessions]);

  // =============================
  // 标签页切换激活
  // =============================
  useEffect(() => {
    activateTerminal(activeSessionId);
  }, [activeSessionId, activateTerminal]);

  // =============================
  // 窗口可见性改变激活
  // =============================
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        activateTerminal(activeSessionId);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [activeSessionId, activateTerminal]);

  // =============================
  // 窗口缩放调整终端尺寸
  // =============================
  useEffect(() => {
    const handler = () => activateTerminal(activeSessionId, false);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [activeSessionId, activateTerminal]);

  // =============================
  // 鼠标右键 (无选中文本时粘贴，有选中文本时取消选中)
  // =============================
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
      } catch (error) {
        console.error("Failed to read clipboard:", error);
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
      onClick={() => activateTerminal(activeSessionId)}
      onContextMenu={handleContextMenu}
    >
      {sessions.map((s) => (
        <div
          key={s.id}
          ref={(el) => {
            if (el) containerMap.current.set(s.id, el);
          }}
          className={
            s.id === activeSessionId
              ? "h-full w-full absolute inset-0 px-2"
              : "hidden"
          }
        />
      ))}
    </main>
  );
}