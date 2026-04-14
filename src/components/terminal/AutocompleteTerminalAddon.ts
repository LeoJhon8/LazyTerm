import { Terminal, type ITerminalAddon } from "@xterm/xterm";

export interface AutocompleteSuggestEvent {
  active: boolean;
  buffer: string;
  x: number;
  y: number;
}

export class AutocompleteTerminalAddon implements ITerminalAddon {
  private _terminal?: Terminal;
  private _disposables: { dispose: () => void }[] = [];
  
  public inputBuffer: string = "";
  private _onInsert?: (text: string) => void;
  public isActive: boolean = false;
  private _ignoreNextKey: boolean = false;
  private _lastX: number = 0;
  private _lastY: number = 0;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // 缓存 DOM 测量值，避免每次按键都查询 DOM
  private _cachedCellWidth: number = 0;
  private _cachedCellHeight: number = 0;
  private _cachedParentRect: DOMRect | null = null;
  private _cachedTermRect: DOMRect | null = null;
  private _cacheTick: number = 0;

  private sessionId: string;

  constructor(
    sessionId: string,
    onInsert?: (text: string) => void
  ) {
    this.sessionId = sessionId;
    this._onInsert = onInsert;
  }

  public activate(terminal: Terminal): void {
    this._terminal = terminal;

    // 监听按键事件提取输入字符串
    this._disposables.push(
      terminal.onKey((e) => this._handleKey(e.key, e.domEvent))
    );

    // 拦截特定按键，当 Autocomplete 处于激活状态时阻止 Xterm 通过 PTY 传递给服务器
    terminal.attachCustomKeyEventHandler((e) => {
      if (this.isActive) {
        if (e.key === "Tab" || e.key === "ArrowUp" || e.key === "ArrowDown") {
          if (e.type === "keydown") {
            const event = new CustomEvent("lazy-term-autocomplete-key", { 
              detail: { key: e.key, shiftKey: e.shiftKey } 
            });
            window.dispatchEvent(event);
          }
          return false; // 阻止 xterm 拦截
        } else if (e.key === "Enter") {
           if (e.type === "keydown") {
             const event = new CustomEvent("lazy-term-autocomplete-key", { 
               detail: { key: e.key, shiftKey: e.shiftKey } 
             });
             window.dispatchEvent(event);
           }
           return false;
        } else if (e.key === "Escape") {
           this._cancel();
           // 不拦截 Escape，允许它重置其他逻辑
           return true; 
        }
      }
      return true;
    });
  }

  private _handleKey(key: string, domEvent: KeyboardEvent) {
    if (this._ignoreNextKey) {
      this._ignoreNextKey = false;
      return;
    }

    if (domEvent.key === "Enter" || domEvent.key === "ArrowUp" || domEvent.key === "ArrowDown" || domEvent.ctrlKey || domEvent.metaKey || domEvent.altKey) {
       if (!this.isActive) {
           this._cancel();
       }
       return;
    }

    if (domEvent.key === "Backspace") {
      if (this.inputBuffer.length > 0) {
        this.inputBuffer = this.inputBuffer.substring(0, this.inputBuffer.length - 1);
      }
    } else if (key.length === 1) { 
      // 空格断开补全的匹配单词
      if (key === " ") {
        this._cancel();
        return;
      }
      this.inputBuffer += key;
    } else {
      // 其他控制符号
      this._cancel();
      return;
    }

    // 使用 debounce 避免每次按键都触发建议更新
    this._scheduleSuggest();
  }

  private _scheduleSuggest() {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      if (this.inputBuffer.length > 0) {
        this._triggerSuggest(true);
      } else {
        this._cancel();
      }
    }, 80);
  }

  /**
   * 刷新 DOM 缓存。每次调用最多每 200ms 重新测量一次，其间使用缓存值。
   */
  private _refreshDomCache() {
    const now = performance.now();
    if (now - this._cacheTick < 200 && this._cachedParentRect) return;
    this._cacheTick = now;

    if (!this._terminal) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (this._terminal as any)._core;
    if (core) {
      this._cachedCellWidth = core._renderService?.dimensions?.css?.cell?.width || 9;
      this._cachedCellHeight = core._renderService?.dimensions?.css?.cell?.height || 18;
    }

    const screenElement = this._terminal.element?.querySelector('.xterm-screen') || this._terminal.element;
    this._cachedTermRect = screenElement?.getBoundingClientRect() ?? null;

    const offsetParent = this._terminal.element?.closest('main') || document.body;
    this._cachedParentRect = offsetParent.getBoundingClientRect();
  }

  private _getCursorPixelRect() {
    if (!this._terminal) return { x: this._lastX, y: this._lastY };

    this._refreshDomCache();

    if (!this._cachedTermRect || !this._cachedParentRect) {
      return { x: this._lastX, y: this._lastY };
    }

    const cursorX = this._terminal.buffer.active.cursorX;
    const cursorY = this._terminal.buffer.active.cursorY;

    const relativeLeft = this._cachedTermRect.left - this._cachedParentRect.left;
    const relativeTop = this._cachedTermRect.top - this._cachedParentRect.top;

    const x = relativeLeft + (cursorX * this._cachedCellWidth);
    const y = relativeTop + (cursorY * this._cachedCellHeight) + this._cachedCellHeight + 4;

    this._lastX = x;
    this._lastY = y;

    return { x, y };
  }

  private _triggerSuggest(active: boolean) {
    this.isActive = active;
    const rect = active ? this._getCursorPixelRect() : { x: 0, y: 0 };
    window.dispatchEvent(new CustomEvent(`autocomplete-suggest-${this.sessionId}`, {
      detail: { active, buffer: this.inputBuffer, x: rect.x, y: rect.y }
    }));
  }

  public insertCompletion(text: string) {
      if (text.startsWith(this.inputBuffer)) {
          const remainder = text.substring(this.inputBuffer.length);
          this._onInsert?.(remainder);
      } else {
          // 如果用户补全的是个近义词或中间匹配，我们把它补全上去
          this._onInsert?.("\b".repeat(this.inputBuffer.length) + text);
      }
      this._cancel();
  }

  public forceCancel() {
    this._cancel();
  }

  private _cancel() {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    // 只在状态确实改变时发送事件，避免无谓的 React 重渲染
    if (this.isActive || this.inputBuffer.length > 0) {
      this.inputBuffer = "";
      this._triggerSuggest(false);
    }
  }

  public dispose(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._disposables.forEach(d => d.dispose());
    this.isActive = false;
  }
}
