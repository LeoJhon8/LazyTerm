import { Terminal, type ITerminalAddon } from "@xterm/xterm";

import {
  parseTerminalCommandLine,
  type ParsedTerminalCommandLine,
} from "./terminal-command-line";

export interface AutocompleteSuggestEvent {
  active: boolean;
  buffer: string;
  x: number;
  y: number;
  parentHeight?: number;
  cellHeight?: number;
}

const EMPTY_LINE_STATE: ParsedTerminalCommandLine = {
  rawLine: "",
  command: "",
  commandStartX: 0,
  cursorCommandOffset: 0,
  isCursorAtEnd: true,
};

export class AutocompleteTerminalAddon implements ITerminalAddon {
  private _terminal?: Terminal;
  private _disposables: { dispose: () => void }[] = [];

  public inputBuffer = "";
  public isActive = false;

  private _onInsert?: (text: string) => void;
  private _ignoreNextKey = false;
  private _lastX = 0;
  private _lastY = 0;

  private _cachedCellWidth = 0;
  private _cachedCellHeight = 0;
  private _cachedParentRect: DOMRect | null = null;
  private _cachedTermRect: DOMRect | null = null;
  private _cacheTick = 0;
  private _suppressedAcceptKey: string | null = null;

  private readonly sessionId: string;
  private _hasSuggestions = false;
  private _hasSelectedSuggestion = false;
  private _lineStateCache: ParsedTerminalCommandLine = EMPTY_LINE_STATE;
  private _trackingCurrentLine = false;
  private _pendingLineSync = false;

  private _onStatusChange = (e: Event) => {
    const customEvent = e as CustomEvent;
    this._hasSuggestions = customEvent.detail.hasSuggestions;
    this._hasSelectedSuggestion = customEvent.detail.hasSelectedSuggestion;
  };

  constructor(sessionId: string, onInsert?: (text: string) => void) {
    this.sessionId = sessionId;
    this._onInsert = onInsert;
  }

