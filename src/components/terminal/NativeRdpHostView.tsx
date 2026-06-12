import { useEffect, useRef, useState } from "react";

import { logger } from "@/lib/logger";
import { useSettingsStore } from "@/store/settings";
import { useTabsStore } from "@/store/tabs";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type {
  INativeRdpConnector,
  NativeHostRect,
  NativeRdpStatePayload,
} from "@/types/terminal";
import { ConnectionStatusOverlay } from "./ConnectionStatusOverlay";
import { SessionTransitionMask } from "./SessionTransitionMask";
import { useI18n } from "@/i18n";

const NATIVE_RDP_OVERLAY_EVENT = "lazy-native-rdp-overlay";
const READY_STATES: NativeRdpStatePayload["state"][] = ["connected"];
const FAILED_STATES: NativeRdpStatePayload["state"][] = ["error"];
const DISCONNECTED_STATES: NativeRdpStatePayload["state"][] = ["disconnected", "closed"];
const HISTORY_READY_STATES: NativeRdpStatePayload["state"][] = ["hidden", "visible", "focused", "connected"];
const REACTIVATION_GRACE_MS = 700;

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
async function readHostRect(element: HTMLDivElement): Promise<NativeHostRect> {
  const viewportRect = element.getBoundingClientRect();
  const scaleFactor = window.devicePixelRatio || 1;
  // innerPosition() gives the content-area origin in physical screen pixels.
  const winPos = await getCurrentWindow().innerPosition();
  return {
    x: Math.round(winPos.x + viewportRect.left * scaleFactor),
    y: Math.round(winPos.y + viewportRect.top * scaleFactor),
    width: Math.max(0, Math.round(viewportRect.width * scaleFactor)),
    height: Math.max(0, Math.round(viewportRect.height * scaleFactor)),
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
  onVisualReady,
}: {
  sessionId: string;
  hostLabel: string;
  connector: INativeRdpConnector;
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
  const menuOverlayActiveRef = useRef(false);
  const hasReachedReadyStateRef = useRef(initialHasConnectionHistory || initialOverlayMode === "none");
  const activationGraceUntilRef = useRef(
    initialHasConnectionHistory ? performance.now() + REACTIVATION_GRACE_MS : 0
  );
  const [menuMaskVisible, setMenuMaskVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [overlayMode, setOverlayMode] = useState<"connecting" | "failed" | "disconnected" | "none">(initialOverlayMode);
  const [state, setState] = useState<NativeRdpStatePayload>(initialState);
  const stateRef = useRef(state);
  const [resizeMaskVisible, setResizeMaskVisible] = useState(false);
  const [hostRectMounted, setHostRectMounted] = useState(false);
  const resizeMaskTimerRef = useRef<number | null>(null);
  const visualReadyNotifiedRef = useRef(false);
  const lastMountedRectRef = useRef<NativeHostRect | null>(null);

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

    // Keep the native window hidden until we have called mount() with the
    // correct DOM rect.  Calling setVisible(true) before mount() causes the
    // Win32 window to appear at a stale position and then jump, which is the
    // "flash" when switching tabs.
    let disposed = false;
    let initialMountDone = false;
    let resizeObserver: ResizeObserver | null = null;
    let scheduledPushTimer: ReturnType<typeof setTimeout> | null = null;
    let scheduledPushFrame: number | null = null;
    setHostRectMounted(false);

    const pushRect = async (initial: boolean = false) => {
      const rect = await readHostRect(element);
      if (disposed) {
        return;
      }

      if (!initial && sameHostRect(lastMountedRectRef.current, rect)) {
        return;
      }

      try {
        await connector.mount(rect);
        lastMountedRectRef.current = rect;
        if (initial && !initialMountDone && !disposed) {
          initialMountDone = true;
          setHostRectMounted(true);
          // Now that initial mount succeeded, enable ResizeObserver to track
          // future layout changes. This prevents ResizeObserver from triggering
          // during the initial mount + CSS transition sequence.
          if (resizeObserver) {
            resizeObserver.observe(element);
          }
          void connector.setVisible(true);
        }
      } catch (error) {
        if (!disposed) {
          logger.error("FE/terminal-view/native-rdp", "Mount failed", { error });
        }
      }
    };

    const showResizeMask = () => {
      setResizeMaskVisible(true);
      if (resizeMaskTimerRef.current !== null) {
        window.clearTimeout(resizeMaskTimerRef.current);
      }
      resizeMaskTimerRef.current = window.setTimeout(() => {
        setResizeMaskVisible(false);
      }, 1200);
    };

    const schedulePushRect = (delayMs: number, showMask: boolean) => {
      if (!initialMountDone || disposed) {
        return;
      }

      if (showMask) {
        showResizeMask();
      }

      if (scheduledPushTimer !== null) {
        clearTimeout(scheduledPushTimer);
        scheduledPushTimer = null;
      }
      if (scheduledPushFrame !== null) {
        cancelAnimationFrame(scheduledPushFrame);
        scheduledPushFrame = null;
      }

      scheduledPushTimer = setTimeout(() => {
        scheduledPushTimer = null;
        scheduledPushFrame = requestAnimationFrame(() => {
          scheduledPushFrame = null;
          void pushRect(false);
        });
      }, delayMs);
    };

    // Delay the initial pushRect by one macrotask (setTimeout 0) so that all
    // React effects — including App.tsx updating CSS variables like --bh (which
    // collapses the bottom bar when switching to an RDP tab) — have fully run
    // before we measure the DOM.  Without this, getBoundingClientRect() returns
    // the pre-layout rect, mount() positions the Win32 window at wrong coords,
    // and the window visibly jumps after the layout settles → two flashes.
    // Calling getBoundingClientRect() inside the setTimeout also forces a
    // synchronous reflow, so we always get the final stable layout values.
    let initialPushFrame: number | null = null;
    let initialPushTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      initialPushTimer = null;
      initialPushFrame = requestAnimationFrame(() => {
        initialPushFrame = null;
        void pushRect(true);
      });
    }, 0);

    // Create ResizeObserver but do NOT observe yet; only observe after the
    // initial mount completes. This prevents the observer from firing while
    // CSS transitions (e.g., bottom bar collapsing) are in progress.
    let resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;
    resizeObserver = new ResizeObserver(() => {
      if (!initialMountDone) {
        return;
      }
      if (resizeTimeoutId !== null) {
        clearTimeout(resizeTimeoutId);
      }
      resizeTimeoutId = setTimeout(() => {
        resizeTimeoutId = null;
        schedulePushRect(0, true);
      }, 160);
    });

    // Also re-push on window changes so the sidecar follows screen position,
    // maximize/restore changes, and DPI/viewport changes.
    let moveUnlisten: (() => void) | null = null;
    let resizedUnlisten: (() => void) | null = null;
    void getCurrentWindow().onMoved(() => {
      schedulePushRect(0, false);
    }).then((fn) => {
      moveUnlisten = fn;
    });
    void getCurrentWindow().onResized(() => {
      schedulePushRect(80, false);
    }).then((fn) => {
      resizedUnlisten = fn;
    });

    const handleViewportChange = () => {
      schedulePushRect(80, false);
    };
    window.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      disposed = true;
      setHostRectMounted(false);
      lastMountedRectRef.current = null;
      if (initialPushTimer !== null) {
        clearTimeout(initialPushTimer);
      }
      if (initialPushFrame !== null) {
        cancelAnimationFrame(initialPushFrame);
      }
      if (resizeTimeoutId !== null) clearTimeout(resizeTimeoutId);
      if (scheduledPushTimer !== null) {
        clearTimeout(scheduledPushTimer);
      }
      if (scheduledPushFrame !== null) {
        cancelAnimationFrame(scheduledPushFrame);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (resizeMaskTimerRef.current !== null) {
        window.clearTimeout(resizeMaskTimerRef.current);
      }
      moveUnlisten?.();
      resizedUnlisten?.();
      window.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
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
    if (!hostRectMounted) {
      return;
    }

    const hasOverlay = menuMaskVisible
      || resizeMaskVisible
      || overlayMode !== "none"
      || connectionStatus?.phase !== "connected";
    if (hasOverlay) {
      void connector.setVisible(false);
    } else {
      void connector.setVisible(true);
    }
  }, [connectionStatus?.phase, hostRectMounted, menuMaskVisible, overlayMode, resizeMaskVisible, connector]);

  useEffect(() => {
    const applyMenuOverlay = (active: boolean) => {
      if (menuOverlayActiveRef.current === active) {
        return;
      }

      menuOverlayActiveRef.current = active;
      setMenuMaskVisible(active);
    };

    const handleOverlayState = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      applyMenuOverlay(customEvent.detail === true);
    };

    const hasVisibleWebOverlay = () => Boolean(document.body.querySelector([
      "[data-radix-popper-content-wrapper]",
      "[role='menu']",
      "[role='listbox']",
      "[role='dialog']",
      "[role='alertdialog']",
    ].join(", ")));

    const observer = new MutationObserver(() => {
      applyMenuOverlay(hasVisibleWebOverlay());
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state", "hidden", "style"],
    });

    applyMenuOverlay(hasVisibleWebOverlay());

    window.addEventListener(NATIVE_RDP_OVERLAY_EVENT, handleOverlayState as EventListener);

    return () => {
      window.removeEventListener(NATIVE_RDP_OVERLAY_EVENT, handleOverlayState as EventListener);
      observer.disconnect();
      menuOverlayActiveRef.current = false;
      setMenuMaskVisible(false);
    };
  }, [connector]);

  const showMenuMask = menuMaskVisible && connectionStatus?.phase === "connected";
  const showTransitionMask = connectionStatus?.phase === "connected"
    && (showMenuMask || resizeMaskVisible || overlayMode !== "none");
  const transitionText = showMenuMask
    ? t("系统菜单已打开，正在临时隐藏 Windows 远程桌面画面...")
    : resizeMaskVisible
      ? t("正在调整会话尺寸...")
      : t("正在同步 Windows 远程桌面画面...");

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

      <SessionTransitionMask visible={showTransitionMask} text={transitionText} />
    </main>
  );
}
