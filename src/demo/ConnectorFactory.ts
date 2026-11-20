import type { SessionCreationData } from '../connectors/ConnectorFactory';
export type { SessionCreationData } from '../connectors/ConnectorFactory';
import type { ITerminalConnector, ConnectionStateEvent, SessionConnector } from '@/types/terminal';
import { HOME, filesFor, listDirectory, normalizePath } from './filesystem';

class DemoTerminalConnector implements ITerminalConnector {
  readonly protocol: ITerminalConnector['protocol'];
  isConnected = false;
  private closed = false;
  private handlers = new Set<(event: ConnectionStateEvent) => void>();
  private output: ((data: string) => void) | null = null;
  private pending = '';
  private input = '';
  private escape = '';
  private cwd = HOME;
  private history: string[] = [];
  private historyIndex = 0;
  private host: string;
  private startup?: string;

  constructor(data: SessionCreationData) {
    this.protocol = data.type as ITerminalConnector['protocol'];
    this.host = data.config?.sshConfig?.host || 'local.demo';
    this.startup = data.config?.sshConfig?.startupCommand ?? data.config?.startupCommand;
  }
  private emit(event: ConnectionStateEvent) { this.handlers.forEach((handler) => handler(event)); }
  private print(data: string) {
    if (this.closed) return;
    if (this.output) this.output(data); else this.pending = (this.pending + data).slice(-65536);
  }
  private prompt() { this.print(`\x1b[32mdemo@${this.host}\x1b[0m:\x1b[34m${this.cwd.replace(HOME, '~')}\x1b[0m$ `); }
  async open() {
    this.emit({ phase: 'connecting', stage: 'transport' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.closed) return;
    this.emit({ phase: 'authenticating', stage: 'authentication' });
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.closed) return;
    if (this.host === 'auth-failed.demo') {
      this.emit({ phase: 'failed', stage: 'authentication', failure: {
        code: 'AUTH_REJECTED', category: 'authentication', stage: 'authentication', retryable: false,
        technicalDetails: 'Demo scenario: authentication rejected',
      } });
      throw new Error('Demo scenario: authentication rejected');
    }
    this.isConnected = true;
    this.emit({ phase: 'connected', stage: 'steady', health: 'healthy' });
    this.print('\r\n\x1b[36mLazyTerm Demo — simulated terminal\x1b[0m\r\nType help for supported commands. No commands run on your computer.\r\n\r\n');
    this.prompt();
    if (this.startup) this.write(this.startup.replace(/\r?\n/g, '\r') + '\r');
  }
  close() {
    this.closed = true;
    this.isConnected = false;
    this.emit({ phase: 'closing', stage: 'closing' });
    this.handlers.clear(); this.output = null; this.pending = '';
  }
  onConnectionState(handler: (event: ConnectionStateEvent) => void) {
    this.handlers.add(handler); return () => { this.handlers.delete(handler); };
  }
  async onData(handler: (data: string) => void) {
    this.output = handler;
    if (this.pending) { handler(this.pending); this.pending = ''; }
    return () => { if (this.output === handler) this.output = null; };
  }
  resize(_cols: number, _rows: number) { /* xterm owns the demo viewport. */ }
  write(data: string | Uint8Array) {
    if (!this.isConnected || this.closed) return;
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    for (const char of text.replace(/\r\n/g, '\r')) {
      if (!this.isConnected) break;
      if (this.escape) {
        this.escape += char;
        if (this.escape === '\x1b[') continue;
        if (/^\x1b\[[0-9;]*$/.test(this.escape)) continue;
        if (this.escape === '\x1b[A' || this.escape === '\x1b[B') {
          this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + (char === 'A' ? -1 : 1)));
          this.input = this.history[this.historyIndex] ?? '';
          this.print('\r\x1b[2K'); this.prompt(); this.print(this.input);
        }
        this.escape = ''; continue;
      }
      if (char === '\x1b') { this.escape = char; continue; }
      if (char === '\r' || char === '\n') {
        this.print('\r\n'); const command = this.input.trim(); this.input = '';
        if (command) { this.history.push(command); this.historyIndex = this.history.length; this.execute(command); }
        if (this.isConnected) this.prompt();
      } else if (char === '\x03') { this.input = ''; this.print('^C\r\n'); this.prompt(); }
      else if (char === '\x0c') { this.print('\x1b[2J\x1b[H'); this.prompt(); this.print(this.input); }
      else if (char === '\x7f' || char === '\b') {
        if (this.input) { this.input = Array.from(this.input).slice(0, -1).join(''); this.print('\b \b'); }
      } else if (char >= ' ' && this.input.length < 8192) { this.input += char; this.print(char); }
    }
  }
  private execute(line: string) {
    const [command, ...args] = line.split(/\s+/);
    const path = normalizePath(args.find((arg) => !arg.startsWith('-')) ?? '.', this.cwd);
    const files = filesFor(this.host);
    const out = (value: string) => this.print(value.replace(/\r?\n/g, '\r\n') + '\r\n');
    try {
      switch (command) {
        case 'help': out('help  pwd  ls [-la] [path]  cd [path]  cat <path>  clear\nwhoami  hostname  uname  date  echo  ps  uptime  demo-disconnect\nPaths with spaces, pipelines and arbitrary shell programs are not supported.\nUse the session menu for simulated SFTP uploads/downloads.'); break;
        case 'pwd': out(this.cwd); break;
        case 'ls': out(listDirectory(this.host, path).map((entry) => args.some((arg) => arg.startsWith('-')) ? `${entry.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'} demo demo ${String(entry.size).padStart(6)} ${entry.name}${entry.is_dir ? '/' : ''}` : `${entry.name}${entry.is_dir ? '/' : ''}`).join('\n')); break;
        case 'cd': {
          const next = args.length ? path : HOME;
          if (files.get(next)?.content !== null) throw new Error(`Not a directory: ${next}`);
          this.cwd = next; break;
        }
        case 'cat': {
          const content = files.get(path)?.content;
          if (content == null) throw new Error(`Not a file: ${path}`);
          out(content.trimEnd()); break;
        }
        case 'clear': this.print('\x1b[2J\x1b[H'); break;
        case 'whoami': out('demo'); break;
        case 'hostname': out(this.host); break;
        case 'uname': out('Linux demo 6.8.0 x86_64 (simulated)'); break;
        case 'date': out(new Date().toISOString()); break;
        case 'echo': out(args.join(' ')); break;
        case 'uptime': out('09:00:00 up 7 days, 2 users, load average: 0.12, 0.18, 0.09 (simulated)'); break;
        case 'ps': out('USER   PID  %CPU  %MEM COMMAND\ndemo  1024   0.2   1.4 demo-web\ndemo  1025   0.1   0.8 demo-worker'); break;
        case 'demo-disconnect':
          out('Demo: connection interrupted; automatic reconnect will follow.');
          this.isConnected = false;
          this.emit({ phase: 'disconnected', stage: 'steady', failure: { code: 'REMOTE_CLOSED', category: 'network', stage: 'steady', retryable: true, technicalDetails: 'Demo disconnection requested' } });
          break;
        default: out(`Demo: unsupported command "${command}". Type help.`);
      }
    } catch (error) { out(String(error)); }
  }
}

export function createConnector(data: SessionCreationData, _sessionId: string): SessionConnector {
  if (data.type !== 'ssh' && data.type !== 'local') throw new Error('Demo supports SSH and simulated local terminals only.');
  return new DemoTerminalConnector(data);
}
