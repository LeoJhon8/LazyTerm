import { useEffect, useRef } from "react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { useHistoryStore } from "@/store/history";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";

export function TerminalView() {
  const { activeSessionId, sessions } = useTabsStore();
  const { addCommand: addHistoryCommand } = useHistoryStore();
  
  // 优化：从 Hook 中解构设置，这样设置改变时 UI 会自动刷新
  const { fontSize, fontFamily, theme } = useSettingsStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const commandBufferRef = useRef<string>(""); // 缓存当前输入的命令
  const lastCommandRef = useRef<string>(""); // 记录上一条命令，用于去重

  const activeSession = sessions.find(session => session.id === activeSessionId);

  // 初始化终端
  useEffect(() => {
    console.log("[TerminalView] useEffect triggered for session:", activeSessionId);
    
    // 1. 基础检查
    if (!containerRef.current || !activeSession || !activeSession.connector) {
      console.log("[TerminalView] Waiting for valid session and connector", {
        hasContainer: !!containerRef.current,
        hasSession: !!activeSession,
        hasConnector: !!activeSession?.connector,
        sessionId: activeSession?.connector ? "exists" : "missing"
      });
      return;
    }

    // 清理之前的终端实例（如果有）
    if (terminalRef.current) {
      console.log("[TerminalView] Disposing previous terminal instance");
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    if (fitAddonRef.current) {
      fitAddonRef.current = null;
    }

    const { connector } = activeSession;
    let isMounted = true;
    let cleanupFn: (() => void) | null = null;

    console.log("[TerminalView] Starting terminal initialization");

    // 2. 等待 connector 的 sessionId 就绪
    const waitForSessionId = async () => {
      // 轮询等待 sessionId 可用，没有超时限制，直到连接建立
      while (!connector.isConnected && isMounted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!isMounted || !connector.isConnected) {
        console.log("[TerminalView] Connector not ready or unmounted");
        return;
      }

      console.log("[TerminalView] Session ID ready, initializing terminal");

      const terminal = new Terminal({
        fontFamily: fontFamily || "monospace",
        fontSize: fontSize || 14,
        theme: {
          background: theme === "light" ? "#ffffff" : "#1e1e1e",
          foreground: theme === "light" ? "#333333" : "#cccccc",
        },
        cursorBlink: true,
        scrollback: 10000,
        tabStopWidth: 4,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      
      try {
        const webglAddon = new WebglAddon();
        terminal.loadAddon(webglAddon);
      } catch (error) {
        console.warn("WebGL addon failed to load:", error);
      }

      // 确保 container 存在且可见
      if (!containerRef.current) {
        console.error("[TerminalView] Container ref is null after waiting");
        return;
      }

      // 检查容器尺寸
      const rect = containerRef.current.getBoundingClientRect();
      console.log("[TerminalView] Container dimensions:", rect.width, "x", rect.height);

      terminal.open(containerRef.current);
      
      // 确保 DOM 计算完成后再 fit
      requestAnimationFrame(() => {
        fitAddon.fit();
      });

      // 使用 ResizeObserver 监听容器尺寸变化
      const resizeObserver = new ResizeObserver(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit();
        }
      });
      resizeObserver.observe(containerRef.current);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // 记录历史命令：监听用户的输入
      let currentInput = "";
      const { dispose: disposeDataListener } = terminal.onData((data) => {
        connector.write(data);
        
        // 调试：查看接收到的数据
        console.log("[TerminalView] onData received:", JSON.stringify(data));
        
        // 解析用户输入，记录命令历史
        if (data === "\r" || data === "\n") {
          // 回车键或换行键，发送命令
          const trimmedInput = currentInput.trim();
          console.log("[TerminalView] Command entered:", trimmedInput);
          if (trimmedInput && trimmedInput !== lastCommandRef.current) {
            console.log("[TerminalView] Adding to history:", trimmedInput);
            addHistoryCommand(trimmedInput);
            lastCommandRef.current = trimmedInput;
          }
          currentInput = "";
        } else if (data === "\u007F" || data === "\b" || data === "\x7f") {
          // 退格键
          currentInput = currentInput.slice(0, -1);
        } else if (data.startsWith("\x1b[")) {
          // ANSI 转义序列，忽略（如光标移动、颜色等）
          console.log("[TerminalView] Ignored ANSI escape:", JSON.stringify(data));
        } else if (data.startsWith("\x1b")) {
          // 其他转义序列，忽略
          console.log("[TerminalView] Ignored escape:", JSON.stringify(data));
        } else {
          // 可打印字符，添加到输入缓冲区
          currentInput += data;
        }
      });

      // 连接器数据 -> 写入终端
      try {
        await connector.onData((data) => {
          console.log("[TerminalView] Received data from connector:", data.length, "bytes");
          console.log("[TerminalView] Data preview:", data.substring(0, 100));
          terminal.write(data);
        });
        console.log("[TerminalView] Data listener registered successfully");
      } catch (error) {
        console.error("Failed to setup data listener:", error);
      }

      cleanupFn = () => {
        console.log("[TerminalView] Cleanup for session:", activeSessionId);
        disposeDataListener();
        resizeObserver.disconnect();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    };

    waitForSessionId();

    return () => {
      console.log("[TerminalView] useEffect cleanup for session:", activeSessionId);
      isMounted = false;
      if (cleanupFn) {
        cleanupFn();
      }
    };
  }, [activeSessionId, fontFamily, fontSize, theme, addHistoryCommand]);

  // 适配终端大小
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        
        // 3. 安全访问 connector
        const connector = activeSession?.connector;
        if (connector && connector.isConnected) {
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims) {
            connector.resize(dims.cols, dims.rows);
          }
        }
      }
    };

    window.addEventListener("resize", handleResize);
    const timer = setTimeout(handleResize, 100);
    
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timer);
    };
  }, [activeSession]);

  // 渲染空状态
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

  // 4. 处理 connector 丢失的情况（例如页面刷新后）
  if (!activeSession.connector) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background text-muted-foreground">
        连接已断开，请重新创建会话
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
    >
      <div 
        ref={containerRef} 
        className="h-full w-full"
        style={{
          minHeight: "100%",
          minWidth: "100%",
        }}
      />
    </main>
  );
}