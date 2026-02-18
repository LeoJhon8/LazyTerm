const pty = require('node-pty');
const { Client } = require('ssh2');

const ptySessions = new Map();
const sshSessions = new Map();
const tabToSessionIds = new Map();

class PTYSession {
  constructor(id, type, params = {}) {
    this.id = id;
    this.type = type;
    this.params = params;
    this.pty = null;
    this.stream = null;
    this.conn = null;
    this.tabId = null;
  }

  async start(win) {
    if (this.type === 'local') {
      this.spawnProcess(win);
    } else if (this.type === 'ssh') {
      this.setupSSH(win);
    }
  }

  spawnProcess(win) {
    const isWindows = process.platform === 'win32';
    const shell = this.params.shell || (isWindows ? 'powershell.exe' : 'bash');

    this.pty = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: this.params.cols || 80,
      rows: this.params.rows || 24,
      cwd: this.params.cwd || process.env.HOME || process.env.USERPROFILE,
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: isWindows // Use ConPTY on Windows 10+ for better compatibility
    });

    this.pty.onData((data) => {
      if (win) {
        win.webContents.send('pty-data', {
          sessionId: this.id,
          data: data
        });
      }
    });

    this.pty.on('exit', (code) => {
      if (win) {
        win.webContents.send('pty-exit', {
          sessionId: this.id,
          code
        });
      }
    });

    this.pty.on('error', (err) => {
      if (win) {
        win.webContents.send('pty-error', {
          sessionId: this.id,
          error: err.message
        });
      }
    });
  }

  setupSSH(win) {
    const { host, port, user, password, keyPath, cwd } = this.params;

    this.conn = new Client();

    this.conn.on('ready', () => {
      this.conn.shell({
        term: 'xterm-256color',
        cols: this.params.cols || 80,
        rows: this.params.rows || 24
      }, (err, stream) => {
        if (err) {
          if (win) {
            win.webContents.send('pty-error', {
              sessionId: this.id,
              error: `SSH shell error: ${err.message}`
            });
          }
          return;
        }

        this.stream = stream;

        stream.on('data', (data) => {
          if (win) {
            win.webContents.send('pty-data', {
              sessionId: this.id,
              data: data
            });
          }
        });

        stream.on('close', () => {
          this.conn.end();
          if (win) {
            win.webContents.send('pty-exit', {
              sessionId: this.id,
              code: 0
            });
          }
        });

        stream.stderr.on('data', (data) => {
          if (win) {
            win.webContents.send('pty-data', {
              sessionId: this.id,
              data: data.toString()
            });
          }
        });

        if (cwd) {
          stream.write(`cd ${cwd}\n`);
        }
      });
    });

    this.conn.on('error', (err) => {
      if (win) {
        win.webContents.send('pty-error', {
          sessionId: this.id,
          error: `SSH connection error: ${err.message}`
        });
      }
    });

    const connectionConfig = {
      host,
      port: port || 22,
      username: user,
      password,
      readyTimeout: 15000,
      algorithms: {
        kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group16-sha512', 'diffie-hellman-group-exchange-sha256', 'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521'],
        cipher: ['3des-cbc', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm', 'aes256-gcm'],
        serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ed25519']
      }
    };

    // Add keyPath if provided
    if (keyPath) {
      connectionConfig.privateKey = require('fs').readFileSync(keyPath);
    }

    this.conn.connect(connectionConfig);
  }

  resize(cols, rows) {
    if (this.type === 'local' && this.pty) {
      this.pty.resize(cols, rows);
    } else if (this.type === 'ssh' && this.stream) {
      this.stream.setWindow(rows, cols);
    }
  }

  write(data) {
    if (this.type === 'local' && this.pty) {
      this.pty.write(data);
    } else if (this.type === 'ssh' && this.stream) {
      this.stream.write(data);
    }
  }

  close() {
    if (this.type === 'local' && this.pty) {
      this.pty.destroy();
      this.pty = null;
    } else if (this.type === 'ssh') {
      if (this.stream) {
        this.stream.end();
        this.stream = null;
      }
      if (this.conn) {
        this.conn.end();
        this.conn = null;
      }
    }
  }
}

let mainWindow = null;

function setMainWindow(win) {
  mainWindow = win;
}

