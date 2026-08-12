import { getCurrentWindow } from "@tauri-apps/api/window";

export type WindowResizePhase = "idle" | "resizing" | "settling";
export type WindowResizeSource = "window" | "layout" | "move" | "manual";

export interface WindowResizeSnapshot {
  phase: WindowResizePhase;
  source: WindowResizeSource;
  sources: readonly WindowResizeSource[];
  generation: number;
  changedAt: number;
}

type WindowResizeListener = (snapshot: WindowResizeSnapshot) => void;
type ElementResizeListener = (
  snapshot: WindowResizeSnapshot,
  rect: DOMRectReadOnly,
) => void;

const RESIZE_SETTLE_DELAY_MS = 120;
const SETTLING_IDLE_DELAY_MS = 64;

class WindowResizeCoordinator {
  private snapshot: WindowResizeSnapshot = {
    phase: "idle",
    source: "manual",
    sources: ["manual"],
    generation: 0,
    changedAt: performance.now(),
  };

  private readonly listeners = new Set<WindowResizeListener>();
  private readonly elementListeners = new Map<
    Element,
    Set<ElementResizeListener>
  >();
  private readonly affectedElements = new Set<Element>();
  private readonly burstSources = new Set<WindowResizeSource>();
  private readonly resizeObserver: ResizeObserver | null;
  private notifyAllElements = false;
  private emitFrameId: number | null = null;
  private settleTimerId: ReturnType<typeof setTimeout> | null = null;
  private idleTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              if (this.elementListeners.has(entry.target)) {
                this.affectedElements.add(entry.target);
              }
            }
            if (entries.length > 0) {
              this.signal("layout");
            }
          });

    if (typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      this.notifyAllElements = true;
      this.emit();
      this.notifyAllElements = false;
    });

    window.addEventListener("resize", this.handleBrowserResize);
    window.visualViewport?.addEventListener(
      "resize",
      this.handleBrowserResize,
    );
    window.visualViewport?.addEventListener("scroll", this.handleViewportMove);

    if ("__TAURI_INTERNALS__" in window) {
      void getCurrentWindow()
        .onResized(() => this.signal("window", true))
        .catch(() => undefined);
      void getCurrentWindow()
        .onMoved(() => this.signal("move"))
        .catch(() => undefined);
    }

    this.updateDocumentPhase();
  }

  getSnapshot(): WindowResizeSnapshot {
    return this.snapshot;
  }

  subscribe(listener: WindowResizeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  observe(element: Element, listener: ElementResizeListener): () => void {
    let listeners = this.elementListeners.get(element);
    if (!listeners) {
      listeners = new Set<ElementResizeListener>();
      this.elementListeners.set(element, listeners);
      this.resizeObserver?.observe(element);
    }
    listeners.add(listener);
    if (this.snapshot.phase !== "idle") {
      this.affectedElements.add(element);
    }

    const initialFrameId = window.requestAnimationFrame(() => {
      if (!this.elementListeners.get(element)?.has(listener)) {
        return;
      }
      listener(this.snapshot, element.getBoundingClientRect());
    });

    return () => {
      window.cancelAnimationFrame(initialFrameId);
      const currentListeners = this.elementListeners.get(element);
      currentListeners?.delete(listener);
      if (!currentListeners || currentListeners.size === 0) {
        this.elementListeners.delete(element);
        this.affectedElements.delete(element);
        this.resizeObserver?.unobserve(element);
      }
    };
  }

  requestLayout(): void {
    this.signal("layout", true);
  }

  private readonly handleBrowserResize = () => {
    this.signal("window", true);
  };

  private readonly handleViewportMove = () => {
    this.signal("move");
  };

  private signal(source: WindowResizeSource, notifyAll = false): void {
    this.burstSources.add(source);
    if (notifyAll || source === "window" || source === "manual") {
      this.notifyAllElements = true;
    }

    this.snapshot = {
      phase: "resizing",
      source,
      sources: Array.from(this.burstSources),
      generation: this.snapshot.generation + 1,
      changedAt: performance.now(),
    };
    this.updateDocumentPhase();
    this.scheduleResizeEmit();

    if (this.settleTimerId !== null) {
      clearTimeout(this.settleTimerId);
    }
    if (this.idleTimerId !== null) {
      clearTimeout(this.idleTimerId);
      this.idleTimerId = null;
    }

    this.settleTimerId = setTimeout(() => {
      this.settleTimerId = null;
      this.snapshot = {
        ...this.snapshot,
        phase: "settling",
        changedAt: performance.now(),
      };
      this.updateDocumentPhase();
      this.emit();

      this.idleTimerId = setTimeout(() => {
        this.idleTimerId = null;
        this.snapshot = {
          ...this.snapshot,
          phase: "idle",
          changedAt: performance.now(),
        };
        this.updateDocumentPhase();
        this.emit();
        this.affectedElements.clear();
        this.notifyAllElements = false;
        this.burstSources.clear();
        this.snapshot = {
          ...this.snapshot,
          source: "manual",
          sources: ["manual"],
        };
      }, SETTLING_IDLE_DELAY_MS);
    }, RESIZE_SETTLE_DELAY_MS);
  }

  private scheduleResizeEmit(): void {
    if (this.emitFrameId !== null) {
      return;
    }
    this.emitFrameId = window.requestAnimationFrame(() => {
      this.emitFrameId = null;
      this.emit();
    });
  }

  private emit(): void {
    const snapshot = this.snapshot.phase === "idle"
      ? this.snapshot
      : {
          ...this.snapshot,
          sources: Array.from(this.burstSources),
        };
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }

    const elements = this.notifyAllElements
      ? Array.from(this.elementListeners.keys())
      : Array.from(this.affectedElements);
    for (const element of elements) {
      const listeners = this.elementListeners.get(element);
      if (!listeners || listeners.size === 0) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      for (const listener of listeners) {
        listener(snapshot, rect);
      }
    }
  }

  private updateDocumentPhase(): void {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.windowResizePhase = this.snapshot.phase;
  }
}

export const windowResizeCoordinator = new WindowResizeCoordinator();
