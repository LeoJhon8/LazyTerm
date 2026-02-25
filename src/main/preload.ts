import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // --- 基础工具 ---
  getWorkingDirectory: () => ipcRenderer.invoke('get-working-directory'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  
  // 建议增加：弹出文件选择框获取私钥路径
  selectKeyFile: () => ipcRenderer.invoke('dialog:openFile'),

  // --- 命令执行 ---
  executeCommand: (command: string, connectionInfo?: any) =>
    ipcRenderer.invoke('execute-command', command, connectionInfo),
    
  testConnection: (connectionType: string, params: any) =>
    ipcRenderer.invoke('test-connection', connectionType, params),

  // --- PTY 核心控制 ---
  ptyCreate: (config: any) => ipcRenderer.invoke('pty-create', config),
  ptyWrite: (sessionId: string, data: string) => ipcRenderer.invoke('pty-write', sessionId, data),
  ptyResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pty-resize', sessionId, cols, rows),
  ptyClose: (sessionId: string) => ipcRenderer.invoke('pty-close', sessionId),
  
  // --- 多标签管理 ---
  ptyCloseAllByTab: (tabId: number) => ipcRenderer.invoke('pty-close-all-by-tab', tabId),
  ptySetTab: (sessionId: string, tabId: number) =>
    ipcRenderer.invoke('pty-set-tab', sessionId, tabId),
  ptyGetActiveSession: (tabId: number) => ipcRenderer.invoke('pty-get-active-session', tabId),

  // --- 改进的事件监听（订阅模式） ---
  // 调用时：const unsub = window.electronAPI.onPtyData((e, data) => { ... });
  // 卸载时：unsub();
  onPtyData: (callback: (event: IpcRendererEvent, ...args: any[]) => void) => {
    const subscription = (event: IpcRendererEvent, ...args: any[]) => callback(event, ...args);
    ipcRenderer.on('pty-data', subscription);
    return () => ipcRenderer.removeListener('pty-data', subscription);
  },

  onPtyExit: (callback: (event: IpcRendererEvent, ...args: any[]) => void) => {
    const subscription = (event: IpcRendererEvent, ...args: any[]) => callback(event, ...args);
    ipcRenderer.on('pty-exit', subscription);
    return () => ipcRenderer.removeListener('pty-exit', subscription);
  },

  onPtyError: (callback: (event: IpcRendererEvent, ...args: any[]) => void) => {
    const subscription = (event: IpcRendererEvent, ...args: any[]) => callback(event, ...args);
    ipcRenderer.on('pty-error', subscription);
    return () => ipcRenderer.removeListener('pty-error', subscription);
  }
});