  public activate(terminal: Terminal): void {
    this._terminal = terminal;

    this._disposables.push(
      terminal.onKey((e) => this._handleKey(e.key, e.domEvent))
    );
    this._disposables.push(
      terminal.onWriteParsed(() => {
        if (this._trackingCurrentLine || this._pendingLineSync || this.isActive) {
          this._syncFromTerminalLine();
        }
      })
    );
    this._disposables.push(
      terminal.onCursorMove(() => {
        if (this._trackingCurrentLine || this._pendingLineSync || this.isActive) {
          this._syncFromTerminalLine();
        }
      })
    );

    window.addEventListener(`autocomplete-status-${this.sessionId}`, this._onStatusChange);
    this._disposables.push({
      dispose: () => {
        window.removeEventListener(`autocomplete-status-${this.sessionId}`, this._onStatusChange);
      },
    });

    terminal.attachCustomKeyEventHandler((e) => {
      if (this._suppressedAcceptKey === e.key) {
        if (e.type === "keyup") {
          this._suppressedAcceptKey = null;
        }
        return false;
      }

      if (this.isActive && this._hasSuggestions) {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          if (e.type === "keydown") {
            window.dispatchEvent(
              new CustomEvent("lazy-term-autocomplete-key", {
                detail: { key: e.key, shiftKey: e.shiftKey },
              })
            );
          }
          return false;
        }

        if ((e.key === "Tab" || e.key === "Enter") && this._hasSelectedSuggestion) {
          if (e.type === "keydown") {
            this._suppressedAcceptKey = e.key;
            window.dispatchEvent(
              new CustomEvent("lazy-term-autocomplete-key", {
                detail: { key: e.key, shiftKey: e.shiftKey },
              })
            );
          }
          return false;
        }

        if (e.key === "Escape") {
          this._resetTracking();
          this._cancel();
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

    if (domEvent.key === "Enter") {
      this._resetTracking();
      this._cancel();
      return;
    }

    if (domEvent.ctrlKey || domEvent.metaKey || domEvent.altKey) {
      this._hideSuggestions();
      return;
    }

    if (
      domEvent.key === "Backspace" ||
      domEvent.key === "Delete" ||
      domEvent.key === "Tab" ||
      domEvent.key === "ArrowLeft" ||
      domEvent.key === "ArrowRight" ||
      domEvent.key === "ArrowUp" ||
      domEvent.key === "ArrowDown" ||
      domEvent.key === "Home" ||
      domEvent.key === "End" ||
      key.length === 1
    ) {
      this._trackingCurrentLine = true;
      this._pendingLineSync = true;
      return;
    }

    this._hideSuggestions();
  }

  private _readTerminalLineState() {
    if (!this._terminal) {
      return null;
    }

    const activeBuffer = this._terminal.buffer.active;
    const line = activeBuffer.getLine(activeBuffer.baseY + activeBuffer.cursorY);
    if (!line) {
      return null;
    }

    return parseTerminalCommandLine(line.translateToString(true), activeBuffer.cursorX);
  }

  private _syncFromTerminalLine() {
    const nextState = this._readTerminalLineState();
    if (!nextState) {
      if (!this._pendingLineSync) {
        this._resetTracking();
        this._cancel();
      }
      return;
    }

    const lineChanged =
      nextState.rawLine !== this._lineStateCache.rawLine ||
      nextState.command !== this._lineStateCache.command ||
      nextState.cursorCommandOffset !== this._lineStateCache.cursorCommandOffset;

    if (!lineChanged && !this._pendingLineSync && !this.isActive) {
      return;
    }

    this._pendingLineSync = false;
    this._lineStateCache = nextState;
    this.inputBuffer = nextState.command;

    if (!nextState.command.trim()) {
      this._resetTracking();
      this._cancel();
      return;
    }

    this._trackingCurrentLine = true;

    if (!nextState.isCursorAtEnd) {
      this._hideSuggestions();
      return;
    }

    this._triggerSuggest(true);
  }

  private _refreshDomCache() {
    const now = performance.now();
    if (now - this._cacheTick < 200 && this._cachedParentRect) {
      return;
    }
    this._cacheTick = now;

    if (!this._terminal) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const core = (this._terminal as any)._core;
    if (core) {
      this._cachedCellWidth = core._renderService?.dimensions?.css?.cell?.width || 9;
      this._cachedCellHeight = core._renderService?.dimensions?.css?.cell?.height || 18;
    }

    const screenElement =
      this._terminal.element?.querySelector(".xterm-screen") || this._terminal.element;
    this._cachedTermRect = screenElement?.getBoundingClientRect() ?? null;

    const offsetParent = this._terminal.element?.closest("main") || document.body;
    this._cachedParentRect = offsetParent.getBoundingClientRect();
  }

  private _getCursorPixelRect() {
    if (!this._terminal) {
      return { x: this._lastX, y: this._lastY };
    }

    this._refreshDomCache();

    if (!this._cachedTermRect || !this._cachedParentRect) {
      return { x: this._lastX, y: this._lastY };
    }

    const cursorX = this._terminal.buffer.active.cursorX;
    const cursorY = this._terminal.buffer.active.cursorY;

    const relativeLeft = this._cachedTermRect.left - this._cachedParentRect.left;
    const relativeTop = this._cachedTermRect.top - this._cachedParentRect.top;

    const x = relativeLeft + cursorX * this._cachedCellWidth;
    const y = relativeTop + cursorY * this._cachedCellHeight + this._cachedCellHeight + 4;

    this._lastX = x;
    this._lastY = y;

    return {
      x,
      y,
      parentHeight: this._cachedParentRect.height,
      cellHeight: this._cachedCellHeight,
    };
  }

  private _triggerSuggest(active: boolean) {
    this.isActive = active;
    const rect = active
      ? this._getCursorPixelRect()
      : { x: 0, y: 0, parentHeight: 0, cellHeight: 0 };

    window.dispatchEvent(
      new CustomEvent<AutocompleteSuggestEvent>(`autocomplete-suggest-${this.sessionId}`, {
        detail: {
          active,
          buffer: this.inputBuffer,
          x: rect.x,
          y: rect.y,
          parentHeight: rect.parentHeight,
          cellHeight: rect.cellHeight,
        },
      })
    );
  }

  private _hideSuggestions() {
    if (this.isActive) {
      this._triggerSuggest(false);
    }
  }

  private _resetTracking() {
    this._trackingCurrentLine = false;
    this._pendingLineSync = false;
    this._lineStateCache = EMPTY_LINE_STATE;
  }

  public insertCompletion(text: string) {
    const nextState = this._readTerminalLineState();
    if (nextState) {
      this._lineStateCache = nextState;
      this.inputBuffer = nextState.command;
    }

    if (!text) {
      this._cancel();
      return;
    }

    if (text.startsWith(this.inputBuffer)) {
      const remainder = text.substring(this.inputBuffer.length);
      this._onInsert?.(remainder);
    } else {
      this._onInsert?.("\b".repeat(this.inputBuffer.length) + text);
    }

    this._trackingCurrentLine = true;
    this._pendingLineSync = true;
    this._cancel();
  }

  public forceCancel() {
    this._resetTracking();
    this._cancel();
  }

  private _cancel() {
    if (this.isActive || this.inputBuffer.length > 0) {
      this.inputBuffer = "";
      this._triggerSuggest(false);
    }
  }

  public dispose(): void {
    this._resetTracking();
    this._disposables.forEach((disposable) => disposable.dispose());
    this.isActive = false;
  }
}
