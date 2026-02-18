const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('ssh2');
const { ptyService, createPTYSession, createSSHSession, getPTYSession, getSSHSession, closePTYSession, closeSSHSession, closeAllSessions, setPTYTab, getPTYSessionsByTab, getActivePTYSession, hasActiveSession, closeAllSessionsByTab } = require('./pty/ptyService');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minHeight: 400,
    minWidth: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1e1e1e',
    title: 'Lazy Terminal'
  });

  require('./pty/ptyService').setMainWindow(mainWindow);

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    closeAllSessions();
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('execute-command', async (event, command, connectionInfo = null) => {
  return new Promise((resolve) => {
    const spawn = require('child_process').spawn;

    if (connectionInfo && connectionInfo.type === 'ssh' && connectionInfo.type !== 'interactive') {
      const { host, port, user, authMethod, password, keyPath } = connectionInfo.params;

      if (authMethod === 'password' && password) {
        let output = '';
        let errorOutput = '';

        const conn = new Client();
        conn.on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              resolve({
                success: false,
                code: -1,
                output: `SSH Error: ${err.message}`
              });
              conn.end();
              return;
            }

            stream.on('data', (data) => {
              output += data.toString();
            });

            stream.stderr.on('data', (data) => {
              errorOutput += data.toString();
            });

            stream.on('close', (code, signal) => {
              conn.end();
              if (errorOutput.includes('Permission denied') || errorOutput.includes('password')) {
                resolve({
                  success: false,
                  code,
                  output: `SSH Error: Authentication failed.\n\nPlease check:\n- Username: ${user}\n- Password is correct\n- Password authentication is enabled on the server`
                });
              } else {
                resolve({
                  success: code === 0,
                  code,
                  output: output || errorOutput || `SSH command completed with code ${code}`
                });
              }
            });

            const timeout = setTimeout(() => {
              stream.destroy();
              conn.end();
              if (!output && !errorOutput) {
                resolve({
                  success: false,
                  code: -1,
                  output: `SSH Error: Command execution timeout`
                });
              }
            }, 30000);
          });
        });

        conn.on('error', (err) => {
          clearTimeout(timeout);
          resolve({
            success: false,
            code: -1,
            output: `SSH Error: ${err.message}\n\nPlease check:\n- Host ${host}:${port} is reachable\n- Username ${user} is correct\n- Authentication method is supported\n- Firewall allows the connection`
          });
        });

        conn.connect({
          host,
          port,
          username: user,
          password,
          readyTimeout: 15000,
          algorithms: {
            kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group16-sha512', 'diffie-hellman-group-exchange-sha256', 'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521'],
            cipher: ['3des-cbc', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm', 'aes256-gcm'],
            serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ed25519']
          }
        });

        return;
      }

      let sshArgs = [
        '-p', port.toString(),
        '-o', 'ConnectTimeout=15',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'StrictHostKeyChecking=accept-new'
      ];

      if (authMethod === 'key' && keyPath) {
        sshArgs.push('-i', keyPath);
      }

      sshArgs.push(`${user}@${host}`, command);

      let output = '';
      let errorOutput = '';

      const ssh = spawn('ssh', sshArgs, {
        shell: false,
        env: { ...process.env, TERM: 'xterm-256color' }
      });

      ssh.stdout.on('data', (data) => {
        output += data.toString();
      });

      ssh.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      const timeout = setTimeout(() => {
        ssh.kill('SIGTERM');
        resolve({
          success: false,
          code: -1,
          output: `SSH Error: Connection timeout`
        });
      }, 30000);

      ssh.on('close', () => clearTimeout(timeout));
      ssh.on('error', (err) => clearTimeout(timeout));

      ssh.on('close', (code) => {
        clearTimeout(timeout);
        if (errorOutput.includes('Permission denied') || errorOutput.includes('password')) {
          resolve({
            success: false,
            code,
            output: `SSH Error: Authentication failed.\n\nTry password authentication or check your SSH key.\n\nTo setup SSH keys:\n1. Generate key: ssh-keygen -t rsa\n2. Copy to server: ssh-copy-id ${user}@${host}`
          });
        } else if (errorOutput.includes('Connection refused')) {
          resolve({
            success: false,
            code,
            output: `SSH Error: Connection refused to ${host}:${port}\n\nCheck that SSH server is running and firewall allows connection`
          });
        } else if (errorOutput.includes('Could not resolve hostname') || errorOutput.includes('Name or service not known')) {
          resolve({
            success: false,
            code,
            output: `SSH Error: Could not resolve hostname "${host}"`
          });
        } else if (code === 0 && !errorOutput) {
          resolve({
            success: true,
            code,
            output: output || 'SSH command completed with no output'
          });
        } else {
          resolve({
            success: code === 0,
            code,
            output: output || errorOutput || `SSH command completed with code ${code}`
          });
        }
      });

      ssh.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          code: -1,
          output: `SSH Error: ${err.message}`
        });
      });

      return;
    }

    const isWindows = process.platform === 'win32';
    const parts = command.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    let commandToSpawn = cmd;
    let argsToSpawn = args;
    let bashPath = null;

    if (isWindows) {
      const fs = require('fs');
      const potentialBashPaths = [
        'C:\\msys64\\usr\\bin\\bash.exe',
        'C:\\msys64\\mingw64\\bin\\bash.exe',
        'C:\\msys64\\mingw32\\bin\\bash.exe',
        'C:\\msys64\\ucrt64\\bin\\bash.exe',
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      ];

      bashPath = potentialBashPaths.find(fs.existsSync);

      if (bashPath) {
        commandToSpawn = bashPath;
        argsToSpawn = ['-l', '-c', command];
      } else {
        commandToSpawn = 'cmd.exe';
        argsToSpawn = ['/c', command];
      }
    }

    let output = '';
    let errorOutput = '';

    const spawnOptions = {
      shell: !isWindows || !bashPath,
      cwd: process.env.HOME || process.env.USERPROFILE || process.cwd()
    };

    if (bashPath) {
      spawnOptions.env = {
        ...process.env,
        MSYSTEM: 'MSYS',
        MSYS2_PATH_TYPE: 'inherit',
        TERM: 'xterm-256color',
        HOME: process.env.HOME || process.env.USERPROFILE,
      };
    }

    const child = spawn(commandToSpawn, argsToSpawn, spawnOptions);

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        code,
        output: output || errorOutput || `Command '${command}' completed with code ${code}`
      });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        code: -1,
        output: `Error: ${err.message}`
      });
    });
  });
});