function createPTYSession(type, params = {}) {
  const id = `pty-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const session = new PTYSession(id, type, params);
  ptySessions.set(id, session);

  if (params.tabId) {
    if (!tabToSessionIds.has(params.tabId)) {
      tabToSessionIds.set(params.tabId, new Set());
    }
    tabToSessionIds.get(params.tabId).add(id);
    session.tabId = params.tabId;
  }

  session.start(mainWindow);
  return session;
}

function createSSHSession(params = {}) {
  const id = `ssh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const session = new PTYSession(id, 'ssh', params);
  sshSessions.set(id, session);

  if (params.tabId) {
    if (!tabToSessionIds.has(params.tabId)) {
      tabToSessionIds.set(params.tabId, new Set());
    }
    tabToSessionIds.get(params.tabId).add(id);
    session.tabId = params.tabId;
  }

  setPTYTab(id, params.tabId || params.sessionId);

  session.start(mainWindow);
  return session;
}

function getPTYSession(sessionId) {
  return ptySessions.get(sessionId);
}

function getSSHSession(sessionId) {
  return sshSessions.get(sessionId);
}

function getAllSessions() {
  return [...ptySessions.values(), ...sshSessions.values()];
}

function closePTYSession(sessionId) {
  const session = ptySessions.get(sessionId);
  if (session) {
    if (session.tabId && tabToSessionIds.has(session.tabId)) {
      tabToSessionIds.get(session.tabId).delete(sessionId);
    }
    session.close();
    ptySessions.delete(sessionId);
    return true;
  }
  return false;
}

function closeSSHSession(sessionId) {
  const session = sshSessions.get(sessionId);
  if (session) {
    if (session.tabId && tabToSessionIds.has(session.tabId)) {
      tabToSessionIds.get(session.tabId).delete(sessionId);
    }
    session.close();
    sshSessions.delete(sessionId);
    return true;
  }
  return false;
}

function closeAllSessions() {
  ptySessions.forEach(session => session.close());
  sshSessions.forEach(session => session.close());
  ptySessions.clear();
  sshSessions.clear();
  tabToSessionIds.clear();
}

function closeAllSessionsByTab(tabId) {
  const sessionIds = tabToSessionIds.get(tabId);
  if (sessionIds) {
    sessionIds.forEach(sessionId => {
      closePTYSession(sessionId);
      closeSSHSession(sessionId);
    });
    tabToSessionIds.delete(tabId);
  }
}

function setPTYTab(sessionId, tabId) {
  const session = getPTYSession(sessionId) || getSSHSession(sessionId);
  if (session) {
    if (session.tabId && tabToSessionIds.has(session.tabId)) {
      tabToSessionIds.get(session.tabId).delete(sessionId);
    }

    session.tabId = tabId;

    if (!tabToSessionIds.has(tabId)) {
      tabToSessionIds.set(tabId, new Set());
    }
    tabToSessionIds.get(tabId).add(sessionId);
  }
}

function getPTYSessionsByTab(tabId) {
  const sessionIds = tabToSessionIds.get(tabId) || new Set();
  const sessions = [];

  sessionIds.forEach(sessionId => {
    const session = getPTYSession(sessionId) || getSSHSession(sessionId);
    if (session) {
      sessions.push(session);
    }
  });

  return sessions;
}

function getActivePTYSession(tabId) {
  const sessions = getPTYSessionsByTab(tabId);
  if (sessions.length > 0) {
    return sessions[0]; // Return first session as active
  }
  return null;
}

function hasActiveSession(tabId) {
  const sessionIds = tabToSessionIds.get(tabId);
  return sessionIds && sessionIds.size > 0;
}

module.exports = {
  ptyService: {
    setMainWindow,
    createPTYSession,
    createSSHSession,
    getPTYSession,
    getSSHSession,
    getAllSessions,
    closePTYSession,
    closeSSHSession,
    closeAllSessions,
    closeAllSessionsByTab,
    setPTYTab,
    getPTYSessionsByTab,
    getActivePTYSession,
    hasActiveSession
  },
  PTYSession,
  createPTYSession,
  createSSHSession,
  getPTYSession,
  getSSHSession,
  getAllSessions,
  closePTYSession,
  closeSSHSession,
  closeAllSessions,
  closeAllSessionsByTab,
  setPTYTab,
  getPTYSessionsByTab,
  getActivePTYSession,
  hasActiveSession,
  setMainWindow
};
