import type {
  IDecoration,
  IDisposable,
  IMarker,
  Terminal,
} from "@xterm/xterm";
import { parseTerminalCommandLine } from "./terminal-command-line";

export const MAX_TERMINAL_TIMELINE_ENTRIES = 500;

export interface CommandTimelineAppearance {
  fontFamily: string;
  fontSize: number;
  fontWeight: string | number;
  locale: string;
}

interface CommandTimelineLabel {
  root: HTMLButtonElement;
  date: HTMLSpanElement;
  time: HTMLSpanElement;
}

interface CommandTimelineEntry {
  id: number;
  command: string;
  submittedText: string;
  timestamp: number;
  lastResolvedLine: number;
  verified: boolean;
  marker?: IMarker;
  markerDisposeDisposable?: IDisposable;
  decoration?: IDecoration;
  decorationRenderDisposable?: IDisposable;
  decorationDisposeDisposable?: IDisposable;
  anchor?: HTMLElement;
  label?: CommandTimelineLabel;
}

interface VisibleTimelineEntry {
  entry: CommandTimelineEntry;
  top: number;
  bottom: number;
  height: number;
  date: string;
}

const DEFAULT_APPEARANCE: CommandTimelineAppearance = {
  fontFamily: "monospace",
  fontSize: 14,
  fontWeight: "normal",
  locale: "zh-CN",
};

/**
 * Owns command markers and lets xterm position an invisible decoration for
 * every visible marker. Timeline labels mirror those real DOM anchors; they do
 * not calculate positions from buffer rows, scroll offsets, or terminal font
 * metrics.
 */
export class CommandTimelineController {
  private readonly terminal: Terminal;
  private readonly entries: CommandTimelineEntry[] = [];
  private readonly terminalDisposables: IDisposable[] = [];
  private readonly resizeObserver: ResizeObserver;
  private rail: HTMLElement | null = null;
  private enabled = false;
  private disposed = false;
  private nextEntryId = 0;
  private syncFrameId: number | null = null;
  private appearance = DEFAULT_APPEARANCE;
  private dateFormatter = this.createDateFormatter(DEFAULT_APPEARANCE.locale);
  private timeFormatter = this.createTimeFormatter(DEFAULT_APPEARANCE.locale);

  constructor(terminal: Terminal) {
    this.terminal = terminal;
    this.terminalDisposables.push(
      terminal.onRender(() => {
        this.ensureDecorations();
        this.scheduleSync();
      }),
      terminal.onScroll(() => this.scheduleSync()),
      terminal.onResize(() => this.scheduleSync())
    );

    this.resizeObserver = new ResizeObserver(() => this.scheduleSync());
    if (terminal.element) {
      this.resizeObserver.observe(terminal.element);
      const screen = terminal.element.querySelector<HTMLElement>(".xterm-screen");
      if (screen) {
        this.resizeObserver.observe(screen);
      }
    }
  }

  attachRail(rail: HTMLElement | null) {
    if (this.rail === rail) {
      this.scheduleSync();
      return;
    }

    if (this.rail) {
      this.resizeObserver.unobserve(this.rail);
    }
    this.entries.forEach((entry) => this.removeLabel(entry));

    this.rail = rail;
    if (rail) {
      this.resizeObserver.observe(rail);
      if (this.enabled) {
        this.entries.forEach((entry) => this.ensureLabel(entry));
      }
    }

    this.scheduleSync();
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) {
      if (enabled) {
        this.ensureDecorations();
        this.scheduleSync();
      }
      return;
    }

    this.enabled = enabled;
    if (enabled) {
      this.ensureDecorations();
      this.entries.forEach((entry) => this.ensureLabel(entry));
      this.scheduleSync();
      return;
    }

