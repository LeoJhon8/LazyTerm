import * as pty from 'node-pty';
import { Client, ClientChannel } from 'ssh2';
import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
// 导入定义的类型
import { 
  PtyCreateOptions, 
  SessionType, 
  SSHParams, 
  LocalParams, 
  TelnetParams,
  PTYEventPayload,
  PTYExitPayload,
  PTYErrorPayload
} from '../types/types';

export class PTYSession {
  private pty: pty.IPty | null = null;
  private stream: ClientChannel | null = null;
  private conn: Client | null = null;
  private isDestroyed: boolean = false;
  public tabId: number | null = null;

  constructor(
    public readonly id: string,
    private options: PtyCreateOptions, // 包含 type, params, tabId, cols, rows
    private onExitCallback: (id: string) => void
  ) {
    this.tabId = options.tabId ?? null;
  }

  get type(): SessionType {
    return this.options.type;
  }

  async start(win: BrowserWindow | null) {
    try {
      // 辨析联合类型收窄
      switch (this.options.type) {
        case 'local':
          await this.spawnLocalProcess(win, this.options.params);
          break;
        case 'ssh':
          await this.setupSSH(win, this.options.params);
          break;
        case 'telnet':
          throw new Error('Telnet implementation pending');
        default:
          throw new Error(`Unsupported type`);
      }
    } catch (err) {
      this.sendError(win, `Failed to start session: ${(err as Error).message}`);
    }
  }

  private async spawnLocalProcess(win: BrowserWindow | null, params: LocalParams) {
    const isWindows = process.platform === 'win32';
    const shell = params.shell || (isWindows ? 'powershell.exe' : 'bash');
    
    if (this.pty) return;

    this.pty = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: this.options.cols || 80,
      rows: this.options.rows || 24,
      cwd: params.cwd || process.env.HOME || process.env.USERPROFILE,
      env: { ...process.env, TERM: 'xterm-256color', ...params.env } as any,
      useConpty: isWindows,
    });

    this.pty.onData(data => {
      const payload: PTYEventPayload = { sessionId: this.id, data };
      this.sendToClient(win, 'pty-data', payload);
    });

    this.pty.onExit(({ exitCode }) => {
      const payload: PTYExitPayload = { sessionId: this.id, code: exitCode };
      this.sendToClient(win, 'pty-exit', payload);
      this.onExitCallback(this.id);
    });
  }

  private async setupSSH(win: BrowserWindow | null, params: SSHParams) {
    this.conn = new Client();

    const config: any = {
      host: params.host,
      port: params.port || 22,
      username: params.user,
      password: params.password,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
    };

    if (params.keyPath && existsSync(params.keyPath)) {
      try {
        config.privateKey = await fs.readFile(params.keyPath);
      } catch (e) {
        throw new Error(`Read KeyPath failed: ${(e as Error).message}`);
      }
    }

    return new Promise<void>((resolve, reject) => {
      this.conn!
        .on('ready', () => {
          this.conn?.shell(
            { 
              term: 'xterm-256color', 
              cols: this.options.cols || 80, 
              rows: this.options.rows || 24 
            },
            (err, stream) => {
              if (err) return reject(err);

              this.stream = stream;
              stream.on('data', (data: Buffer) => {
                const payload: PTYEventPayload = { sessionId: this.id, data: data.toString() };
                this.sendToClient(win, 'pty-data', payload);
              });

              stream.on('close', () => {
                const payload: PTYExitPayload = { sessionId: this.id, code: 0 };
                this.sendToClient(win, 'pty-exit', payload);
                this.onExitCallback(this.id);
                this.close();
              });

              resolve();
            }
          );
        })
        .on('error', err => {
          this.sendError(win, `SSH Error: ${err.message}`);
          reject(err);
        })
        .connect(config);
    });
  }

  private sendError(win: BrowserWindow | null, message: string) {
    const payload: PTYErrorPayload = { sessionId: this.id, error: message };
    this.sendToClient(win, 'pty-error', payload);
  }

  private sendToClient(win: BrowserWindow | null, channel: string, payload: any) {
    if (win && !win.isDestroyed() && !this.isDestroyed) {
      win.webContents.send(channel, payload);
    }
  }

  public resize(cols: number, rows: number) {
    if (this.isDestroyed) return;
    try {
      if (this.options.type === 'local') {
        this.pty?.resize(cols, rows);
      } else {
        this.stream?.setWindow(rows, cols, 0, 0);
      }
    } catch (e) {
      console.error(`Resize session ${this.id} failed`, e);
    }
  }

  public write(data: string) {
    if (this.isDestroyed) return;
    if (this.options.type === 'local') {
      this.pty?.write(data);
    } else {
      this.stream?.write(data);
    }
  }

  public close() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    
    try {
      this.pty?.kill();
      this.stream?.end();
      this.conn?.end();
    } catch (e) {
      // 忽略
    } finally {
      this.pty = null;
      this.stream = null;
      this.conn = null;
    }
  }
}

