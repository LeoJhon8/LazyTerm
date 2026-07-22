import { useEffect, useRef, useCallback, useState, type WheelEvent as ReactWheelEvent } from "react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import { DEFAULT_APP_COLOR_PALETTE, useSettingsStore } from "@/store/settings";
import { useSlotConfigStore } from "@/store/slot-config";
import { useHistoryStore } from "@/store/history";
import { usePanesStore } from "@/store/panes";
import type { ITerminalConnector, SessionConnector } from "@/types/terminal";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { getResolvedTerminalTheme, toXtermTheme } from "@/config/themes";
import {
  type BaseSessionViewProps,
  VIEW_CONTAINER_CLASSNAME,
} from "./BaseSessionView";
import { ConnectionStatusOverlay } from "./ConnectionStatusOverlay";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import "@xterm/xterm/css/xterm.css";
import { cn } from "@/lib/utils";
import { normalizePasteTextForConnector } from "@/lib/terminal-paste";
import { TerminalAutocompleteUI } from "./TerminalAutocompleteUI";
import { AutocompleteTerminalAddon } from "./AutocompleteTerminalAddon";
import { extractTerminalCommand } from "./terminal-command-line";
import { useI18n } from "@/i18n";
import type { AppColorPalette } from "@/store/settings";

// 全局 Terminal 实例缓存，确保切换 tab 时输出历史不丢失
const globalTerminalCache = new Map<string, TerminalInstance>();
const globalContainerCache = new Map<string, HTMLDivElement>();
const MAX_TERMINAL_OUTPUT_BATCH = 256 * 1024;

class OrderedTerminalOutput {
  private pending: string[] = [];
  private writing = false;
  private disposed = false;
  private readonly terminal: Terminal;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  write(data: string) {
    if (this.disposed || !data) return;
    this.pending.push(data);
    this.drain();
  }

  dispose() {
    this.disposed = true;
    this.pending = [];
  }

  private takeBatch() {
    let batch = "";
    while (this.pending.length > 0 && batch.length < MAX_TERMINAL_OUTPUT_BATCH) {
      const next = this.pending[0];
      const remaining = MAX_TERMINAL_OUTPUT_BATCH - batch.length;
      if (next.length <= remaining) {
        batch += next;
        this.pending.shift();
      } else {
        batch += next.slice(0, remaining);
        this.pending[0] = next.slice(remaining);
      }
    }
    return batch;
  }

  private drain() {
    if (this.disposed || this.writing || this.pending.length === 0) return;

    const batch = this.takeBatch();
    this.writing = true;
    this.terminal.write(batch, () => {
      this.writing = false;
      this.drain();
    });
  }
}

/**
 * Terminal 视图组件
 */

interface TerminalInstance {
  terminal: Terminal;
  output: OrderedTerminalOutput;
  fitAddon: FitAddon;
  resizeObserver: ResizeObserver;
  connector?: ITerminalConnector;
  inputDisposable?: { dispose(): void };
  parserDisposables?: Array<{ dispose(): void }>;
  dataUnsubscribe?: () => void;
  pasteElement?: HTMLTextAreaElement;
  pasteHandler?: (event: ClipboardEvent) => void;
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

  const previousCols = terminal.cols;
  const previousRows = terminal.rows;

  fitAddon.fit();