    this.entries.forEach((entry) => {
      this.removeDecoration(entry);
      this.removeLabel(entry);
    });
  }

  setAppearance(appearance: CommandTimelineAppearance) {
    const localeChanged = appearance.locale !== this.appearance.locale;
    this.appearance = appearance;

    if (localeChanged) {
      this.dateFormatter = this.createDateFormatter(appearance.locale);
      this.timeFormatter = this.createTimeFormatter(appearance.locale);
    }

    this.entries.forEach((entry) => {
      if (entry.label) {
        this.updateLabelContent(entry);
        this.updateLabelAppearance(entry.label);
      }
    });
    this.scheduleSync();
  }

  record(
    command: string,
    timestamp: number,
    submittedLine: number,
    submittedText: string
  ) {
    if (this.disposed || this.terminal.buffer.active.type !== "normal") {
      return;
    }

    const cursorLine = this.getCursorLine();
    const marker = this.terminal.registerMarker(submittedLine - cursorLine);
    if (!marker) {
      return;
    }

    const entry: CommandTimelineEntry = {
      id: this.nextEntryId += 1,
      command,
      submittedText: this.normalizeLineText(submittedText),
      timestamp,
      lastResolvedLine: submittedLine,
      verified: true,
    };
    this.bindMarker(entry, marker);

    this.entries.push(entry);
    if (this.enabled) {
      this.ensureDecoration(entry);
      this.ensureLabel(entry);
      this.scheduleSync();
    }

    while (this.entries.length > MAX_TERMINAL_TIMELINE_ENTRIES) {
      this.removeEntry(this.entries[0], true);
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    if (this.syncFrameId !== null) {
      cancelAnimationFrame(this.syncFrameId);
      this.syncFrameId = null;
    }
    this.resizeObserver.disconnect();
    this.terminalDisposables.forEach((disposable) => disposable.dispose());

    for (const entry of [...this.entries]) {
      this.removeEntry(entry, true);
    }
    this.rail = null;
  }

  private ensureDecorations() {
    if (!this.enabled || this.disposed || this.terminal.buffer.active.type !== "normal") {
      return;
    }
    this.entries.forEach((entry) => this.ensureDecoration(entry));
  }

  private ensureDecoration(entry: CommandTimelineEntry) {
    const marker = entry.marker;
    if (entry.decoration || !marker || marker.isDisposed) {
      return;
    }

    const decoration = this.terminal.registerDecoration({
      marker,
      x: 0,
      width: 1,
      layer: "top",
    });
    if (!decoration) {
      return;
    }

    entry.decoration = decoration;
    entry.decorationRenderDisposable = decoration.onRender((element) => {
      element.dataset.commandTimelineAnchor = String(entry.id);
      element.style.pointerEvents = "none";
      entry.anchor = element;
      this.scheduleSync();
    });
    entry.decorationDisposeDisposable = decoration.onDispose(() => {
      if (entry.decoration !== decoration) {
        return;
      }

      entry.decorationRenderDisposable?.dispose();
      entry.decorationRenderDisposable = undefined;
      entry.decorationDisposeDisposable = undefined;
      entry.decoration = undefined;
      entry.anchor = undefined;
      this.hideLabel(entry);
    });
  }

  private removeDecoration(entry: CommandTimelineEntry) {
    const decoration = entry.decoration;
    entry.decoration = undefined;
    entry.anchor = undefined;
    entry.decorationRenderDisposable?.dispose();
    entry.decorationDisposeDisposable?.dispose();
    entry.decorationRenderDisposable = undefined;
    entry.decorationDisposeDisposable = undefined;
    decoration?.dispose();
  }

  private ensureLabel(entry: CommandTimelineEntry) {
    if (!this.enabled || !this.rail || entry.label) {
      return;
    }

    const root = document.createElement("button");
    root.type = "button";
    root.className = "absolute left-0 z-10 w-full pr-4 text-right tabular-nums leading-none text-muted-foreground/75 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60";
    root.style.display = "none";

    const date = document.createElement("span");
    date.className = "absolute left-0 flex w-full items-center justify-end whitespace-nowrap pr-4";
    date.style.bottom = "100%";

    const time = document.createElement("span");
    time.className = "flex h-full w-full items-center justify-end whitespace-nowrap";

    const dot = document.createElement("span");
    dot.ariaHidden = "true";
    dot.className = "absolute right-0.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary/75 ring-2 ring-background/80";

    root.append(date, time, dot);
    root.addEventListener("mousedown", this.stopMouseDown);
    root.addEventListener("click", () => {
      if (!entry.marker || entry.marker.line < 0) {
        return;
      }
      this.terminal.scrollToLine(entry.marker.line);
      this.terminal.focus();
    });

    entry.label = { root, date, time };
    this.updateLabelContent(entry);
    this.updateLabelAppearance(entry.label);
    this.rail.appendChild(root);
  }

  private removeLabel(entry: CommandTimelineEntry) {
    if (!entry.label) {
      return;
    }

    entry.label.root.removeEventListener("mousedown", this.stopMouseDown);
    entry.label.root.remove();
    entry.label = undefined;
  }

  private hideLabel(entry: CommandTimelineEntry) {
    if (entry.label) {
      entry.label.root.style.display = "none";
    }
  }

  private updateLabelContent(entry: CommandTimelineEntry) {
    if (!entry.label) {
      return;
    }

    const date = this.dateFormatter.format(entry.timestamp);
    const time = this.timeFormatter.format(entry.timestamp);
    entry.label.date.textContent = date;
    entry.label.time.textContent = time;
    entry.label.root.title = `${date} ${time}`;
    entry.label.root.ariaLabel = `${date} ${time}，${entry.command}`;
  }

  private updateLabelAppearance(label: CommandTimelineLabel) {
    label.root.style.fontFamily = this.appearance.fontFamily;
    label.root.style.fontSize = `${this.appearance.fontSize}px`;
    label.root.style.fontWeight = String(this.appearance.fontWeight);
  }

  private scheduleSync() {
    if (this.disposed || this.syncFrameId !== null) {
      return;
    }

    this.syncFrameId = requestAnimationFrame(() => {
      this.syncFrameId = null;
      this.syncLabels();
    });
  }

  private syncLabels() {
    if (!this.enabled || !this.rail) {
      return;
    }

    this.reconcileEntries();
    const railRect = this.rail.getBoundingClientRect();
    const visible: VisibleTimelineEntry[] = [];

    for (const entry of this.entries) {
      this.ensureLabel(entry);
      const { anchor, label } = entry;
      if (
        !entry.verified
        || !anchor
        || !label
        || !anchor.isConnected
        || anchor.style.display === "none"
        || anchor.getClientRects().length === 0
      ) {
        this.hideLabel(entry);
        continue;
      }

      const anchorRect = anchor.getBoundingClientRect();
      if (anchorRect.bottom <= railRect.top || anchorRect.top >= railRect.bottom) {
        this.hideLabel(entry);
        continue;
      }

      const top = anchorRect.top - railRect.top;
      const height = anchorRect.height;
      label.root.style.display = "block";
      label.root.style.top = `${top}px`;
      label.root.style.height = `${height}px`;
      label.date.style.height = `${height}px`;

      visible.push({
        entry,
        top,
        bottom: top + height,
        height,
        date: this.dateFormatter.format(entry.timestamp),
      });
    }

    visible.sort((a, b) => a.top - b.top);
    const displayedDates = new Set<string>();
    const railHeight = railRect.height;

    for (const item of visible) {
      const dateTop = item.top - item.height;
      const dateFitsRail = dateTop >= 0 && item.top <= railHeight;
      const dateOverlapsCommand = visible.some((other) => (
        other !== item
        && other.top < item.top
        && other.bottom > dateTop + 0.5
      ));
      const showDate = (
        !displayedDates.has(item.date)
        && dateFitsRail
        && !dateOverlapsCommand
      );
      item.entry.label!.date.style.display = showDate ? "flex" : "none";
      if (showDate) {
        displayedDates.add(item.date);
      }
    }
  }

  private reconcileEntries() {
    if (this.terminal.buffer.active.type !== "normal") {
      this.entries.forEach((entry) => {
        entry.verified = false;
        this.hideLabel(entry);
      });
      return;
    }

    for (const entry of this.entries) {
      const resolvedLine = this.findCommandLine(entry);
      if (resolvedLine === undefined) {
        entry.verified = false;
        this.hideLabel(entry);
        continue;
      }

      entry.verified = true;
      entry.lastResolvedLine = resolvedLine;
      if (!entry.marker || entry.marker.line !== resolvedLine) {
        this.replaceMarker(entry, resolvedLine);
      }
    }
  }

  private findCommandLine(entry: CommandTimelineEntry) {
    const buffer = this.terminal.buffer.active;
    if (buffer.length === 0) {
      return undefined;
    }

    const lastLine = buffer.length - 1;
    const expectedLine = Math.max(0, Math.min(lastLine, entry.lastResolvedLine));
    if (this.lineMatchesEntry(expectedLine, entry)) {
      return expectedLine;
    }

    const markerLine = entry.marker && !entry.marker.isDisposed
      ? entry.marker.line
      : -1;
    if (
      markerLine >= 0
      && markerLine <= lastLine
      && markerLine !== expectedLine
      && this.lineMatchesEntry(markerLine, entry)
    ) {
      return markerLine;
    }

    const maxDistance = Math.min(256, lastLine);
    const searchedLines = new Set<number>([expectedLine, markerLine]);
    const centers = markerLine >= 0
      ? [expectedLine, markerLine]
      : [expectedLine];

    for (const center of centers) {
      for (let distance = 1; distance <= maxDistance; distance += 1) {
        const before = center - distance;
        if (
          before >= 0
          && !searchedLines.has(before)
          && this.lineMatchesEntry(before, entry)
        ) {
          return before;
        }
        searchedLines.add(before);

        const after = center + distance;
        if (
          after <= lastLine
          && !searchedLines.has(after)
          && this.lineMatchesEntry(after, entry)
        ) {
          return after;
        }
        searchedLines.add(after);

        if (before < 0 && after > lastLine) {
          break;
        }
      }
    }

    return undefined;
  }

  private lineMatchesEntry(lineIndex: number, entry: CommandTimelineEntry) {
    const line = this.terminal.buffer.active.getLine(lineIndex);
    if (!line) {
      return false;
    }

    const text = this.normalizeLineText(line.translateToString(true));
    if (text === entry.submittedText) {
      return true;
    }

    const parsed = parseTerminalCommandLine(text);
    return parsed.commandStartX > 0 && parsed.command === entry.command;
  }

  private replaceMarker(entry: CommandTimelineEntry, line: number) {
    const marker = this.terminal.registerMarker(line - this.getCursorLine());
    if (!marker) {
      entry.verified = false;
      return;
    }

    this.removeDecoration(entry);
    entry.markerDisposeDisposable?.dispose();
    entry.markerDisposeDisposable = undefined;
    if (entry.marker && !entry.marker.isDisposed) {
      entry.marker.dispose();
    }

    this.bindMarker(entry, marker);
    this.ensureDecoration(entry);
  }

  private bindMarker(entry: CommandTimelineEntry, marker: IMarker) {
    entry.marker = marker;
    entry.markerDisposeDisposable = marker.onDispose(() => {
      if (entry.marker !== marker) {
        return;
      }

      entry.marker = undefined;
      entry.markerDisposeDisposable = undefined;
      entry.anchor = undefined;
      entry.verified = false;
      this.hideLabel(entry);
      this.scheduleSync();
    });
  }

  private getCursorLine() {
    const buffer = this.terminal.buffer.active;
    return buffer.baseY + buffer.cursorY;
  }

  private normalizeLineText(text: string) {
    return text.replace(/\u00a0/g, " ").replace(/\s+$/, "");
  }

  private removeEntry(entry: CommandTimelineEntry, disposeMarker: boolean) {
    const index = this.entries.indexOf(entry);
    if (index === -1) {
      return;
    }

    this.entries.splice(index, 1);
    this.removeDecoration(entry);
    this.removeLabel(entry);
    entry.markerDisposeDisposable?.dispose();
    entry.markerDisposeDisposable = undefined;
    if (disposeMarker && entry.marker && !entry.marker.isDisposed) {
      entry.marker.dispose();
    }
    entry.marker = undefined;
  }

  private createDateFormatter(locale: string) {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  private createTimeFormatter(locale: string) {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }

  private readonly stopMouseDown = (event: MouseEvent) => {
    event.stopPropagation();
  };
}
