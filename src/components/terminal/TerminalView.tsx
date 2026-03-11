import { useEffect, useRef, useCallback } from "react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { useSlotConfigStore } from "@/store/slot-config";
import { useHistoryStore } from "@/store/history";
import type { ITerminalConnector } from "@/types/terminal";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { getTerminalTheme, toXtermTheme } from "@/config/themes";
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
    resizeTimeoutId?: number;
  };
}

export function TerminalView() {
  const { activeSessionId, sessions } = useTabsStore();
  const { addCommand: addHistoryCommand } = useHistoryStore();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const customThemeColors = useSettingsStore((state) => state.customThemeColors);
  const terminalOpacity = useSettingsStore((state) => state.terminalOpacity);
  const uiOpacity = useSettingsStore((state) => state.uiOpacity);
  const backgroundImage = useSettingsStore((state) => state.backgroundImage);
  const setSettings = useSettingsStore((state) => state.setSettings);

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
  // 初始化终端核心 logic
  // =============================
  useEffect(() => {
    if (!activeSessionId || !activeSession?.connector) return;

    const { connector } = activeSession;
    const containerEl = containerMap.current.get(activeSessionId);
    if (!containerEl) return;

    let isMounted = true;

    // 早期缓冲区：防止后端刚连接上时发出的欢迎信息丢失
    let tempBuffer = "";
    let currentTermInstance: TerminalInstance | null = null;
    let isCurrentConnector = true;

    const setupEarlyListener = async () => {
      return await connector.onData((data) => {
        if (!isCurrentConnector) return;
        if (currentTermInstance) {
          currentTermInstance.terminal.write(data);
        } else {
          tempBuffer += data;
        }
      });
    };

    const unsubPromise = setupEarlyListener();

    const initTerminal = async () => {
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

        currentTermInstance = existingInstance;
        existingInstance.dataUnsubscribe = () => {
          isCurrentConnector = false;
          unsubPromise.then((unsub: any) => {
            if (typeof unsub === "function") unsub();
          });
        };
        existingInstance.inputDisposable = existingInstance.terminal.onData((data) => {
          connector.write(data);
        });

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
      const termState = { isTransitioning: false, timeoutId: undefined, resizeTimeoutId: undefined };

      const colorScheme = getTerminalTheme(terminalColorScheme, customThemeColors);
      const term = new Terminal({
        fontFamily,
        fontSize,
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 10000,
        allowProposedApi: true,
        allowTransparency: true,
        theme: toXtermTheme(colorScheme, terminalOpacity),
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

      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && connector.resize) {
          connector.resize(dims.cols, dims.rows);
        }
      } catch (e) {
        console.warn("Initial fit failed:", e);
      }

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
        unsubPromise.then((unsub: any) => {
          if (typeof unsub === "function") unsub();
        });
      };

      // =============================
      // 提取历史命令记录 (智能过滤 Prompt 提示符)
      // =============================
      const extractCommand = (lineText: string) => {
        let text = lineText.trim();
        if (!text) return "";

        // 1. PowerShell (兼容 Windows/Linux) "PS C:\xxx> " 或 "PS /home/user> "
        if (text.startsWith("PS ")) {
          const idx = text.indexOf("> ");
          if (idx !== -1) return text.substring(idx + 2).trim();
        }

        // 2. Windows CMD "C:\xxx> " 或 "D:\> "
        if (/^[A-Za-z]:[\\/]/.test(text)) {
          const idx = text.indexOf("> ");
          if (idx !== -1) return text.substring(idx + 2).trim();
        }

        // 3. Unix 经典格式 "user@host:~/dir$ " 或 "user@mac ~ % "
        const unixMatch = text.match(/^[^@\s]+@[^:\s\\]+[:\s][^#\$%]*?[#\$%]\s+/);
        if (unixMatch) {
          return text.substring(unixMatch[0].length).trim();
        }

        // 4. 精简版/美化版终端格式 "~ % ", "$ ", "❯ ", "➜ ", "/var/log # "
        const minimalMatch = text.match(/^([a-zA-Z0-9_\-\/\.~]+\s?)?[#\$%❯➜]\s+/);
        if (minimalMatch) {
          return text.substring(minimalMatch[0].length).trim();
        }

        // 5. 简单箭头 ">>> " (Python REPL), "> " 
        const arrowMatch = text.match(/^[>]{1,3}\s+/);
        if (arrowMatch) {
          return text.substring(arrowMatch[0].length).trim();
        }
        
        // 如果 text 以常见的提示符结尾且没有实际命令内容，则返回空
        if (text && (text.endsWith(">") || text.endsWith("$") || text.endsWith("%") || text.endsWith("#"))) {
          return "";
        }

        return text;
      };

      const keyDisposable = term.onKey(({ domEvent }) => {
        if (domEvent.key === "Enter") {
          const buffer = term.buffer.active;
          const line = buffer.getLine(buffer.cursorY + buffer.baseY);

          if (line) {
            const rawText = line.translateToString(true);
            const command = extractCommand(rawText);

            if (command && command.length > 0 && command !== lastCommandRef.current) {
              addHistoryCommand(command);
              lastCommandRef.current = command;
            }
          }
        }
      });

      // =============================
      // 其他事件绑定
      // =============================
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
          if (termState.resizeTimeoutId) clearTimeout(termState.resizeTimeoutId);
          term.dispose();
        },
      };

      terminalMap.current.set(activeSessionId, instance);

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
      unsubPromise.then((unsub: any) => {
        if (typeof unsub === "function") unsub();
      });
    };
  }, [activeSessionId, activeSession?.connector, activateTerminal, addHistoryCommand]);

  // =============================
  // 监听设置变化 (字体缩放 & 主题)
  // =============================  // 处理配置更改时的热更新
  useEffect(() => {
    const colorScheme = getTerminalTheme(terminalColorScheme, customThemeColors);
    terminalMap.current.forEach((instance, id) => {
      const { terminal, fitAddon, connector, termState } = instance;

      terminal.options.fontSize = fontSize;
      terminal.options.fontFamily = fontFamily;
      terminal.options.theme = toXtermTheme(colorScheme, terminalOpacity);

      if (id === activeSessionId) {
        requestAnimationFrame(() => {
          try {
            fitAddon.fit();
            const dims = fitAddon.proposeDimensions();
            if (dims && connector) {
              // 防抖处理：避免用户通过滚轮快速缩放字体时疯狂发送 resize 导致终端输出重复字符
              if (termState.resizeTimeoutId) {
                clearTimeout(termState.resizeTimeoutId);
              }
              termState.resizeTimeoutId = window.setTimeout(() => {
                connector.resize?.(dims.cols, dims.rows);
              }, 300);
            }
            terminal.focus();
          } catch (e) {
            console.warn("Terminal fit failed after settings change:", e);
          }
        });
      }
    });
  }, [fontSize, fontFamily, terminalColorScheme, terminalOpacity, activeSessionId]);

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

  useEffect(() => {
    const handler = () => activateTerminal(activeSessionId);
    window.addEventListener("lazy-terminal-focus", handler);
    return () => window.removeEventListener("lazy-terminal-focus", handler);
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
  // 监听侧边栏折叠状态变化
  // =============================
  const leftSlotCollapsed = useSlotConfigStore((state) => state.currentConfig.left.collapsed);
  const rightSlotCollapsed = useSlotConfigStore((state) => state.currentConfig.right.collapsed);
  
  useEffect(() => {
    // 当侧边栏折叠状态变化时，等待布局转换完成后重新调整终端
    const timer = setTimeout(() => {
      activateTerminal(activeSessionId, true);
    }, 300); // 这里的延迟应该略大于 CSS transition 的持续时间 (300ms)
    
    return () => clearTimeout(timer);
  }, [activeSessionId, leftSlotCollapsed, rightSlotCollapsed, activateTerminal]);

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

  const currentTheme = getTerminalTheme(terminalColorScheme, customThemeColors);
  const xtermTheme = toXtermTheme(currentTheme, terminalOpacity);

  if (sessions.length === 0 || !activeSession) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="text-6xl mb-4">💻</div>
          <h2 className="text-xl font-semibold mb-2">欢迎使用 LazyTerm</h2>
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
      style={{
        backgroundColor: xtermTheme.background,
        opacity: backgroundImage ? uiOpacity / 100 : undefined,
      }}
    >
      {sessions.map((s) => (
        <div
          key={s.id}
          ref={(el) => {
            if (el) containerMap.current.set(s.id, el);
          }}
          className={
            s.id === activeSessionId
              ? "h-full w-full absolute inset-0"
              : "hidden"
          }
        />
      ))}
    </main>
  );
}
