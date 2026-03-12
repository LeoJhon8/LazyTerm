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
  parserDisposables?: Array<{ dispose(): void }>;
  dataUnsubscribe?: () => void;
  dispose: () => void;
  webglAddon?: WebglAddon | null;

  // 用于在切换连接的一瞬间拦截终端破坏性重置指令的状态
  termState: {
    isTransitioning: boolean;
    timeoutId?: number;
    resizeTimeoutId?: number;
  };
}

function syncTerminalDimensions(
  terminal: Terminal,
  fitAddon: FitAddon,
  connector?: ITerminalConnector
) {
  const dims = fitAddon.proposeDimensions();
  if (!dims) return;

  const nextCols = dims.cols;
  const nextRows = dims.rows;
  const sizeChanged =
    nextCols !== terminal.cols || nextRows !== terminal.rows;

  fitAddon.fit();

  if (sizeChanged && connector) {
    connector.resize?.(nextCols, nextRows);
  }
}

function shouldBlockIndexedColorChange(data: string): boolean {
  const normalized = data.trim();
  if (!normalized) return false;

  const parts = normalized.split(";");
  for (let index = 1; index < parts.length; index += 2) {
    if (parts[index]?.trim() === "?") {
      return false;
    }
  }

  return true;
}

function shouldBlockNamedColorChange(data: string): boolean {
  return data.trim() !== "?";
}