ipcMain.handle('get-working-directory', () => {
  if (process.platform === 'win32') {
    const fs = require('fs');
    const potentialBashPaths = [
      'C:\\msys64\\usr\\bin\\bash.exe',
      'C:\\msys64\\mingw64\\bin\\bash.exe',
      'C:\\msys64\\mingw32\\bin\\bash.exe',
      'C:\\msys64\\ucrt64\\bin\\bash.exe',
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    ];

    const bashPath = potentialBashPaths.find(fs.existsSync);

    if (bashPath && process.env.USERPROFILE) {
      return `~`;
    }
  }
  return process.env.HOME || process.env.USERPROFILE || process.cwd();
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});

 ipcMain.handle('test-connection', async (event, connectionType, params) => {
  try {
    if (connectionType === 'ssh') {
      const { host, port, authMethod, password } = params;

      if (authMethod === 'password' && password) {
        return new Promise((resolve) => {
          const conn = new Client();
          const timeout = setTimeout(() => {
            conn.end();
            resolve({
              success: false,
              message: 'SSH connection test timeout'
            });
          }, 10000);

          conn.on('ready', () => {
            clearTimeout(timeout);
            conn.exec('echo "connection test"', (err) => {
              conn.end();
              if (err) {
                resolve({
                  success: false,
                  message: 'SSH Error: ' + err.message
                });
                return;
              }
              resolve({
                success: true,
                message: 'SSH connection with password authentication is ready'
              });
            });
          });

          conn.on('error', (err) => {
            clearTimeout(timeout);
            resolve({
              success: false,
              message: 'SSH Error: ' + err.message
            });
          });

          conn.connect({
            host,
            port,
            username: params.user,
            password,
            readyTimeout: 10000,
            algorithms: {
              kex: ['diffie-hellman-group14-sha256', 'diffie-hellman-group16-sha512', 'diffie-hellman-group-exchange-sha256', 'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521'],
              cipher: ['3des-cbc', 'aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm', 'aes256-gcm'],
              serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ed25519']
            }
          });
        });
      } else {
        return new Promise((resolve) => {
          const ssh = spawn('ssh', ['-V'], { shell: false });

          ssh.on('close', (code) => {
            if (code === 0) {
              if (authMethod === 'key') {
                resolve({ success: true, message: 'SSH is ready with public key authentication.' });
              } else if (authMethod === 'agent') {
                resolve({ success: true, message: 'SSH is ready with SSH Agent or default keys.' });
              } else {
                resolve({ success: true, message: 'SSH is available. Using agent or default keys for authentication.' });
              }
            } else {
              resolve({
                success: false,
                message: 'SSH is not installed'
              });
            }
          });

          ssh.on('error', () => {
            resolve({
              success: false,
              message: 'SSH is not installed'
            });
          });

          setTimeout(() => {
            ssh.kill();
            resolve({ success: false, message: 'SSH test timeout' });
          }, 3000);
        });
      }
    }
    else if (connectionType === 'telnet') {
        const { host, port } = params;

        if (!host || host.length === 0) {
          return {
            success: false,
            message: 'Telnet host cannot be empty'
          };
        }

        if (port < 1 || port > 65535) {
          return {
            success: false,
            message: 'Telnet port must be between 1 and 65535'
          };
        }

        return {
          success: true,
          message: 'Telnet connection parameters valid'
        };
    }

    return { success: true, message: 'Local shell ready' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('pty-create', async (event, type, params = {}) => {
  try {
    const session = type === 'ssh'
      ? createSSHSession(params)
      : createPTYSession(type, params);

    return { success: true, sessionId: session.id };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('pty-write', async (event, sessionId, data) => {
  const session = getPTYSession(sessionId) || getSSHSession(sessionId);
  if (session) {
    session.write(data);
    return { success: true };
  }
  return { success: false, message: 'Session not found' };
});

ipcMain.handle('pty-resize', async (event, sessionId, cols, rows) => {
  const session = getPTYSession(sessionId) || getSSHSession(sessionId);
  if (session) {
    session.resize(cols, rows);
    return { success: true };
  }
  return { success: false, message: 'Session not found' };
});

ipcMain.handle('pty-close', async (event, sessionId) => {
  const ptySession = getPTYSession(sessionId);
  const sshSession = getSSHSession(sessionId);

  if (ptySession) {
    closePTYSession(sessionId);
    return { success: true };
  }

  if (sshSession) {
    closeSSHSession(sessionId);
    return { success: true };
  }

  return { success: false, message: 'Session not found' };
});

ipcMain.handle('pty-close-all-by-tab', async (event, tabId) => {
  closeAllSessionsByTab(tabId);
  return { success: true };
});

ipcMain.handle('pty-set-tab', async (event, sessionId, tabId) => {
  const session = getPTYSession(sessionId) || getSSHSession(sessionId);
  if (session) {
    setPTYTab(session.id, tabId);
    return { success: true };
  }
  return { success: false, message: 'Session not found' };
});

ipcMain.handle('pty-get-active-session', async (event, tabId) => {
  const session = getActivePTYSession(tabId);
  if (session) {
    return { success: true, sessionId: session.id };
  }

  if (hasActiveSession(tabId)) {
    const sessions = getPTYSessionsByTab(tabId);
    return { success: true, sessionId: sessions[0].id };
  }

  return { success: false, message: 'No active session' };
});
