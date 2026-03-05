import { useEffect, useRef } from "react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { useHistoryStore } from "@/store/history";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

// 定义存储在 Map 中的终端实例接口
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

  // 引用容器和实例
  const containerMap = useRef(new Map<string, HTMLDivElement>());
  const terminalMap = useRef(new Map<string, TerminalInstance>());
  const lastCommandRef = useRef<string>("");

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // --- 逻辑 1：处理终端的初始化 (仅在实例不存在时执行) ---
  useEffect(() => {
    // 类型守卫：确保 activeSessionId 和相关对象存在
    if (!activeSessionId || !activeSession || !activeSession.connector) return;
    
    // 如果该 session 已经有终端实例了，不执行初始化
    if (terminalMap.current.has(activeSessionId)) return;

    const { connector } = activeSession;
    const containerEl = containerMap.current.get(activeSessionId);
    if (!containerEl) return;

    let isMounted = true;

    const initTerminal = async () => {
      // 1. 等待连接就绪
      while (!connector.isConnected && isMounted) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!isMounted || !connector.isConnected) return;

      // 2. 创建实例
      const term = new Terminal({
        fontFamily: fontFamily || "monospace",
        fontSize: fontSize || 14,
        theme: {
          background: theme === "light" ? "#ffffff" : "#1e1e1e",
          foreground: theme === "light" ? "#333333" : "#cccccc",
          // --- 优化光标颜色 ---
          cursor: theme === "light" ? "#007acc" : "#528bff", // 类似 VS Code 的蓝色光标
          cursorAccent: theme === "light" ? "#ffffff" : "#1e1e1e", // 光标重叠处的文字颜色
        },
        cursorBlink: true,       // 启用光标闪烁
        cursorStyle: "bar",      // 修改样式：'block' (方块), 'underline' (下划线), 'bar' (竖线)
        cursorWidth: 2,          // 当样式为 'bar' 时，光标的宽度
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

      // 3. 挂载到 DOM
      term.open(containerEl);

      // 4. 绑定数据流 (Terminal -> Connector)
      const dataDisposable = term.onData((data) => {
        connector.write(data);
      });

      // 5. 绑定命令历史记录
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

      // 6. 绑定数据流 (Connector -> Terminal)
      const connectorDisposable = await connector.onData((data) => {
        term.write(data);
      });

      // 7. 响应式布局
      const resizeObserver = new ResizeObserver(() => {
        if (containerEl.clientWidth > 0 && containerEl.clientHeight > 0) {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) connector.resize(dims.cols, dims.rows);
        }
      });
      resizeObserver.observe(containerEl);

      // 8. 存储到 Map 中以便复用
      terminalMap.current.set(activeSessionId, {
        terminal: term,
        fitAddon,
        resizeObserver,
        dispose: () => {
          dataDisposable.dispose();
          keyDisposable.dispose();
          connectorDisposable?.dispose?.(); 
          resizeObserver.disconnect();
          term.dispose();
        },
      });

      // 初始渲染
      requestAnimationFrame(() => {
        fitAddon.fit();
        term.focus();
      });
    };

    initTerminal();
  }, [activeSessionId, activeSession, fontFamily, fontSize, theme, addHistoryCommand]);

  // --- 逻辑 2：处理 Tab 切换时的聚焦和尺寸刷新 ---
  useEffect(() => {
    // 修复：确保 activeSessionId 不为 null
    if (!activeSessionId) return;

    const instance = terminalMap.current.get(activeSessionId);
    if (instance) {
      // 必须在 requestAnimationFrame 中执行，确保 DOM 的 'hidden' 类已经移除，容器有了尺寸
      requestAnimationFrame(() => {
        instance.fitAddon.fit();
        instance.terminal.focus();
      });
    }
  }, [activeSessionId]);

  // --- 逻辑 3：清理已关闭会话的内存 ---
  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));
    terminalMap.current.forEach((instance, id) => {
      if (!currentIds.has(id)) {
        instance.dispose();
        terminalMap.current.delete(id);
      }
    });
  }, [sessions]);

  // --- 逻辑 4：窗口大小改变时刷新当前终端 ---
  useEffect(() => {
    const handleGlobalResize = () => {
      // 修复：确保 activeSessionId 不为 null
      if (!activeSessionId) return;

      const instance = terminalMap.current.get(activeSessionId);
      if (instance) {
        instance.fitAddon.fit();
      }
    };
    window.addEventListener("resize", handleGlobalResize);
    return () => window.removeEventListener("resize", handleGlobalResize);
  }, [activeSessionId]);

  // 空状态渲染
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
      id="slot-mid-main"
      className="relative h-full w-full overflow-hidden"
      style={{
        gridArea: "mid-main",
        backgroundColor: theme === "light" ? "#ffffff" : "#1e1e1e",
      }}
      onClick={() => {
        // 修复：确保 activeSessionId 不为 null
        if (activeSessionId) {
          const instance = terminalMap.current.get(activeSessionId);
          instance?.terminal.focus();
        }
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