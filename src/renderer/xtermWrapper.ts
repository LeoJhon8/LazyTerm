// 建议：如果通过 npm 安装了 xterm，请使用 import type
// import { Terminal } from '@xterm/xterm';

const Terminal = (globalThis as any).Terminal;
const FitAddon = (globalThis as any).FitAddon;

/** 默认终端主题配置 */
const DEFAULT_THEME = {
  background: '#1e1e1e',
  foreground: '#f0f0f0',
  cursor: '#f0f0f0',
  selectionBackground: '#333333',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

export class XtermWrapper {
  private terminal: any;
  private fitAddon: any;
  private resizeObserver: ResizeObserver;
  private sessionId: string | null = null;
  private isConnected = false;
  private resizeDebounceTimer: number | null = null;

  constructor(private container: HTMLElement, options: any = {}) {
    this.terminal = new Terminal({
      theme: DEFAULT_THEME,
      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.1,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000, // 增加回滚行数
      allowProposedApi: true,
      ...options,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // 初始化事件处理
    this.setupTerminalEvents();

    // 渲染终端
    this.terminal.open(container);
    
    // 使用 ResizeObserver 监听容器大小变化
    this.resizeObserver = new ResizeObserver(() => this.debouncedFit());
    this.resizeObserver.observe(container);

    // 初始自适应
    this.safeFit();
  }

  /**
   * 设置终端核心事件
   */
  private setupTerminalEvents(): void {
    // 处理用户输入输入
    this.terminal.onData((data: string) => {
      if (this.isConnected && this.sessionId) {
        (globalThis as any).electronAPI.ptyWrite(this.sessionId, data);
      }
    });

    // 处理终端内部 Resize
    this.terminal.onResize((size: { cols: number; rows: number }) => {
      if (this.isConnected && this.sessionId) {
        (globalThis as any).electronAPI.ptyResize(this.sessionId, size.cols, size.rows);
      }
    });
  }

  /**
   * 防抖的 Fit 处理，防止 UI 抖动和 PTY 性能损耗
   */
  private debouncedFit(): void {
    if (this.resizeDebounceTimer) {
      window.clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeDebounceTimer = window.setTimeout(() => {
      this.safeFit();
    }, 100); // 100ms 防抖
  }

  /**
   * 安全地执行适配逻辑
   */
  private safeFit(): void {
    try {
      // 如果容器被隐藏（如切换到了其他 Tab），fit() 会失效，需加保护
      if (this.container.offsetWidth > 0 && this.container.offsetHeight > 0) {
        this.fitAddon.fit();
      }
    } catch (e) {
      console.warn('[XtermWrapper] Fit failed:', e);
    }
  }

  // --- 公共 API ---

  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  connect(): void {
    this.isConnected = true;
    this.safeFit(); // 连接时立即适配一次
  }

  disconnect(): void {
    this.isConnected = false;
  }

  write(data: string): void {
    if (data !== undefined && data !== null) {
      this.terminal.write(data);
    }
  }

  writeln(data: string): void {
    this.terminal.writeln(data);
  }

  clear(): void {
    this.terminal.clear();
  }

  focus(): void {
    this.terminal.focus();
  }

  blur(): void {
    this.terminal.blur();
  }

  /**
   * 动态设置字体大小
   */
  setFontSize(size: number): void {
    if (this.terminal.options.fontSize !== size) {
      this.terminal.options.fontSize = size;
      this.debouncedFit();
    }
  }

  /**
   * 彻底销毁资源
   */
  dispose(): void {
    this.isConnected = false;
    if (this.resizeDebounceTimer) {
      window.clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeObserver.disconnect();
    this.fitAddon.dispose();
    this.terminal.dispose();
    // 移除容器引用，防止闭包导致无法 GC
    (this as any).container = null;
  }

  // 别名，兼容部分旧代码
  destroy(): void {
    this.dispose();
  }
}

export default XtermWrapper;