  const sizeChanged =
    terminal.cols !== previousCols || terminal.rows !== previousRows;
  if (sizeChanged && connector) {
    // fit() 会再次测量容器；必须同步最终实际生效的尺寸，不能发送 fit 前的估算值。
    connector.resize?.(terminal.cols, terminal.rows);
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

function hasAnyParam(params: (number | number[])[], targets: Set<number>): boolean {
  return params.some((param) => {
    if (Array.isArray(param)) {
      return param.some((value) => targets.has(value));
    }
    return targets.has(param);
  });
}

function shouldBlockEraseInDisplayDuringTransition(params: (number | number[])[]): boolean {
  const mode = params[0];
  return mode === 2 || mode === 3;
}

const ALTERNATE_SCREEN_PARAMS = new Set([47, 1047, 1049]);

function clampTerminalFontSize(fontSize: number): number {
  return Math.max(6, Math.min(100, fontSize));
}

function getHexLuminance(color: string): number {
  const normalized = color.replace("#", "").trim();
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return 1;
  }

  const channels = [0, 2, 4].map((start) => {
    const value = parseInt(normalized.slice(start, start + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function resolveAppIsDarkForTerminal(
  appBackgroundColor: "system" | "light" | "dark" | "custom",
  appColorPalette: AppColorPalette,
  systemPrefersDark: boolean
): boolean {
  if (appBackgroundColor === "custom") {
    const color = appColorPalette.color ?? appColorPalette.background ?? appColorPalette.primary ?? DEFAULT_APP_COLOR_PALETTE.color;
    return getHexLuminance(color) <= 0.42;
  }

  return appBackgroundColor === "dark" || (appBackgroundColor === "system" && systemPrefersDark);
}

function getEffectiveFontSizeForSession(
  sessionId: string,
  globalFontSize: number,
  paneFontSizeOverrides: Record<string, number>
): number {
  const paneId = usePanesStore.getState().getPaneIdBySession(sessionId);
  if (!paneId) return globalFontSize;

  return paneFontSizeOverrides[paneId] ?? globalFontSize;
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

void extractCommand;

function isTerminalConnector(connector: SessionConnector | undefined): connector is ITerminalConnector {
  return connector !== undefined && connector.protocol !== "rdp" && connector.protocol !== "vnc";
}

export function TerminalViewClass(props: BaseSessionViewProps) {
  const { t } = useI18n();
  const { paneId, sessionId } = props;
  const acAddonRef = useRef<AutocompleteTerminalAddon | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  // Terminal 特有状态
  const { sessions } = useTabsStore();
  const reconnectSession = useTabsStore((s) => s.reconnectSession);
  const { addCommand: addHistoryCommand } = useHistoryStore();
  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const terminalNormalFontWeight = useSettingsStore((state) => state.terminalNormalFontWeight);
  const terminalBoldFontWeight = useSettingsStore((state) => state.terminalBoldFontWeight);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const terminalCursorStyle = useSettingsStore((state) => state.terminalCursorStyle);
  const customThemes = useSettingsStore((state) => state.customThemes);
  const terminalBackgroundMode = useSettingsStore((state) => state.terminalBackgroundMode);
  const terminalBackgroundColor = useSettingsStore((state) => state.terminalBackgroundColor);
  const terminalOpacity = useSettingsStore((state) => state.terminalOpacity);
  const appBackgroundColor = useSettingsStore((state) => state.appBackgroundColor);
  const appColorPalette = useSettingsStore((state) => state.appColorPalette ?? DEFAULT_APP_COLOR_PALETTE);
  const backgroundImageEnabled = useSettingsStore((state) => state.backgroundImageEnabled);
  const backgroundImage = useSettingsStore((state) => state.backgroundImage);
  const terminalAutocomplete = useSettingsStore((state) => state.terminalAutocomplete);
  const terminalRightClickBehavior = useSettingsStore((state) => state.terminalRightClickBehavior);
  const [terminalContextMenuOpen, setTerminalContextMenuOpen] = useState(false);
  const paneFontSizeOverrides = usePanesStore((state) => state.paneFontSizeOverrides);
  const setPaneFontSizeOverride = usePanesStore((state) => state.setPaneFontSizeOverride);
  const effectiveFontSize = paneFontSizeOverrides[paneId] ?? fontSize;
  const appIsDark = resolveAppIsDarkForTerminal(appBackgroundColor, appColorPalette, systemPrefersDark);

  // 使用全局缓存替代组件级别的 ref，确保切换 tab 时输出历史不丢失
  const containerMap = useRef(globalContainerCache);
  const terminalMap = useRef(globalTerminalCache);
  const lastCommandRef = useRef<string>("");
  const addHistoryCommandRef = useRef(addHistoryCommand);
  const setPaneFontSizeOverrideRef = useRef(setPaneFontSizeOverride);
  const appearanceRef = useRef({
    fontSize: effectiveFontSize,
    fontFamily,
    terminalNormalFontWeight,
    terminalBoldFontWeight,
    terminalColorScheme,
    terminalCursorStyle,
    customThemes,
    terminalBackgroundMode,
    terminalBackgroundColor,
    terminalOpacity,
    appIsDark,
    hasBackgroundImage: !!(backgroundImageEnabled && backgroundImage),
  });

  const activeSession = sessions.find((s) => s.id === sessionId);
  const activeConnector = isTerminalConnector(activeSession?.connector) ? activeSession.connector : undefined;
  const hasBackgroundImage = backgroundImageEnabled && backgroundImage;

  addHistoryCommandRef.current = addHistoryCommand;
  setPaneFontSizeOverrideRef.current = setPaneFontSizeOverride;
  appearanceRef.current = {
    fontSize: effectiveFontSize,
    fontFamily,
    terminalNormalFontWeight,
    terminalBoldFontWeight,
    terminalColorScheme,
    terminalCursorStyle,
    customThemes,
    terminalBackgroundMode,
    terminalBackgroundColor,
    terminalOpacity,
    appIsDark,
    hasBackgroundImage: !!hasBackgroundImage,
  };

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(media.matches);
    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

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
    if (existingInstance?.connector === connector) {
      acAddonRef.current = existingInstance.acAddon ?? null;
      activateTerminal(sessionId);
      return;
    }

    let isMounted = true;
    let tempBuffer = "";
    let currentTermInstance: TerminalInstance | null = null;
    let isCurrentConnector = true;

    const setupEarlyListener = async () => {
      return await connector.onData((data) => {
        if (!isCurrentConnector) return;
        if (currentTermInstance) {
          currentTermInstance.output.write(data);
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
        existingInstance.dataUnsubscribe?.();
        existingInstance.dataUnsubscribe = () => {
          isCurrentConnector = false;
          unsubPromise.then((unsub: unknown) => {
            if (typeof unsub === "function") unsub();
          });
        };

        if (tempBuffer) {
          existingInstance.output.write(tempBuffer);
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

        existingInstance.output.write(
          connector.protocol === "serial"
            ? [
                "\r\n",
                `\x1b[33m${t("串口正在重新连接...")}\x1b[0m`,
                "\r\n\r\n",
              ].join("")
            : [
                "\r\n",
                `\x1b[33m${t("SSH 已断开，已切换到本地终端。")}\x1b[0m`,
                `\r\n\x1b[90m${t("之前的 SSH 输出已保留。")}\x1b[0m`,
                "\r\n\r\n",
              ].join("")
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
          existingInstance.output.write(tempBuffer);
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
        terminalNormalFontWeight: nextTerminalNormalFontWeight,
        terminalBoldFontWeight: nextTerminalBoldFontWeight,
        terminalColorScheme: nextTerminalColorScheme,
        terminalCursorStyle: nextTerminalCursorStyle,
        customThemes: nextCustomThemes,
        terminalBackgroundMode: nextTerminalBackgroundMode,
        terminalBackgroundColor: nextTerminalBackgroundColor,
        terminalOpacity: nextTerminalOpacity,
        appIsDark: nextAppIsDark,
        hasBackgroundImage: nextHasBackgroundImage,
      } = appearanceRef.current;
      const colorScheme = getResolvedTerminalTheme(
        nextTerminalColorScheme,
        nextCustomThemes,
        nextTerminalBackgroundMode,
        nextTerminalBackgroundColor,
        nextAppIsDark
      );
      const term = new Terminal({
        fontFamily: nextFontFamily,
        fontSize: nextFontSize,
        fontWeight: nextTerminalNormalFontWeight,
        fontWeightBold: nextTerminalBoldFontWeight,
        cursorBlink: true,
        cursorStyle: nextTerminalCursorStyle,
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
        if (termState.isTransitioning && shouldBlockEraseInDisplayDuringTransition(params)) return true;
        return false;
      });

      term.parser.registerCsiHandler({ final: "H" }, () => {
        if (termState.isTransitioning) return true;
        return false;
      });

      term.parser.registerCsiHandler({ final: "f" }, () => {
        if (termState.isTransitioning) return true;
        return false;
      });

      term.parser.registerCsiHandler({ final: "d" }, () => {
        if (termState.isTransitioning) return true;
        return false;
      });

      term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
        if (termState.isTransitioning && hasAnyParam(params, ALTERNATE_SCREEN_PARAMS)) return true;
        return false;
      });

      term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
        if (termState.isTransitioning && hasAnyParam(params, ALTERNATE_SCREEN_PARAMS)) return true;
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
      const output = new OrderedTerminalOutput(term);

      const pasteElement = term.textarea;
      const pasteHandler = (event: ClipboardEvent) => {
        const currentProtocol = terminalMap.current.get(sessionId)?.connector?.protocol;
        if (currentProtocol !== "ssh") return;

        const text = event.clipboardData?.getData("text/plain");
        if (!text) return;

        event.preventDefault();
        term.paste(normalizePasteTextForConnector(text, currentProtocol));
      };

      pasteElement?.addEventListener("paste", pasteHandler);

      try {
        syncTerminalDimensions(term, fitAddon, connector);
      } catch (e) {
        logger.warn("FE/terminal-view/fit", "Initial fit failed", { e });
      }

      const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
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
            const command = extractTerminalCommand(rawText);

            if (command && command.length > 0 && command !== lastCommandRef.current) {
              addHistoryCommandRef.current(command);
              lastCommandRef.current = command;
            }
          }
        }
      });

      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey) {
          return true;
        }

        const key = event.key.toLowerCase();
        if (key === "c") {
          if (!term.hasSelection()) {
            return true;
          }

          event.preventDefault();
          void writeText(term.getSelection()).catch((error) => {
            logger.error("FE/terminal-view/clipboard", "Copy shortcut failed", { error });
          });
          return false;
        }

        if (key === "v") {
          event.preventDefault();
          void readText()
            .then((text) => {
              const currentConnector = terminalMap.current.get(sessionId)?.connector ?? connector;
              if (text && currentConnector) {
                currentConnector.write(normalizePasteTextForConnector(text, currentConnector.protocol));
              }
            })
            .catch((error) => {
              logger.error("FE/terminal-view/clipboard", "Paste shortcut failed", { error });
            });
          return false;
        }

        return true;
      });

      const selectionDisposable = term.onSelectionChange(async () => {
        if (useSettingsStore.getState().copyOnSelect && term.hasSelection()) {
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
        output,
        fitAddon,
        resizeObserver,
        connector,
        inputDisposable,
        parserDisposables,
        dataUnsubscribe,
        pasteElement,
        pasteHandler,
        termState,
        webglAddon,
        acAddon,

        dispose: () => {
          dataUnsubscribe();
          connector?.close();
          containerEl.removeEventListener("wheel", handleWheel, { capture: true });
          pasteElement?.removeEventListener("paste", pasteHandler);
          inputDisposable.dispose();
          parserDisposables.forEach((disposable) => disposable.dispose());
          keyDisposable.dispose();
          selectionDisposable.dispose();
          resizeObserver.disconnect();
          if (termState.timeoutId) clearTimeout(termState.timeoutId);
          if (termState.resizeTimeoutId) clearTimeout(termState.resizeTimeoutId);
          if (webglAddon) webglAddon.dispose();
          if (instance.acAddon) instance.acAddon.dispose();
          output.dispose();
          term.dispose();
        },
      };

      terminalMap.current.set(sessionId, instance);

      currentTermInstance = instance;
      if (tempBuffer) {
        output.write(tempBuffer);
        tempBuffer = "";
      }

      activateTerminal(sessionId);
    };

    initTerminal();

    return () => {
      isMounted = false;
      if (!currentTermInstance) {
        isCurrentConnector = false;
        unsubPromise.then((unsub: unknown) => {
          if (typeof unsub === "function") unsub();
        });
      }
    };
  }, [sessionId, activeConnector, activateTerminal]);

  // 监听设置变化
  useEffect(() => {
    const colorScheme = getResolvedTerminalTheme(
      terminalColorScheme,
      customThemes,
      terminalBackgroundMode,
      terminalBackgroundColor,
      appIsDark
    );
    terminalMap.current.forEach((instance, id) => {
      const { terminal, fitAddon, connector, termState } = instance;
      const nextFontSize = getEffectiveFontSizeForSession(id, fontSize, paneFontSizeOverrides);

      terminal.options.fontSize = nextFontSize;
      terminal.options.fontFamily = fontFamily;
      terminal.options.fontWeight = terminalNormalFontWeight;
      terminal.options.fontWeightBold = terminalBoldFontWeight;
      terminal.options.cursorStyle = terminalCursorStyle;
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
                // 防抖期间布局可能继续变化，发送执行时 xterm 的最终尺寸，避免旧尺寸覆盖新尺寸。
                connector.resize?.(terminal.cols, terminal.rows);
              }, 300);
            }
            terminal.focus();
          } catch (e) {
            logger.warn("FE/terminal-view/fit", "Terminal fit failed after settings change", { e });
          }
        });
      }
    });
  }, [fontSize, paneFontSizeOverrides, fontFamily, terminalNormalFontWeight, terminalBoldFontWeight, terminalColorScheme, terminalCursorStyle, customThemes, terminalBackgroundMode, terminalBackgroundColor, terminalOpacity, appBackgroundColor, appIsDark, systemPrefersDark, sessionId, hasBackgroundImage, terminalAutocomplete]);

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

  const copyTerminalSelection = async (clearSelection = false) => {
    const instance = terminalMap.current.get(sessionId);
    if (!instance?.terminal.hasSelection()) return;

    try {
      await writeText(instance.terminal.getSelection());
      if (clearSelection) {
        instance.terminal.clearSelection();
      }
    } catch (error) {
      logger.error("FE/terminal-view/clipboard", "Failed to copy terminal selection", { error });
    }
  };

  const pasteTerminalClipboard = async () => {
    if (!activeSession?.connector || !isTerminalConnector(activeSession.connector)) return;

    try {
      const text = await readText();
      if (text) {
        activeSession.connector.write(
          normalizePasteTextForConnector(text, activeSession.connector.protocol)
        );
      }
    } catch (error) {
      logger.error("FE/terminal-view/clipboard", "Failed to paste terminal clipboard", { error });
    }
  };

  // 快捷复制/粘贴模式：有选区时复制并清除，否则粘贴。
  const handleQuickCopyPaste = async (e: React.MouseEvent) => {
    e.preventDefault();

    if (!sessionId || !activeSession?.connector || !isTerminalConnector(activeSession.connector)) return;

    const instance = terminalMap.current.get(sessionId);
    if (!instance) return;

    if (instance.terminal.hasSelection()) {
      await copyTerminalSelection(true);
    } else {
      await pasteTerminalClipboard();
    }
  };

  const handleTerminalWheel = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    if (!event.ctrlKey) return;

    event.preventDefault();
    event.stopPropagation();

    const instance = terminalMap.current.get(sessionId);
    const currentSize = Number(instance?.terminal.options.fontSize) || useSettingsStore.getState().fontSize;
    const delta = event.deltaY > 0 ? -1 : 1;
    setPaneFontSizeOverrideRef.current(paneId, clampTerminalFontSize(currentSize + delta));
  }, [paneId, sessionId]);

  const currentTheme = getResolvedTerminalTheme(
    terminalColorScheme,
    customThemes,
    terminalBackgroundMode,
    terminalBackgroundColor,
    appIsDark
  );
  const xtermTheme = toXtermTheme(currentTheme, terminalOpacity);

  if (!activeSession) {
    return null;
  }

  const connectionProtocol = activeSession.type === "ai-cli"
    ? "AI CLI"
    : activeSession.type.toUpperCase();
  const connectionTarget = activeSession.type === "ssh" && activeSession.config?.sshConfig
    ? `${activeSession.config.sshConfig.host}:${activeSession.config.sshConfig.port || 22}`
    : activeSession.type === "telnet" && activeSession.config?.telnetConfig
      ? `${activeSession.config.telnetConfig.host}:${activeSession.config.telnetConfig.port || 23}`
      : activeSession.type === "serial" && activeSession.config?.serialConfig
        ? activeSession.config.serialConfig.port
        : activeSession.host || activeSession.title;

  // 渲染内容（对应基类的 renderContent 抽象方法）
  const terminalView = (
    <main
      className={cn(
        VIEW_CONTAINER_CLASSNAME, 
        "bg-(--terminal-shell)",
        activeSession?.type === "ai-cli" && "is-ai-cli-mode"
      )}
      onClick={() => activateTerminal(sessionId)}
      onWheelCapture={handleTerminalWheel}
      onContextMenu={terminalRightClickBehavior === "quick-copy-paste" ? handleQuickCopyPaste : undefined}
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
              // 分屏结构变化会重建容器，尺寸监听必须跟随终端迁移到新容器。
              cachedInstance.resizeObserver.disconnect();
              cachedInstance.resizeObserver.observe(el);
              // 同步 xterm 与远端 PTY 的行列数，避免两端宽度不一致导致长命令覆盖。
              requestAnimationFrame(() => {
                try {
                  syncTerminalDimensions(
                    cachedInstance.terminal,
                    cachedInstance.fitAddon,
                    cachedInstance.connector
                  );
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
      <ConnectionStatusOverlay
        status={activeSession.connectionStatus}
        protocol={connectionProtocol}
        target={connectionTarget}
        details={activeSession.type === "ssh" && activeSession.config?.sshConfig
          ? [{ label: t("用户名"), value: activeSession.config.sshConfig.username }]
          : undefined}
        onReconnect={activeSession.type === "local" ? undefined : () => reconnectSession(sessionId)}
      />
    </main>
  );

  if (terminalRightClickBehavior === "quick-copy-paste") {
    return terminalView;
  }

  const hasTerminalSelection = terminalContextMenuOpen
    && (terminalMap.current.get(sessionId)?.terminal.hasSelection() ?? false);

  return (
    <ContextMenu onOpenChange={setTerminalContextMenuOpen}>
      <ContextMenuTrigger asChild>
        {terminalView}
      </ContextMenuTrigger>
      <ContextMenuContent
        className="min-w-52 text-xs"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          activateTerminal(sessionId);
        }}
      >
        <ContextMenuItem
          className="py-1.5 text-xs"
          disabled={!hasTerminalSelection}
          onSelect={() => { void copyTerminalSelection(); }}
        >
          {t("复制所选内容")}
          <ContextMenuShortcut>Ctrl+Shift+C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          className="py-1.5 text-xs"
          onSelect={() => { void pasteTerminalClipboard(); }}
        >
          {t("粘贴剪贴板")}
          <ContextMenuShortcut>Ctrl+Shift+V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="py-1.5 text-xs"
          onSelect={() => terminalMap.current.get(sessionId)?.terminal.selectAll()}
        >
          {t("全选终端内容")}
        </ContextMenuItem>
        <ContextMenuItem
          className="py-1.5 text-xs"
          disabled={!hasTerminalSelection}
          onSelect={() => terminalMap.current.get(sessionId)?.terminal.clearSelection()}
        >
          {t("清除选区")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
