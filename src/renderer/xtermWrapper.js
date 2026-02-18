const Terminal = window.Terminal;
const FitAddon = window.FitAddon;

class XtermWrapper {
  constructor(container, options = {}) {
    this.container = container;
    this.sessionId = null;
    this.isConnected = false;
    this.isWriting = false;

    this.terminal = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#f0f0f0',
        cursor: '#f0f0f0',
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
        brightWhite: '#ffffff'
      },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 1000,
      allowProposedApi: true,
      ...options
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    this.currentPrompt = '❯';
    this.pendingData = '';
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.setupEventHandlers();

    this.terminal.open(container);
    this.fitAddon.fit();
  }

  setupEventHandlers() {
    this.terminal.onData((data) => {
      if (this.isConnected && this.sessionId) {
        window.electronAPI.ptyWrite(this.sessionId, data);
      }
    });

    this.terminal.onResize((size) => {
      if (this.isConnected && this.sessionId) {
        window.electronAPI.ptyResize(this.sessionId, size.cols, size.rows);
      }
    });
  }

  handleResize() {
    if (this.container.clientWidth > 0 && this.container.clientHeight > 0) {
      this.fitAddon.fit();
    }
  }

  setSession(sessionId) {
    this.sessionId = sessionId;
  }

  getSession() {
    return this.sessionId;
  }

  connect() {
    this.isConnected = true;
  }

  disconnect() {
    this.isConnected = false;
  }

  write(data) {
    if (data) {
      this.terminal.write(data);
    }
  }

  writeln(data) {
    if (data) {
      this.terminal.writeln(data);
    }
  }

  clear() {
    this.terminal.clear();
  }

  setPrompt(prompt) {
    this.currentPrompt = prompt || '❯';
  }

  getPrompt() {
    return this.currentPrompt;
  }

  focus() {
    this.terminal.focus();
  }

  blur() {
    this.terminal.blur();
  }

  resize(cols, rows) {
    this.terminal.resize(cols, rows);
  }

  getCols() {
    return this.terminal.cols;
  }

  getRows() {
    return this.terminal.rows;
  }

  setFontSize(size) {
    this.terminal.options.fontSize = size;
    this.fitAddon.fit();
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.fitAddon.dispose();
    this.terminal.dispose();
  }
}

export default XtermWrapper;
