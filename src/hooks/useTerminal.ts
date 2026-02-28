import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

export interface UseTerminalOptions {
  fontFamily?: string;
  fontSize?: number;
  theme?: "light" | "dark";
}

export function useTerminal(options: UseTerminalOptions = {}) {
  const terminalRef = useRef<HTMLDivElement>(null);
  
  // 方案一：将实例作为 State，自动解决 isReady 和 渲染期读取 Ref 的问题
  const [terminalInstance, setTerminalInstance] = useState<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // 解构 options 以便在 useEffect 依赖中使用，避免因对象引用变化导致的重复执行
  const { fontFamily, fontSize, theme } = options;

  useEffect(() => {
    if (!terminalRef.current) return;

    // 1. 创建实例
    const terminal = new Terminal({
      // ... 配置
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    
    // 2. 挂载
    terminal.open(terminalRef.current);
    
    // 3. 将状态更新推迟到下一帧绘制
    const frameId = requestAnimationFrame(() => {
      setTerminalInstance(terminal);
      fitAddonRef.current = fitAddon;
      fitAddon.fit();
    });

    // 4. 清理函数
    return () => {
      cancelAnimationFrame(frameId); // 记得取消异步任务
      terminal.dispose();
      setTerminalInstance(null);
      fitAddonRef.current = null;
    };
  }, [fontFamily, fontSize, theme]); 

  // 使用 useCallback 包裹，依赖项包含 terminalInstance
  const fitTerminal = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  const write = useCallback((data: string) => {
    terminalInstance?.write(data);
  }, [terminalInstance]);

  const clear = useCallback(() => {
    terminalInstance?.clear();
  }, [terminalInstance]);

  return {
    terminalRef,
    isReady: !!terminalInstance, // 衍生变量，不再需要独立的 setIsReady
    fitTerminal,
    write,
    clear,
    // 如果外部真的需要原始实例，可以通过这个访问，因为是 State，渲染期访问是安全的
    instance: terminalInstance, 
  };
}