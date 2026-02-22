import { app, BrowserWindow, ipcMain, screen } from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';
import { Client } from 'ssh2';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { ptyService } from './ptyService';
// 导入定义的类型
import { 
  SessionConfig, 
  PtyCreateOptions, 
  IpcResult, 
  SSHParams,
  LocalParams
} from '../types/electron';

// --- 常量与工具 ---

const IS_WIN = process.platform === 'win32';

/** 获取 Windows Bash 路径 */
const getWindowsBashPath = () => {
  const paths = [
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Windows\\System32\\wsl.exe',
  ];
  return paths.find(fs.existsSync) || null;
};

/** 辅助函数：读取 SSH 密钥 */
const readPrivateKey = async (keyPath?: string) => {
  if (keyPath && fs.existsSync(keyPath)) {
    return await fsPromises.readFile(keyPath);
  }
  return undefined;
};

// --- 窗口管理 ---

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: Math.min(1200, width),
    height: Math.min(800, height),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#1e1e1e',
  });

  ptyService.setMainWindow(mainWindow);
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('closed', () => {
    ptyService.closeAll();
    mainWindow = null;
  });
}

// --- 生命周期 ---

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());

// --- IPC 处理逻辑 ---

/**
 * 1. 执行命令 (对应 executeCommand)
 */
ipcMain.handle('execute-command', async (_, command: string, config?: SessionConfig): Promise<IpcResult<string>> => {
  try {
    // 情况 A: SSH 执行
    if (config?.type === 'ssh') {
      const params = config.params as SSHParams;
      return new Promise(async (resolve) => {
        const conn = new Client();
        const privateKey = await readPrivateKey(params.keyPath);

        conn.on('ready', () => {
          conn.exec(command, (err, stream) => {
            if (err) return resolve({ success: false, sessionId: '', message: err.message });
            let output = '';
            stream.on('data', (d: Buffer) => output += d.toString());
            stream.stderr.on('data', (d: Buffer) => output += d.toString());
            stream.on('close', (code: number) => {
              conn.end();
              resolve({ success: code === 0, sessionId: '', data: output, code });
            });
          });
        }).on('error', (err) => {
          resolve({ success: false, sessionId: '', message: `SSH Error: ${err.message}` });
        }).connect({
          host: params.host,
          port: params.port || 22,
          username: params.user,
          password: params.password,
          privateKey,
          readyTimeout: 15000
        });
      });
    }

    const localParams = config?.type === 'local' ? config.params : undefined;

    // 2. 确定工作目录 (优先级：参数指定 > 用户家目录 > 当前进程目录)
    const safeCwd = localParams?.cwd || process.env.HOME || process.env.USERPROFILE || process.cwd();

    // 3. 确定环境变量 (合并系统环境 + 自定义环境)
    const safeEnv = {
      ...process.env,
      ...(localParams?.env || {}),
      TERM: 'xterm-256color', // 强制开启彩色支持
    };

    return new Promise((resolve) => {
      const bashPath = getWindowsBashPath();
      const shell = IS_WIN ? (bashPath || 'cmd.exe') : 'bash';
      const args = IS_WIN && !bashPath ? ['/c', command] : ['-c', command];

      const child = spawn(shell, args, {
        cwd: safeCwd,
        env: safeEnv,
        // 如果是 Windows 且使用 cmd.exe，建议加上 windowsHide: true 隐藏黑窗口
        windowsHide: true 
      });

      let output = '';
      child.stdout?.on('data', d => output += d.toString());
      child.stderr?.on('data', d => output += d.toString());

      child.on('close', (code) => {
        resolve({ 
          success: code === 0, 
          sessionId: '', 
          data: output, 
          code: code ?? 0 
        });
      });

      // 错误处理：防止进程启动失败（如路径不存在）
      child.on('error', (err) => {
        resolve({ success: false, sessionId: '', message: `Spawn error: ${err.message}` });
      });
    });
  } catch (e) {
    return { success: false, sessionId: '', message: (e as Error).message };
  }
});

/**
 * 2. PTY 会话生命周期
 */
ipcMain.handle('pty-create', async (_, options: PtyCreateOptions): Promise<IpcResult<{ sessionId: string }>> => {
  try {
    const sessionId = await ptyService.createSession(options);
    return { success: true, sessionId, data: { sessionId } };
  } catch (err) {
    return { success: false, sessionId: '', message: (err as Error).message };
  }
});

ipcMain.handle('pty-write', async (_, sessionId: string, data: string): Promise<IpcResult> => {
  ptyService.write(sessionId, data);
  return { success: true, sessionId };
});

ipcMain.handle('pty-resize', async (_, sessionId: string, cols: number, rows: number): Promise<IpcResult> => {
  ptyService.resize(sessionId, cols, rows);
  return { success: true, sessionId };
});

ipcMain.handle('pty-close', async (_, sessionId: string): Promise<IpcResult> => {
  ptyService.closeSession(sessionId);
  return { success: true, sessionId };
});

/**
 * 3. Tab 与 批量管理
 */
ipcMain.handle('pty-close-all-by-tab', async (_, tabId: number): Promise<IpcResult> => {
  ptyService.closeAllByTab(tabId);
  return { success: true, sessionId: '' };
});

ipcMain.handle('pty-set-tab', async (_, sessionId: string, tabId: number): Promise<IpcResult> => {
  ptyService.setTab(sessionId, tabId);
  return { success: true, sessionId };
});

ipcMain.handle('pty-get-active-session', async (_, tabId: number): Promise<IpcResult<{ sessionId: string }>> => {
  const session = ptyService.getActiveSession(tabId);
  if (session) {
    return { success: true, sessionId: session.id, data: { sessionId: session.id } };
  }
  return { success: false, sessionId: '', message: 'No active session for this tab' };
});

/**
 * 4. 辅助功能
 */
ipcMain.handle('test-connection', async (_, config: SessionConfig): Promise<IpcResult> => {
  if (config.type !== 'ssh') return { success: true, sessionId: '' };
  
  const params = config.params as SSHParams;
  return new Promise(async (resolve) => {
    const conn = new Client();
    const privateKey = await readPrivateKey(params.keyPath);
    
    conn.on('ready', () => {
      conn.end();
      resolve({ success: true, sessionId: '' });
    }).on('error', (err) => {
      resolve({ success: false, sessionId: '', message: err.message });
    }).connect({
      host: params.host,
      port: params.port || 22,
      username: params.user,
      password: params.password,
      privateKey,
      readyTimeout: 10000
    });
  });
});

ipcMain.handle('get-working-directory', () => {
  return process.env.HOME || process.env.USERPROFILE || process.cwd();
});

ipcMain.handle('get-platform', () => {
  return process.platform;
});