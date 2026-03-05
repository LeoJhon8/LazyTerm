import { useEffect, useRef } from "react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { useHistoryStore } from "@/store/history";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager"; 
import "@xterm/xterm/css/xterm.css";

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  resizeObserver: ResizeObserver;
  dispose: () => void;
}

export function TerminalView() {
  const { activeSessionId, sessions } = useTabsStore();
  const { addCommand: addHistoryCommand } = useHistoryStore();
  const { fontSize, fontFamily, theme } = useSettingsStore();

  const containerMap = useRef(new Map<string, HTMLDivElement>());
  const terminalMap = useRef(new Map<string, TerminalInstance>());
  const lastCommandRef = useRef<string>("");

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // --- 逻辑 1：处理终端的初始化 ---
  useEffect(() => {
    if (!activeSessionId || !activeSession || !activeSession.connector) return;
    if (terminalMap.current.has(activeSessionId)) return;

    const { connector } = activeSession;
    const containerEl = containerMap.current.get(activeSessionId);
    if (!containerEl) return;

    let isMounted = true;

    const initTerminal = async () => {
      while (!connector.isConnected && isMounted) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!isMounted || !connector.isConnected) return;

      const term = new Terminal({
        fontFamily: fontFamily || "monospace",
        fontSize: fontSize || 14,
        theme: {
          background: theme === "light" ? "#ffffff" : "#1e1e1e",
          foreground: theme === "light" ? "#333333" : "#cccccc",
          cursor: theme === "light" ? "#007acc" : "#528bff",
          cursorAccent: theme === "light" ? "#ffffff" : "#1e1e1e",
          selectionBackground: "rgba(82, 139, 255, 0.4)",
        },
        cursorBlink: true,
        cursorStyle: "bar",
        cursorWidth: 2,
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

      const unbindData = await connector.onData((data) => {
        term.write(data);
      });

      // 原生自动复制
      const selectionDisposable = term.onSelectionChange(async () => {
        if (term.hasSelection()) {
          const selection = term.getSelection();
          if (selection) {
            try {
              await writeText(selection);
            } catch (e) {
              console.error("Native copy failed", e);
            }
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
        dispose: () => {
          dataDisposable.dispose();
          keyDisposable.dispose();
          selectionDisposable.dispose();
          unbindData();
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
  }, [activeSessionId, activeSession, fontFamily, fontSize, theme, addHistoryCommand]);

  // --- 逻辑 2：处理 Tab 切换聚焦 ---
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

  // --- 逻辑 4：窗口大小刷新 ---
  useEffect(() => {
    const handleGlobalResize = () => {
      if (!activeSessionId) return;
      terminalMap.current.get(activeSessionId)?.fitAddon.fit();
    };
    window.addEventListener("resize", handleGlobalResize);
    return () => window.removeEventListener("resize", handleGlobalResize);
  }, [activeSessionId]);

  // --- 逻辑 5：右键点击处理 (原生粘贴) ---
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!activeSessionId || !activeSession?.connector) return;

    const instance = terminalMap.current.get(activeSessionId);
    if (!instance) return;

    const { terminal: term } = instance;

    if (term.hasSelection()) {
      term.clearSelection();
    } else {
      try {
        // 使用 Tauri v2 原生读取
        const text = await readText();
        if (text) {
          activeSession.connector.write(text);
        }
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