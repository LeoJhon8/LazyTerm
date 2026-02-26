import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

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
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private resizeObserver: ResizeObserver;
  private sessionId: string | null = null;
  private isConnected = false;
  private resizeDebounceTimer: number | null = null;

  constructor(
    private container: HTMLElement,
    options: any = {}
  ) {
    this.terminal = new Terminal({
      theme: DEFAULT_THEME,
      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.1,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowProposedApi: true,
      ...options,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    this.setupTerminalEvents();
    this.terminal.open(container);

    this.resizeObserver = new ResizeObserver(() => this.debouncedFit());
    this.resizeObserver.observe(container);

    this.safeFit();
    console.log('[XtermWrapper] Constructor completed, terminal opened');
  }

  private setupTerminalEvents(): void {
    this.terminal.onData((data: string) => {
      console.log(`[XtermWrapper] Input captured:`, JSON.stringify(data));
      if (this.isConnected && this.sessionId) {
        console.log(`[XtermWrapper] Sending to PTY session ${this.sessionId}`);
        (globalThis as any).electronAPI.ptyWrite(this.sessionId, data);
      } else {
        console.warn(
          `[XtermWrapper] Not connected or no sessionId (connected=${this.isConnected}, sessionId=${this.sessionId})`
        );
      }
    });

    this.terminal.onResize((size: { cols: number; rows: number }) => {
      if (this.isConnected && this.sessionId) {
        (globalThis as any).electronAPI.ptyResize(this.sessionId, size.cols, size.rows);
      }
    });
  }

  private debouncedFit(): void {
    if (this.resizeDebounceTimer) {
      window.clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeDebounceTimer = window.setTimeout(() => {
      this.safeFit();
    }, 100);
  }

  private safeFit(): void {
    try {
      if (this.container.offsetWidth > 0 && this.container.offsetHeight > 0) {
        this.fitAddon.fit();
      }
    } catch (e) {
      console.warn('[XtermWrapper] Fit failed:', e);
    }
  }

  setSession(sessionId: string): void {
    console.log(`[XtermWrapper] Setting sessionId to ${sessionId}`);
    this.sessionId = sessionId;
  }

  connect(): void {
    console.log(`[XtermWrapper] Connecting with sessionId=${this.sessionId}`);
    this.isConnected = true;
    this.safeFit();
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

  resize(cols: number, rows: number): void {
    try {
      this.terminal.resize(cols, rows);
    } catch (e) {
      console.warn('[XtermWrapper] Resize failed:', e);
    }
  }

  focus(): void {
    console.log('[XtermWrapper] Focusing terminal');
    this.terminal.focus();
  }

  blur(): void {
    this.terminal.blur();
  }

  setFontSize(size: number): void {
    if (this.terminal.options.fontSize !== size) {
      this.terminal.options.fontSize = size;
      this.refit();
    }
  }

  refit(): void {
    this.safeFit();
  }

  get cols(): number {
    return this.terminal.cols;
  }

  get rows(): number {
    return this.terminal.rows;
  }

  get isActive(): boolean {
    return this.terminal.textarea === document.activeElement;
  }

  dispose(): void {
    this.isConnected = false;
    if (this.resizeDebounceTimer) {
      window.clearTimeout(this.resizeDebounceTimer);
    }
    this.resizeObserver.disconnect();
    this.fitAddon.dispose();
    this.terminal.dispose();
    (this as any).container = null;
  }

  destroy(): void {
    this.dispose();
  }
}

export default XtermWrapper;