function extractCommand(lineText: string) {
  const text = lineText.trim();
  if (!text) return "";

  if (text.startsWith("PS ")) {
    const idx = text.indexOf("> ");
    if (idx !== -1) return text.substring(idx + 2).trim();
  }

  if (/^[A-Za-z]:[\\/]/.test(text)) {
    const idx = text.indexOf("> ");
    if (idx !== -1) return text.substring(idx + 2).trim();
  }

  const unixMatch = text.match(/^[^@\s]+@[^:\s\\]+[:\s][^#$%]*?[#$%]\s+/);
  if (unixMatch) {
    return text.substring(unixMatch[0].length).trim();
  }

  const minimalMatch = text.match(/^([a-zA-Z0-9_\-/.~]+\s?)?[#$%❯➜]\s+/);
  if (minimalMatch) {
    return text.substring(minimalMatch[0].length).trim();
  }

  const arrowMatch = text.match(/^[>]{1,3}\s+/);
  if (arrowMatch) {
    return text.substring(arrowMatch[0].length).trim();
  }

  if (text && (text.endsWith(">") || text.endsWith("$") || text.endsWith("%") || text.endsWith("#"))) {
    return "";
  }

  return text;
}

export function TerminalView() {
  const { activeSessionId, sessions } = useTabsStore();
  const { addCommand: addHistoryCommand } = useHistoryStore();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const customThemeColors = useSettingsStore((state) => state.customThemeColors);
  const terminalOpacity = useSettingsStore((state) => state.terminalOpacity);
  const backgroundImageEnabled = useSettingsStore((state) => state.backgroundImageEnabled);
  const backgroundImage = useSettingsStore((state) => state.backgroundImage);
  const setSettings = useSettingsStore((state) => state.setSettings);

  const containerMap = useRef(new Map<string, HTMLDivElement>());
  const terminalMap = useRef(new Map<string, TerminalInstance>());
  const lastCommandRef = useRef<string>("");
  const addHistoryCommandRef = useRef(addHistoryCommand);
  const setSettingsRef = useRef(setSettings);
  const appearanceRef = useRef({
    fontSize,
    fontFamily,
    terminalColorScheme,
    customThemeColors,
    terminalOpacity,
    hasBackgroundImage: !!(backgroundImageEnabled && backgroundImage),
  });

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeConnector = activeSession?.connector;
  const hasBackgroundImage = backgroundImageEnabled && backgroundImage;

  addHistoryCommandRef.current = addHistoryCommand;
  setSettingsRef.current = setSettings;
  appearanceRef.current = {
    fontSize,
    fontFamily,
    terminalColorScheme,
    customThemeColors,
    terminalOpacity,
    hasBackgroundImage: !!hasBackgroundImage,
  };

  // =============================
  // 激活终端 & 调整自适应大小
  // =============================
  const activateTerminal = useCallback(
    function activateTerminalInternal(
      sessionId?: string | null,
      requireFocus: boolean = true,
      retryCount: number = 0
    ) {
      if (!sessionId) return;
      const instance = terminalMap.current.get(sessionId);
      const container = containerMap.current.get(sessionId);

      if (instance && container) {
        requestAnimationFrame(() => {
          try {
            const hasLayoutSize = container.clientWidth > 0 && container.clientHeight > 0;

            if (hasLayoutSize) {
              syncTerminalDimensions(instance.terminal, instance.fitAddon, instance.connector);
            }

            if (requireFocus) {
              instance.terminal.focus();
              const helperTextarea = container.querySelector<HTMLTextAreaElement>(
                ".xterm-helper-textarea"
              );
              helperTextarea?.focus();
            }

            if (!hasLayoutSize && retryCount < 6) {
              window.setTimeout(() => {
                activateTerminalInternal(sessionId, requireFocus, retryCount + 1);
              }, 50);
            }
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
    if (!activeSessionId || !activeConnector) return;

    const connector = activeConnector;
    const containerEl = containerMap.current.get(activeSessionId);
    if (!containerEl) return;

    const existingInstance = terminalMap.current.get(activeSessionId);

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

      if (existingInstance?.connector === connector) {
        currentTermInstance = existingInstance;
        existingInstance.dataUnsubscribe = () => {
          isCurrentConnector = false;
          unsubPromise.then((unsub: unknown) => {
            if (typeof unsub === "function") unsub();
          });
        };

        if (tempBuffer) {
          existingInstance.terminal.write(tempBuffer);
          tempBuffer = "";
        }

        activateTerminal(activeSessionId);
        return;
      }

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
          unsubPromise.then((unsub: unknown) => {
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

      const {
        fontSize: nextFontSize,
        fontFamily: nextFontFamily,
        terminalColorScheme: nextTerminalColorScheme,
        customThemeColors: nextCustomThemeColors,
        terminalOpacity: nextTerminalOpacity,
        hasBackgroundImage: nextHasBackgroundImage,
      } = appearanceRef.current;
      const colorScheme = getTerminalTheme(nextTerminalColorScheme, nextCustomThemeColors);
      const term = new Terminal({
        fontFamily: nextFontFamily,
        fontSize: nextFontSize,
        cursorBlink: true,
        cursorStyle: "bar",
        scrollback: 10000,
        allowProposedApi: true,
        allowTransparency: true,
        theme: toXtermTheme(colorScheme, nextTerminalOpacity),
      });

      term.parser.registerEscHandler({ final: "c" }, () => {
        if (termState.isTransitioning) return true;
        return false;
      });

      term.parser.registerCsiHandler({ final: "J" }, (params) => {
        if (termState.isTransitioning && params[0] === 3) return true;
        return false;
      });

      const parserDisposables = [
        // 保持本地主题为权威来源，避免嵌套 SSH 登录时被远端 shell/prompt 改写调色板。
        term.parser.registerOscHandler(4, (data) => shouldBlockIndexedColorChange(data)),
        term.parser.registerOscHandler(10, (data) => shouldBlockNamedColorChange(data)),
        term.parser.registerOscHandler(11, (data) => shouldBlockNamedColorChange(data)),
        term.parser.registerOscHandler(12, (data) => shouldBlockNamedColorChange(data)),
        term.parser.registerOscHandler(104, () => true),
        term.parser.registerOscHandler(110, () => true),
        term.parser.registerOscHandler(111, () => true),
        term.parser.registerOscHandler(112, () => true),
      ];

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      let webglAddon: WebglAddon | null = null;
      const shouldUseWebgl = !nextHasBackgroundImage && nextTerminalOpacity >= 100;
      if (shouldUseWebgl) {
        try {
          webglAddon = new WebglAddon();
          term.loadAddon(webglAddon);
        } catch (e) {
          console.warn("WebGL failed", e);
          webglAddon = null;
        }
      }

      term.open(containerEl);

      try {
        syncTerminalDimensions(term, fitAddon, connector);
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
          setSettingsRef.current({ fontSize: newSize });
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
        unsubPromise.then((unsub: unknown) => {
          if (typeof unsub === "function") unsub();
        });
      };

      const keyDisposable = term.onKey(({ domEvent }) => {
        if (domEvent.key === "Enter") {
          const buffer = term.buffer.active;
          const line = buffer.getLine(buffer.cursorY + buffer.baseY);

          if (line) {
            const rawText = line.translateToString(true);
            const command = extractCommand(rawText);

            if (command && command.length > 0 && command !== lastCommandRef.current) {
              addHistoryCommandRef.current(command);
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
        parserDisposables,
        dataUnsubscribe,
        termState,
        webglAddon,

        dispose: () => {
          dataUnsubscribe();
          connector?.close();
          containerEl.removeEventListener("wheel", handleWheel, { capture: true });
          inputDisposable.dispose();
          parserDisposables.forEach((disposable) => disposable.dispose());
          keyDisposable.dispose();
          selectionDisposable.dispose();
          resizeObserver.disconnect();
          if (termState.timeoutId) clearTimeout(termState.timeoutId);
          if (termState.resizeTimeoutId) clearTimeout(termState.resizeTimeoutId);
          if (webglAddon) webglAddon.dispose();
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
      unsubPromise.then((unsub: unknown) => {
        if (typeof unsub === "function") unsub();
      });
    };
  }, [activeSessionId, activeConnector, activateTerminal]);

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
      const shouldUseWebgl = !hasBackgroundImage && terminalOpacity >= 100;
      if (shouldUseWebgl && !instance.webglAddon) {
        try {
          const addon = new WebglAddon();
          terminal.loadAddon(addon);
          instance.webglAddon = addon;
        } catch (e) {
          console.warn("WebGL failed", e);
          instance.webglAddon = null;
        }
      }
      if (!shouldUseWebgl && instance.webglAddon) {
        instance.webglAddon.dispose();
        instance.webglAddon = null;
      }

      if (id === activeSessionId) {
        requestAnimationFrame(() => {
          try {
            const dims = fitAddon.proposeDimensions();
            const sizeChanged =
              !!dims && (dims.cols !== terminal.cols || dims.rows !== terminal.rows);

            fitAddon.fit();

            if (dims && connector && sizeChanged) {
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
  }, [fontSize, fontFamily, terminalColorScheme, customThemeColors, terminalOpacity, activeSessionId, hasBackgroundImage]);

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

  useEffect(() => {
    const handler = () => activateTerminal(activeSessionId);
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
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
      <div className="terminal-empty-state">
        <div className="terminal-empty-card">
          <div className="chip-row mb-4 text-[11px] text-muted-foreground">Lazy Terminal Workspace</div>
          <h2 className="mb-2 text-2xl font-semibold tracking-tight">把终端、SSH 和常用命令收进一个工作台</h2>
          <p className="mb-6 max-w-md text-sm leading-6 text-muted-foreground">
            从左侧会话面板创建本地终端或 SSH 连接。顶部管理标签页，底部承载快捷命令，整个界面会跟随你的布局配置协同工作。
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-background/56 p-4">
              <div className="mb-2 text-sm font-medium">本地终端</div>
              <div className="text-xs leading-5 text-muted-foreground">支持 PowerShell、CMD、Bash 等本地 Shell 快速启动。</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/56 p-4">
              <div className="mb-2 text-sm font-medium">SSH 会话</div>
              <div className="text-xs leading-5 text-muted-foreground">保存远程主机配置，直接发起连接并复用历史资料。</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/56 p-4">
              <div className="mb-2 text-sm font-medium">快捷动作</div>
              <div className="text-xs leading-5 text-muted-foreground">在底部编排批量命令，提高重复操作效率。</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main
      className="terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden border border-(--terminal-border) bg-(--terminal-shell) shadow-(--panel-shadow)"
      onClick={() => activateTerminal(activeSessionId)}
      onContextMenu={handleContextMenu}
      style={{
        backgroundColor: hasBackgroundImage ? "transparent" : xtermTheme.background,
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
              ? "terminal-host absolute inset-0 h-full w-full overflow-hidden"
              : "hidden"
          }
        />
      ))}
    </main>
  );
}