// ---------------- 管理器实现 ----------------

const sessions = new Map<string, PTYSession>();
// 对应 .d.ts 中的 tabId: number
const tabToSessionIds = new Map<number, Set<string>>();
let mainWindow: BrowserWindow | null = null;

const cleanupSessionRecord = (sessionId: string) => {
  const session = sessions.get(sessionId);
  if (session?.tabId !== null) {
    const set = tabToSessionIds.get(session.tabId!);
    set?.delete(sessionId);
    if (set?.size === 0) tabToSessionIds.delete(session.tabId!);
  }
  sessions.delete(sessionId);
};

export const ptyService = {
  setMainWindow: (win: BrowserWindow) => {
    mainWindow = win;
  },

  createSession: async (options: PtyCreateOptions) => {
    const id = `${options.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    
    const session = new PTYSession(id, options, (sid) => {
      cleanupSessionRecord(sid);
    });

    sessions.set(id, session);

    if (options.tabId !== undefined) {
      if (!tabToSessionIds.has(options.tabId)) {
        tabToSessionIds.set(options.tabId, new Set());
      }
      tabToSessionIds.get(options.tabId)!.add(id);
    }

    await session.start(mainWindow);
    return id;
  },

  write: (sessionId: string, data: string) => {
    sessions.get(sessionId)?.write(data);
  },

  resize: (sessionId: string, cols: number, rows: number) => {
    sessions.get(sessionId)?.resize(cols, rows);
  },

  closeSession: (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.close();
      cleanupSessionRecord(sessionId);
    }
  },

  closeAllByTab: (tabId: number) => {
    const sessionIds = tabToSessionIds.get(tabId);
    if (sessionIds) {
      Array.from(sessionIds).forEach(id => ptyService.closeSession(id));
    }
  },

  setTab: (sessionId: string, tabId: number) => {
    const session = sessions.get(sessionId);
    if (session) {
      // 移除旧关联
      if (session.tabId !== null) {
        tabToSessionIds.get(session.tabId)?.delete(sessionId);
      }
      // 建立新关联
      session.tabId = tabId;
      if (!tabToSessionIds.has(tabId)) {
        tabToSessionIds.set(tabId, new Set());
      }
      tabToSessionIds.get(tabId)!.add(sessionId);
    }
  },

  getActiveSession: (tabId: number) => {
    const ids = tabToSessionIds.get(tabId);
    if (!ids || ids.size === 0) return null;
    // 返回该 Tab 下最新创建或第一个会话
    const lastId = Array.from(ids).pop();
    return lastId ? sessions.get(lastId) : null;
  },

  closeAll: () => {
    sessions.forEach(s => s.close());
    sessions.clear();
    tabToSessionIds.clear();
  }
};

/**
 * 快捷导出函数，用于主进程响应 IPC 请求
 */
export const createPTYSession = ptyService.createSession;
export const closePTYSession = ptyService.closeSession;
export const writePTYSession = ptyService.write;
export const resizePTYSession = ptyService.resize;