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
  private _onSuggest?: (evt: AutocompleteSuggestEvent) => void;
  private _onInsert?: (text: string) => void;
  public isActive: boolean = false;
  private _ignoreNextKey: boolean = false;
  private _lastX: number = 0;
  private _lastY: number = 0;

  constructor(
    private sessionId: string,
    onInsert?: (text: string) => void
  ) {
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

    // 利用 setTimetout 留给 PTY Echo 以及底层 xterm 游标刷新的时间
    setTimeout(() => {
      if (this.inputBuffer.length > 0) {
        this._triggerSuggest(true);
      } else {
        this._cancel();
      }
    }, 20);
  }

  private _getCursorPixelRect() {
    if (!this._terminal) return { x: this._lastX, y: this._lastY };
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (this._terminal as any)._core;
    if (!core) return { x: this._lastX, y: this._lastY };

    // 获取渲染引擎里的方块字符实际尺寸
    const cellWidth = core._renderService?.dimensions?.css?.cell?.width || 9;
    const cellHeight = core._renderService?.dimensions?.css?.cell?.height || 18;

    const cursorX = this._terminal.buffer.active.cursorX;
    const cursorY = this._terminal.buffer.active.cursorY;
    
    // 更精准的获取渲染区域
    const screenElement = this._terminal.element?.querySelector('.xterm-screen') || this._terminal.element;
    const termRect = screenElement?.getBoundingClientRect();
    if (!termRect) return { x: this._lastX, y: this._lastY };

    // 获取离他最近的定位父级（即 TerminalViewClass 的 main 容器）
    const offsetParent = this._terminal.element?.closest('main') || document.body;
    const parentRect = offsetParent.getBoundingClientRect();

    // 计算实际位置，因为我们的 UI 组件是 absolute 渲染在 main 里面的，所以扣除 parent 的偏移
    const relativeLeft = termRect.left - parentRect.left;
    const relativeTop = termRect.top - parentRect.top;

    const x = relativeLeft + (cursorX * cellWidth);
    const y = relativeTop + (cursorY * cellHeight) + cellHeight + 4;

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
    this.inputBuffer = "";
    this._triggerSuggest(false);
  }

  public dispose(): void {
    this._disposables.forEach(d => d.dispose());
    this.isActive = false;
  }
}
