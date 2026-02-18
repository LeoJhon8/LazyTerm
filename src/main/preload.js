const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  executeCommand: (command, connectionInfo) => ipcRenderer.invoke('execute-command', command, connectionInfo),
  getWorkingDirectory: () => ipcRenderer.invoke('get-working-directory'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  testConnection: (connectionType, params) => ipcRenderer.invoke('test-connection', connectionType, params),
  
  ptyCreate: (type, params) => ipcRenderer.invoke('pty-create', type, params),
  ptyWrite: (sessionId, data) => ipcRenderer.invoke('pty-write', sessionId, data),
  ptyResize: (sessionId, cols, rows) => ipcRenderer.invoke('pty-resize', sessionId, cols, rows),
  ptyClose: (sessionId) => ipcRenderer.invoke('pty-close', sessionId),
  ptyCloseAllByTab: (tabId) => ipcRenderer.invoke('pty-close-all-by-tab', tabId),
  ptySetTab: (sessionId, tabId) => ipcRenderer.invoke('pty-set-tab', sessionId, tabId),
  ptyGetActiveSession: (tabId) => ipcRenderer.invoke('pty-get-active-session', tabId),

  onPtyData: (callback) => ipcRenderer.on('pty-data', callback),
  onPtyExit: (callback) => ipcRenderer.on('pty-exit', callback),
  onPtyError: (callback) => ipcRenderer.on('pty-error', callback),

  removePtyDataListener: () => ipcRenderer.removeAllListeners('pty-data'),
  removePtyExitListener: () => ipcRenderer.removeAllListeners('pty-exit'),
  removePtyErrorListener: () => ipcRenderer.removeAllListeners('pty-error')
});
