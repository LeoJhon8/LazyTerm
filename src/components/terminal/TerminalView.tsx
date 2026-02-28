import { useEffect, useRef } from "react";
import { useTabsStore } from "@/store/tabs";
import { useSettingsStore } from "@/store/settings";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";

export function TerminalView() {
  const { activeSessionId, sessions } = useTabsStore();
  
  // 优化：从 Hook 中解构设置，这样设置改变时 UI 会自动刷新
  const { 
    fontSize, fontFamily, theme,
    leftPanelCollapsed, leftPanelWidth,
    rightPanelCollapsed, rightPanelWidth,
    topPanelCollapsed, topPanelHeight,
    bottomPanelCollapsed, bottomPanelHeight
  } = useSettingsStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const activeSession = sessions.find(session => session.id === activeSessionId);

  // 初始化终端
  useEffect(() => {
    // 1. 增加对 connector 的检查
    if (!containerRef.current || !activeSession || !activeSession.connector) return;

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

    terminal.open(containerRef.current);
    
    // 确保 DOM 计算完成后再 fit
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // 2. 此时 connector 已经被上面的 if 保证一定存在
    const { connector } = activeSession;
    
    // 终端输入 -> 发送到连接器
    const { dispose: disposeDataListener } = terminal.onData((data) => {
      connector.write(data);
    });

    // 连接器数据 -> 写入终端
    // 注意：如果是生产环境，建议这里也返回一个 dispose 函数用于清理监听
    connector.onData((data) => {
      terminal.write(data);
    });

    return () => {
      disposeDataListener();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [activeSessionId, fontFamily, fontSize, theme, activeSession]); // 增加 activeSession 依赖

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
      className="absolute inset-0 transition-all duration-200"
      style={{
        marginLeft: leftPanelCollapsed ? 0 : leftPanelWidth,
        marginRight: rightPanelCollapsed ? 0 : rightPanelWidth,
        marginTop: topPanelCollapsed ? 0 : topPanelHeight,
        marginBottom: bottomPanelCollapsed ? 0 : bottomPanelHeight,
      }}
    >
      <div ref={containerRef} className="h-full w-full bg-[#1e1e1e]" />
    </main>
  );
}