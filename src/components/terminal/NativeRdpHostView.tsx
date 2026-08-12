import { useEffect, useRef, useState } from "react";

import { logger } from "@/lib/logger";
import { useSettingsStore } from "@/store/settings";
import { useTabsStore } from "@/store/tabs";
import { currentMonitor, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";

import type {
  INativeRdpConnector,
  NativeHostRect,
  NativeRdpStatePayload,
} from "@/types/terminal";
import { ConnectionStatusOverlay } from "./ConnectionStatusOverlay";
import { useI18n } from "@/i18n";
import { windowResizeCoordinator } from "@/services/windowResizeCoordinator";

const NATIVE_RDP_OVERLAY_EVENT = "lazy-native-rdp-overlay";
const READY_STATES: NativeRdpStatePayload["state"][] = ["connected"];
const FAILED_STATES: NativeRdpStatePayload["state"][] = ["error"];
const DISCONNECTED_STATES: NativeRdpStatePayload["state"][] = ["disconnected", "closed"];
const HISTORY_READY_STATES: NativeRdpStatePayload["state"][] = ["hidden", "visible", "focused", "connected"];
const REACTIVATION_GRACE_MS = 700;
const NATIVE_RDP_LIVE_LAYOUT_INTERVAL_MS = 60;
const DPI_SCALE_CACHE_MS = 2_000;

let cachedDpiScale = 1;
let cachedDpiScaleAt = 0;
let dpiScaleRequest: Promise<number> | null = null;

async function resolveDpiVirtualizationScale(forceRefresh = false): Promise<number> {
  const now = performance.now();
  if (!forceRefresh && now - cachedDpiScaleAt < DPI_SCALE_CACHE_MS) {
    return cachedDpiScale;
  }
  if (dpiScaleRequest) {
    return dpiScaleRequest;
  }

  dpiScaleRequest = Promise.all([currentMonitor(), primaryMonitor()])
    .then(([current, primary]) => {
      if (!current || !primary) {
        return 1;
      }

      const onPrimary = current.position.x === primary.position.x
        && current.position.y === primary.position.y
        && current.size.width === primary.size.width
        && current.size.height === primary.size.height;

      return onPrimary ? 1 : Math.max(1, primary.scaleFactor || 1);
    })
    .then((scale) => {
      cachedDpiScale = scale;
      cachedDpiScaleAt = performance.now();
      return scale;
    })
    .finally(() => {
      dpiScaleRequest = null;
    });

  return dpiScaleRequest;
}

function resolveOverlayMode(
  payload: NativeRdpStatePayload,
  hasConnectionHistory: boolean,
): "connecting" | "failed" | "disconnected" | "none" {
  if (FAILED_STATES.includes(payload.state)) {
    return hasConnectionHistory ? "disconnected" : "failed";
  }

  if (DISCONNECTED_STATES.includes(payload.state)) {
    return hasConnectionHistory ? "disconnected" : "failed";
  }

  if (READY_STATES.includes(payload.state)) {
    return "none";
  }

  return "connecting";
}

// Returns physical screen coordinates so the Win32 sidecar can use them with
// SetWindowPos without any child-window DPI or parent-origin adjustments.
async function readScreenRect(
  viewportRect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  refreshDpiScale = false,
): Promise<NativeHostRect> {
  const scaleFactor = window.devicePixelRatio || 1;
  // innerPosition() gives the content-area origin in physical screen pixels.
  const winPos = await getCurrentWindow().innerPosition();
  const rect = {
    x: winPos.x + viewportRect.left * scaleFactor,
    y: winPos.y + viewportRect.top * scaleFactor,
    width: Math.max(0, viewportRect.width * scaleFactor),
    height: Math.max(0, viewportRect.height * scaleFactor),
  };
  const virtualizationScale = await resolveDpiVirtualizationScale(refreshDpiScale);

  return {
    x: Math.round(rect.x * virtualizationScale),
    y: Math.round(rect.y * virtualizationScale),
    width: Math.max(0, Math.round(rect.width * virtualizationScale)),
    height: Math.max(0, Math.round(rect.height * virtualizationScale)),
    scaleFactor: scaleFactor * virtualizationScale,
  };
}

async function readHostRect(
  element: HTMLDivElement,
  refreshDpiScale = false,
): Promise<NativeHostRect> {
  return readScreenRect(element.getBoundingClientRect(), refreshDpiScale);
}

function readMenuOverlayBounds(): DOMRect | null {
  const menuElements = Array.from(document.body.querySelectorAll<HTMLElement>([
    "[role='menu'][data-state='open']",
    "[role='listbox'][data-state='open']",
  ].join(", ")));
  const rects = menuElements
    .map((element) => (
      element.closest<HTMLElement>("[data-radix-popper-content-wrapper]") ?? element
    ).getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) {
    return null;
  }

  const padding = 8;
  const left = Math.min(...rects.map((rect) => rect.left)) - padding;
  const top = Math.min(...rects.map((rect) => rect.top)) - padding;
  const right = Math.max(...rects.map((rect) => rect.right)) + padding;
  const bottom = Math.max(...rects.map((rect) => rect.bottom)) + padding;
  return new DOMRect(left, top, right - left, bottom - top);
}

function resolveOverlayScreenRect(
  overlayBounds: DOMRect,
  container: HTMLDivElement,
  hostRect: NativeHostRect,
): NativeHostRect {
  const containerBounds = container.getBoundingClientRect();
  const scaleFactor = hostRect.scaleFactor || 1;
  return {
    x: Math.round(hostRect.x + (overlayBounds.left - containerBounds.left) * scaleFactor),
    y: Math.round(hostRect.y + (overlayBounds.top - containerBounds.top) * scaleFactor),
    width: Math.max(0, Math.round(overlayBounds.width * scaleFactor)),
    height: Math.max(0, Math.round(overlayBounds.height * scaleFactor)),
    scaleFactor,
  };
}

function sameHostRect(a: NativeHostRect | null, b: NativeHostRect): boolean {
  return !!a
    && a.x === b.x
    && a.y === b.y
    && a.width === b.width
    && a.height === b.height
    && a.scaleFactor === b.scaleFactor;
}

export function NativeRdpHostView({
  sessionId,
  hostLabel,
  connector,
  isVisible,
  onVisualReady,
}: {
  sessionId: string;
  hostLabel: string;
  connector: INativeRdpConnector;
  isVisible: boolean;
  onVisualReady?: () => void;
}) {
  const { t } = useI18n();
  const initialState = connector.getLatestState();
  const initialHasConnectionHistory = connector.hasEverConnected() || HISTORY_READY_STATES.includes(initialState.state);
  const initialOverlayMode = resolveOverlayMode(initialState, initialHasConnectionHistory);
  const reconnectSession = useTabsStore((state) => state.reconnectSession);
  const session = useTabsStore((store) => store.sessions.find((item) => item.id === sessionId));
  const connectionStatus = session?.connectionStatus;
  const hasBackgroundImage = useSettingsStore((state) => state.backgroundImageEnabled && !!state.backgroundImage);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isVisibleRef = useRef(isVisible);
  const hasReachedReadyStateRef = useRef(initialHasConnectionHistory || initialOverlayMode === "none");
  const activationGraceUntilRef = useRef(
    initialHasConnectionHistory ? performance.now() + REACTIVATION_GRACE_MS : 0
  );
  const [blockingOverlayVisible, setBlockingOverlayVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [overlayMode, setOverlayMode] = useState<"connecting" | "failed" | "disconnected" | "none">(initialOverlayMode);
  const [state, setState] = useState<NativeRdpStatePayload>(initialState);
  const stateRef = useRef(state);
  const [hostRectMounted, setHostRectMounted] = useState(false);
  const visualReadyNotifiedRef = useRef(false);
  const lastMountedRectRef = useRef<NativeHostRect | null>(null);

  isVisibleRef.current = isVisible;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let disposed = false;

    connector.onState((payload) => {
      if (!disposed) {
        setRetrying(false);
        setState(payload);
        const hasConnectionHistory = hasReachedReadyStateRef.current || connector.hasEverConnected();
        const withinActivationGrace = hasConnectionHistory && performance.now() < activationGraceUntilRef.current;

        if (FAILED_STATES.includes(payload.state)) {
          setOverlayMode(withinActivationGrace ? "connecting" : (hasConnectionHistory ? "disconnected" : "failed"));
          return;
        }

        if (DISCONNECTED_STATES.includes(payload.state)) {
          setOverlayMode(withinActivationGrace ? "connecting" : (hasConnectionHistory ? "disconnected" : "failed"));
          if (!hasConnectionHistory && payload.state !== "error") {
            setState({
              ...payload,
              state: "error",
              detail: payload.detail ?? t("Windows 远程桌面连接未能建立。"),
            });
          }
          return;
        }

        if (READY_STATES.includes(payload.state)) {
          hasReachedReadyStateRef.current = true;
          activationGraceUntilRef.current = 0;
          setOverlayMode("none");
          return;
        }

        if (!hasReachedReadyStateRef.current) {
          setOverlayMode("connecting");
        } else if (payload.state === "connecting" || payload.state === "launching") {
          setOverlayMode("connecting");
        }
      }
    }).catch((error) => {
      if (!disposed) {
        const hasConnectionHistory = hasReachedReadyStateRef.current || connector.hasEverConnected();
        setRetrying(false);
        hasReachedReadyStateRef.current = hasConnectionHistory;
        setOverlayMode(hasConnectionHistory ? "disconnected" : "failed");
        setState({
          state: "error",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    });

    const disposeClose = connector.onClose(() => {
      if (!disposed) {
        if (stateRef.current.state === "error") {
          return;
        }

        const hasConnectionHistory = hasReachedReadyStateRef.current || connector.hasEverConnected();
        setRetrying(false);
        hasReachedReadyStateRef.current = hasConnectionHistory;
        setOverlayMode(hasConnectionHistory ? "disconnected" : "failed");
        setState({
          state: hasConnectionHistory ? "closed" : "error",
          detail: hasConnectionHistory
            ? t("Native RDP 原生宿主会话已断开。")
            : (stateRef.current.detail ?? t("Windows 远程桌面连接未能建立。")),
        });
      }
    });

    return () => {
      disposed = true;
      disposeClose();
    };
  }, [connector]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    let disposed = false;
    let initialMountDone = false;
    let pushInFlight = false;
    let pendingPush: {
      initial: boolean;
      generation: number;
      refreshDpiScale: boolean;
    } | null = null;
    let lastLivePushAt = 0;
    setHostRectMounted(false);
    void connector.setVisible(false);

    const drainPushes = async () => {
      if (pushInFlight || disposed) {
        return;
      }

      pushInFlight = true;
      try {
        while (pendingPush && !disposed) {
          const request = pendingPush;
          pendingPush = null;
          const rect = await readHostRect(element, request.refreshDpiScale);
          if (disposed) {
            return;
          }

          const queuedAfterMeasure = pendingPush as {
            initial: boolean;
            generation: number;
            refreshDpiScale: boolean;
          } | null;
          if (
            !request.initial
            && queuedAfterMeasure
            && queuedAfterMeasure.generation > request.generation
          ) {
            continue;
          }

          if (!request.initial && sameHostRect(lastMountedRectRef.current, rect)) {
            continue;
          }

          const mountedRect = {
            ...rect,
            generation: request.generation,
          };
          await connector.mount(mountedRect);
          lastMountedRectRef.current = mountedRect;
          if (request.initial && !initialMountDone) {
            initialMountDone = true;
            setHostRectMounted(true);
          }
        }
      } catch (error) {
        if (!disposed) {
          logger.error("FE/terminal-view/native-rdp", "Mount failed", { error });
        }
      } finally {
        pushInFlight = false;
        if (pendingPush && !disposed) {
          void drainPushes();
        }
      }
    };

    const requestPush = (
      initial: boolean,
      generation: number,
      refreshDpiScale: boolean,
    ) => {
      if (disposed || (!initial && !initialMountDone)) {
        return;
      }
      if (!pendingPush) {
        pendingPush = { initial, generation, refreshDpiScale };
      } else if (generation >= pendingPush.generation) {
        pendingPush = {
          initial: pendingPush.initial || initial,
          generation,
          refreshDpiScale,
        };
      }
      void drainPushes();
    };

    const requestLivePush = (generation: number) => {
      const now = performance.now();
      if (now - lastLivePushAt < NATIVE_RDP_LIVE_LAYOUT_INTERVAL_MS) {
        return;
      }
      lastLivePushAt = now;
      requestPush(false, generation, false);
    };

    const resizeUnsubscribe = windowResizeCoordinator.observe(element, (snapshot) => {
      if (
        !isVisibleRef.current
        || !snapshot.sources.some((source) => source !== "move")
      ) {
        return;
      }
      if (snapshot.phase === "resizing") {
        requestLivePush(snapshot.generation);
      } else if (snapshot.phase === "idle") {
        requestPush(false, snapshot.generation, true);
      }
    });

    const windowUnsubscribe = windowResizeCoordinator.subscribe((snapshot) => {
      if (!isVisibleRef.current || !snapshot.sources.includes("move")) {
        return;
      }
      if (snapshot.phase === "resizing") {
        requestLivePush(snapshot.generation);
      } else if (snapshot.phase === "idle") {
        requestPush(false, snapshot.generation, false);
      }
    });

    const initialPushFrame = requestAnimationFrame(() => {
      requestPush(true, windowResizeCoordinator.getSnapshot().generation, true);
    });

    return () => {
      disposed = true;
      setHostRectMounted(false);
      lastMountedRectRef.current = null;
      cancelAnimationFrame(initialPushFrame);
      resizeUnsubscribe();
      windowUnsubscribe();
      void connector.setVisible(false);
    };
  }, [connector]);

  useEffect(() => {
    if (!onVisualReady || visualReadyNotifiedRef.current) {
      return;
    }

    const visualReadyStates: NativeRdpStatePayload["state"][] = ["mounted", "visible", "focused", "connected"];
    if (!visualReadyStates.includes(state.state)) {
      return;
    }

    visualReadyNotifiedRef.current = true;
    const rafId = requestAnimationFrame(() => {
      onVisualReady();
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [onVisualReady, state.state]);

  useEffect(() => {
    visualReadyNotifiedRef.current = false;
    hasReachedReadyStateRef.current = initialHasConnectionHistory || initialOverlayMode === "none";
    activationGraceUntilRef.current = initialHasConnectionHistory
      ? performance.now() + REACTIVATION_GRACE_MS
      : 0;
  }, [connector, initialHasConnectionHistory, initialOverlayMode]);

  useEffect(() => {
    if (!initialHasConnectionHistory) {
      return;
    }

    const remaining = activationGraceUntilRef.current - performance.now();
    if (remaining <= 0) {
      return;
    }

    const timerId = window.setTimeout(() => {
      const currentState = stateRef.current;
      if (FAILED_STATES.includes(currentState.state) || DISCONNECTED_STATES.includes(currentState.state)) {
        setOverlayMode("disconnected");
      }
    }, remaining);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [connector, initialHasConnectionHistory]);

  useEffect(() => {
    if (!hostRectMounted || !isVisible) {
      void connector.setVisible(false);
      return;
    }

    const hasOverlay = blockingOverlayVisible
      || overlayMode !== "none"
      || connectionStatus?.phase !== "connected";
    if (hasOverlay) {
      void connector.setVisible(false);
    } else {
      void connector.setVisible(true);
    }
  }, [connectionStatus?.phase, hostRectMounted, isVisible, blockingOverlayVisible, overlayMode, connector]);

  useEffect(() => {
    if (isVisible) {
      windowResizeCoordinator.requestLayout();
    }
  }, [isVisible]);

  useEffect(() => {
    let animationFrameId: number | null = null;
    let overlayCommandInFlight = false;
    let pendingOverlayRect: NativeHostRect | null | undefined;
    let lastQueuedOverlayKey = "uninitialized";

    const drainOverlayCommands = async () => {
      if (overlayCommandInFlight) {
        return;
      }

      overlayCommandInFlight = true;
      try {
        while (pendingOverlayRect !== undefined) {
          const nextRect = pendingOverlayRect;
          pendingOverlayRect = undefined;
          await connector.setOverlayRect(nextRect);
        }
      } finally {
        overlayCommandInFlight = false;
        if (pendingOverlayRect !== undefined) {
          void drainOverlayCommands().catch((error) => {
            logger.warn("FE/terminal-view/native-rdp", "Failed to drain native menu cutout", { error });
          });
        }
      }
    };

    const queueOverlayRect = (rect: NativeHostRect | null) => {
      const overlayKey = rect
        ? `${rect.x}:${rect.y}:${rect.width}:${rect.height}`
        : "none";
      if (overlayKey === lastQueuedOverlayKey) {
        return;
      }

      lastQueuedOverlayKey = overlayKey;
      pendingOverlayRect = rect;
      void drainOverlayCommands().catch((error) => {
        logger.warn("FE/terminal-view/native-rdp", "Failed to update native menu cutout", { error });
      });
    };

    const applyWebOverlay = () => {
      const hasBlockingOverlay = Boolean(document.body.querySelector([
        "[role='dialog'][data-state='open']",
        "[role='alertdialog'][data-state='open']",
        "[role='dialog']:not([data-state])",
        "[role='alertdialog']:not([data-state])",
      ].join(", ")));
      setBlockingOverlayVisible(hasBlockingOverlay);

      const container = containerRef.current;
      const hostRect = lastMountedRectRef.current;
      const menuBounds = !hasBlockingOverlay && isVisibleRef.current
        ? readMenuOverlayBounds()
        : null;
      const overlayRect = menuBounds && container && hostRect
        ? resolveOverlayScreenRect(menuBounds, container, hostRect)
        : null;
      queueOverlayRect(overlayRect);
    };

    const scheduleOverlayUpdate = () => {
      if (animationFrameId !== null) {
        return;
      }
      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        applyWebOverlay();
      });
    };

    const handleOverlayState = () => {
      scheduleOverlayUpdate();
    };

    const observer = new MutationObserver(scheduleOverlayUpdate);

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state", "hidden", "style"],
    });

    scheduleOverlayUpdate();

    window.addEventListener(NATIVE_RDP_OVERLAY_EVENT, handleOverlayState as EventListener);

    return () => {
      window.removeEventListener(NATIVE_RDP_OVERLAY_EVENT, handleOverlayState as EventListener);
      observer.disconnect();
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      setBlockingOverlayVisible(false);
      queueOverlayRect(null);
    };
  }, [connector, isVisible]);

  const handleReconnect = () => {
    if (retrying) {
      return;
    }

    setRetrying(true);
    hasReachedReadyStateRef.current = false;
    setOverlayMode("connecting");
    setState({
      state: "launching",
      detail: t("正在重新连接 Windows 远程桌面。"),
    });
    reconnectSession(sessionId);
  };

  return (
    <main
      className="terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden bg-(--terminal-shell) shadow-(--panel-shadow)"
      style={{
        backgroundColor: hasBackgroundImage ? "transparent" : undefined,
      }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 z-0 overflow-hidden outline-none"
        tabIndex={0}
        onClick={() => void connector.focus()}
      />

      {connectionStatus ? (
        <ConnectionStatusOverlay
          status={connectionStatus}
          protocol="Windows"
          target={session?.config?.rdpConfig?.host
            ? `${session.config.rdpConfig.host}:${session.config.rdpConfig.port || 3389}`
            : hostLabel}
          details={[
            { label: t("身份凭据"), value: session?.config?.rdpConfig?.username || t("交互式登录") }
          ]}
          description={state.detail?.replace(/MsTscAx\s*/gi, "Windows ")}
          onReconnect={handleReconnect}
        />
      ) : null}

    </main>
  );
}
