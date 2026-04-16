import { useEffect, useRef, useCallback } from "react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { useSlotConfigStore } from "@/store/slot-config";
import { useHistoryStore } from "@/store/history";
import type { ITerminalConnector, SessionConnector } from "@/types/terminal";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { getTerminalTheme, toXtermTheme } from "@/config/themes";
import {
  type BaseSessionViewProps,
  VIEW_CONTAINER_CLASSNAME,
} from "./BaseSessionView";
import { Terminal as TerminalIcon } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { cn } from "@/lib/utils";
import { TerminalAutocompleteUI } from "./TerminalAutocompleteUI";
import { AutocompleteTerminalAddon } from "./AutocompleteTerminalAddon";
import { useI18n } from "@/i18n";

// 全局 Terminal 实例缓存，确保切换 tab 时输出历史不丢失
const globalTerminalCache = new Map<string, TerminalInstance>();
const globalContainerCache = new Map<string, HTMLDivElement>();

/**
 * Terminal 视图组件
 * 继承 BaseSessionView 的模板方法模式
 */

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
  acAddon?: AutocompleteTerminalAddon | null;
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

  const minimalMatch = text.match(/^([a-zA-Z0_9_\-/.~]+\s?)?[#$%❯➜]\s+/);
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

function isTerminalConnector(connector: SessionConnector | undefined): connector is ITerminalConnector {
  return connector !== undefined && connector.protocol !== "rdp" && connector.protocol !== "vnc";
}

/**
 * TerminalView 组件
 * 实现 BaseSessionView 定义的 renderContent 抽象方法
 */
export function TerminalViewClass(props: BaseSessionViewProps) {
  const { t } = useI18n();
  const { paneId, sessionId } = props;
  const acAddonRef = useRef<AutocompleteTerminalAddon | null>(null);

  // Terminal 特有状态
  const { sessions } = useTabsStore();
  const { addCommand: addHistoryCommand } = useHistoryStore();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const customThemeColors = useSettingsStore((state) => state.customThemeColors);
  const terminalOpacity = useSettingsStore((state) => state.terminalOpacity);
  const backgroundImageEnabled = useSettingsStore((state) => state.backgroundImageEnabled);
  const backgroundImage = useSettingsStore((state) => state.backgroundImage);
  const terminalAutocomplete = useSettingsStore((state) => state.terminalAutocomplete);
  const setSettings = useSettingsStore((state) => state.setSettings);

  // 使用全局缓存替代组件级别的 ref，确保切换 tab 时输出历史不丢失
  const containerMap = useRef(globalContainerCache);
  const terminalMap = useRef(globalTerminalCache);
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

  const activeSession = sessions.find((s) => s.id === sessionId);
  const activeConnector = isTerminalConnector(activeSession?.connector) ? activeSession.connector : undefined;
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

  // 激活终端 & 调整自适应大小
  const activateTerminal = useCallback(
    function activateTerminalInternal(
      targetSessionId?: string | null,
      requireFocus: boolean = true,
      retryCount: number = 0
    ) {
      if (!targetSessionId) return;
      const instance = terminalMap.current.get(targetSessionId);
      const container = containerMap.current.get(targetSessionId);

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
                activateTerminalInternal(targetSessionId, requireFocus, retryCount + 1);
              }, 50);
            }
          } catch (error) {
            logger.warn("FE/terminal-view/activate", "Terminal activate failed", { error });
          }
        });
      }
    },
    []
  );

  // 初始化终端核心逻辑
  useEffect(() => {
    if (!sessionId || !activeConnector) return;

    const connector = activeConnector;
    const containerEl = containerMap.current.get(sessionId);
    if (!containerEl) return;

    const existingInstance = terminalMap.current.get(sessionId);

    let isMounted = true;
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

        activateTerminal(sessionId);
        return;
      }

      // Connector 切换 (降级/重连) 处理
      if (existingInstance) {
        if (existingInstance.connector === connector) return;

        logger.debug("FE/terminal-view/connector", `Connector changed: ${sessionId}`);

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
          `\r\n\x1b[33m ${t("警告: 会话连接已更改，输出保留。")} \x1b[0m` + spacer
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

        activateTerminal(sessionId);
        return;
      }

      // 创建全新 Terminal 实例
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

      let acAddon: AutocompleteTerminalAddon | null = null;
      if (useSettingsStore.getState().terminalAutocomplete) {
        acAddon = new AutocompleteTerminalAddon(
           sessionId,
           (text) => {
              if (currentTermInstance?.connector) {
                 currentTermInstance.connector.write(text);
              }
           }
        );
        term.loadAddon(acAddon);
        acAddonRef.current = acAddon;
      }

      let webglAddon: WebglAddon | null = null;
      const shouldUseWebgl = !nextHasBackgroundImage && nextTerminalOpacity >= 100;
      if (shouldUseWebgl) {
        try {
          webglAddon = new WebglAddon();
          term.loadAddon(webglAddon);
        } catch (e) {
          logger.warn("FE/terminal-view/webgl", "WebGL failed during init", { e });
          webglAddon = null;
        }
      }

      term.open(containerEl);

      try {
        syncTerminalDimensions(term, fitAddon, connector);
      } catch (e) {
        logger.warn("FE/terminal-view/fit", "Initial fit failed", { e });
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

      const selectionDisposable = term.onSelectionChange(async () => {
        if (term.hasSelection()) {
          try {
            await writeText(term.getSelection());
          } catch (e) {
            logger.error("FE/terminal-view/selection", "Failed to write to clipboard", { e });
          }
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        activateTerminal(sessionId, false);
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
        acAddon,

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
          if (instance.acAddon) instance.acAddon.dispose();
          term.dispose();
        },
      };

      terminalMap.current.set(sessionId, instance);

      currentTermInstance = instance;
      if (tempBuffer) {
        term.write(tempBuffer);
        tempBuffer = "";
      }

      activateTerminal(sessionId);
    };

    initTerminal();

    return () => {
      isMounted = false;
      isCurrentConnector = false;
      unsubPromise.then((unsub: unknown) => {
        if (typeof unsub === "function") unsub();
      });
    };
  }, [sessionId, activeConnector, activateTerminal]);

  // 监听设置变化
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
          logger.warn("FE/terminal-view/webgl", "WebGL failed during settings update", { e });
          instance.webglAddon = null;
        }
      }
      if (!shouldUseWebgl && instance.webglAddon) {
        instance.webglAddon.dispose();
        instance.webglAddon = null;
      }

      if (terminalAutocomplete && !instance.acAddon) {
        const acAddon = new AutocompleteTerminalAddon(
           id,
           (text) => {
              if (instance.connector) {
                 instance.connector.write(text);
              }
           }
        );
        terminal.loadAddon(acAddon);
        instance.acAddon = acAddon;
        if (id === sessionId) {
          acAddonRef.current = acAddon;
        }
      } else if (!terminalAutocomplete && instance.acAddon) {
        instance.acAddon.dispose();
        instance.acAddon = null;
        if (id === sessionId) {
          acAddonRef.current = null;
        }
      }

      if (id === sessionId) {
        requestAnimationFrame(() => {
          try {
            const dims = fitAddon.proposeDimensions();
            const sizeChanged =
              !!dims && (dims.cols !== terminal.cols || dims.rows !== terminal.rows);

            fitAddon.fit();

            if (dims && connector && sizeChanged) {
              if (termState.resizeTimeoutId) {
                clearTimeout(termState.resizeTimeoutId);
              }
              termState.resizeTimeoutId = window.setTimeout(() => {
                connector.resize?.(dims.cols, dims.rows);
              }, 300);
            }
            terminal.focus();
          } catch (e) {
            logger.warn("FE/terminal-view/fit", "Terminal fit failed after settings change", { e });
          }
        });
      }
    });
  }, [fontSize, fontFamily, terminalColorScheme, customThemeColors, terminalOpacity, sessionId, hasBackgroundImage, terminalAutocomplete]);

  // 清理已被关闭的会话
  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));

    terminalMap.current.forEach((instance, id) => {
      if (!currentIds.has(id)) {
        instance.dispose();
        terminalMap.current.delete(id);
      }
    });
  }, [sessions]);

  // 标签页切换激活
  useEffect(() => {
    activateTerminal(sessionId);
  }, [sessionId, activateTerminal]);

  useEffect(() => {
    const handler = () => activateTerminal(sessionId);
    window.addEventListener("lazy-term-focus", handler);
    return () => window.removeEventListener("lazy-term-focus", handler);
  }, [sessionId, activateTerminal]);

  useEffect(() => {
    const handler = () => activateTerminal(sessionId);
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, [sessionId, activateTerminal]);

  // 窗口可见性改变激活
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        activateTerminal(sessionId);
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [sessionId, activateTerminal]);

  // 窗口缩放调整终端尺寸
  useEffect(() => {
    const handler = () => activateTerminal(sessionId, false);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [sessionId, activateTerminal]);

  // 监听侧边栏折叠状态变化
  const leftSlotCollapsed = useSlotConfigStore((state) => state.currentConfig.left.collapsed);
  const rightSlotCollapsed = useSlotConfigStore((state) => state.currentConfig.right.collapsed);

  useEffect(() => {
    const timer = setTimeout(() => {
      activateTerminal(sessionId, true);
    }, 300);

    return () => clearTimeout(timer);
  }, [sessionId, leftSlotCollapsed, rightSlotCollapsed, activateTerminal]);

  // 鼠标右键处理
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();

    if (!sessionId || !activeSession?.connector || !isTerminalConnector(activeSession.connector)) return;

    const instance = terminalMap.current.get(sessionId);
    if (!instance) return;

    if (instance.terminal.hasSelection()) {
      instance.terminal.clearSelection();
    } else {
      try {
        const text = await readText();
        if (text) activeSession.connector.write(text);
      } catch (error) {
        logger.error("FE/terminal-view/clipboard", "Failed to read clipboard", { error });
      }
    }
  };

  const currentTheme = getTerminalTheme(terminalColorScheme, customThemeColors);
  const xtermTheme = toXtermTheme(currentTheme, terminalOpacity);

  // 空状态渲染
  if (!activeSession) {
    return (
      <div className="terminal-empty-state h-full w-full flex items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/6 px-8 py-10 text-center text-white/80">
          <TerminalIcon className="h-10 w-10 text-emerald-300" />
          <div>
            <div className="text-lg font-semibold text-white">{t("今天，你想连接什么？")}</div>
            <div className="mt-2 text-sm leading-6 text-white/60">{t("轻松、快速建立ssh连接，windows远程桌面，VNC连接，本地终端。")}</div>
          </div>
        </div>
      </div>
    );
  }

  // 渲染内容（对应基类的 renderContent 抽象方法）
  return (
    <main
      className={cn(VIEW_CONTAINER_CLASSNAME, "bg-(--terminal-shell)")}
      onClick={() => activateTerminal(sessionId)}
      onContextMenu={handleContextMenu}
      style={{
        backgroundColor: hasBackgroundImage ? "transparent" : xtermTheme.background,
      }}
      data-view-type="terminal"
      data-session-id={sessionId}
      data-pane-id={paneId}
    >
      {terminalAutocomplete && (
        <TerminalAutocompleteUI
          sessionId={sessionId}
          onAccept={(text) => {
             if (acAddonRef.current) {
                 acAddonRef.current.insertCompletion(text);
             }
          }}
        />
      )}
      <div className="terminal-host absolute inset-0 h-full w-full overflow-hidden pl-2 pt-2 pb-2 pr-0">
        <div
          ref={(el) => {
            if (!el) return;
            
            // 检查是否有缓存的容器和终端实例
            const cachedContainer = containerMap.current.get(sessionId);
            const cachedInstance = terminalMap.current.get(sessionId);
            
            if (cachedContainer && cachedInstance && cachedContainer !== el) {
              // 将终端的 DOM 元素移动到新容器中
              const terminalElement = cachedContainer.querySelector('.xterm');
              if (terminalElement) {
                el.appendChild(terminalElement);
              }
              // 更新缓存的容器引用
              containerMap.current.set(sessionId, el);
              // 触发尺寸调整
              requestAnimationFrame(() => {
                try {
                  cachedInstance.fitAddon.fit();
                } catch (e) {
                  logger.warn("FE/terminal-view/refit", "Terminal refit failed after container move", { e });
                }
              });
            } else {
              // 首次挂载，直接缓存容器
              containerMap.current.set(sessionId, el);
            }
          }}
          className="terminal-xterm-wrapper h-full w-full overflow-hidden"
        />
      </div>
    </main>
  );
}
