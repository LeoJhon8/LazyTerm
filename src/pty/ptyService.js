  const { spawn } = require('child_process');
  const { Client } = require('ssh2');

  let mainWindow;
  const ptySessions = new Map();
  const sshSessions = new Map();
  let ptyIdCounter = 0;
  let sshIdCounter = 0;

  class PTYSession {
    constructor(id, type, params = {}) {
      this.id = id;
      this.type = type;
      this.params = params;
      this.process = null;
      this.pid = null;
      this.active = false;
      this.terminalWin = null;
      this.cols = 80;
      this.rows = 24;
      this.resizeTimeout = null;
    }

    async start(win) {
      this.terminalWin = win;
      this.active = true;
      this.cols = win.cols;
      this.rows = win.rows;

      if (this.type === 'local') {
        const { cols, rows, cwd } = this.params;
        this.cols = cols || 80;
        this.rows = rows || 24;
      }

      this.spawnProcess();
    }

    spawnProcess() {
      const options = {
        name: this.type === 'local' ? (process.platform === 'win32' ? 'cmd.exe' : 'bash') : undefined,
        shell: false,
        cwd: process.env.HOME || process.env.USERPROFILE || process.cwd(),
        env: { ...process.env, TERM: 'xterm-256color' }
      };

      if (this.type === 'local') {
        const pty = require('node-pty');
        this.process = pty.spawn('bash', [], {
          ...options,
          cols: this.cols,
          rows: this.rows,
          cwd: this.params.cwd || process.cwd()
        });

        this.pid = this.process.pid;

        this.process.on('data', (data) => {
          if (this.terminalWin) {
            this.terminalWin.write(data);
          }
        });

        this.process.on('exit', () => {
          this.active = false;
          if (this.terminalWin) {
            this.terminalWin.dispose();
            this. this.terminalWin = null;
          }
        });

      } else if (this.type === 'ssh') {
        this.setupSSH();
      }
    }

    setupSSH() {
      const { host, port, user, password, keyPath } = this.params;

      if (password) {
        const conn = new Client();
        conn.on('ready', () => {
          conn.shell((err, stream) => {
            if (err) {
              console.error('SSH shell failed:', err);
              return;
            }
            this.stream = stream;
            this.active = true;

            if (this.terminalWin) {
              stream.on('data', (data) => {
                this.terminalWin.write(data);
              });
              stream.on('resize', ({ rows, cols }) => {
                this.resizeStream(cols, rows);
              });
            }

            stream.on('close', () => {
              this.active = false;
              conn.end();
              if (this.terminalWin) {
                this.terminalWin.dispose();
              }
            });

            stream.on('error', (err) => {
              console.error('SSH stream error:', err);
              conn.end();
            });
          });
        });

        conn.on('error', (err) => {
          console.error('SSH connection failed:', err);
        });

        conn.connect({
          host,
          port,
          username: user,
          password,
          readyTimeout: 15000,
          keepaliveInterval: 30000
        });
      }
    }

    resize(cols, rows) {
      this.cols = cols;
      this.rows = rows;

      if (this.type === 'local' && this.process && this.process.resize) {
        this.process.resize({ cols, rows });
        if (this.terminalWin) {
          this.terminalWin.resize(cols, rows);
        }
      } else if (this.type === 'ssh' && this.stream && this.stream.setWindow) {
        this.stream.setWindow(rows, cols, 0, 0);
      }
    }

    resizeStream(cols, rows) {
      if (this.stream && this.stream.setWindow && this.active) {
        this.stream.setWindow(rows, cols, 0, 0);
        this.cols = cols;
        this.rows = rows;
      }
    }

    resizeTerminal(cols, rows) {
      if (this.terminalWin && this.terminalWin.resize) {
        this.resize(cols, rows);
      }
    }

    write(data) {
      if (this.active && this.stream) {
        this.stream.write(data);
      }
    }

    close() {
      this.active = false;
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
      if (this.stream) {
        this.stream.end();
        this.stream = null;
      }
      if (this.terminalWin) {
        this.terminalWin.dispose();
        this. this.terminalWin = null;
      }
    }
  }

  function createPTYSession(type, params = {}) {
    const id = ++ptyIdCounter;
    const session = new PTYSession(id, type, params);

    ptySessions.set(id, session);

    return session;
  }

  function createSSHSession(params = {}) {
    const id = ++sshIdCounter;
    const session = new PTYSession(id, 'ssh', params);

    sshSessions.set(id, session);

    return session;
  }

  function getPTYSession(id) {
    return ptySessions.get(id);
  }

  function getSSHSession(id) {
    return sshSessions.get(id);
  }

  function getPTYSessionByTab(tabId) {
    for (const [id, session] of ptySessions) {
      if (session.tabId === tabId && session.active) {
        return session;
      }
    }
    return null;
  }

  function closePTYSession(id) {
    const session = ptySessions.get(id);
    if (session) {
      session.close();
      ptySessions.delete(id);
    }
  }

  function closeSSHSession(id) {
    const session = sshSessions.get(id);
    if (session) {
      session.close();
      sshSessions.delete(id);
    }
  }

  function closeAllSessions() {
    ptySessions.forEach(session => session.close());
    ptySessions.clear();
    sshSessions.forEach(session => session.close());
    sshSessions.clear();
  }

  function setPTYTab(id, tabId) {
    const session = ptySessions.get(id);
    if (session) {
      session.tabId = tabId;
    }
  }

  function getPTYSessionsByTab(tabId) {
    return Array.from(ptySessions.entries())
      .filter(([id, session]) => session.tabId === tabId && session.active)
      .map(([id, session]) => session);
  }

  function getActivePTYSession(tabId) {
    for (const [id, session] of ptySessions.entries()) {
      if (session.tabId === tabId && session.active) {
        return session;
      }
    }
    return null;
  }

  function hasActiveSession(tabId) {
    for (const [id, session] of ptySessions.entries()) {
      if (session.tabId === tabId && session.active) {
        return true;
      }
    }
    return false;
  }

  function closeAllSessionsByTab(tabId) {
    for (const [id, session] of ptySessions.entries()) {
      if (session.tabId === tabId && session.active) {
        session.close();
      }
    }
  }
}
