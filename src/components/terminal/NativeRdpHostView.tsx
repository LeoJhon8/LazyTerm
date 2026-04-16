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
import {
  TransitionMask,
  GraphicalSessionOverlay,
} from "./BaseSessionView";
import { useI18n } from "@/i18n";

const NATIVE_RDP_OVERLAY_EVENT = "lazy-native-rdp-overlay";
const READY_STATES: NativeRdpStatePayload["state"][] = ["connected"];
const FAILED_STATES: NativeRdpStatePayload["state"][] = ["error"];
const DISCONNECTED_STATES: NativeRdpStatePayload["state"][] = ["disconnected", "closed"];

function resolveOverlayMode(payload: NativeRdpStatePayload): "connecting" | "failed" | "disconnected" | "none" {
  if (FAILED_STATES.includes(payload.state)) {
    return "failed";
  }

  if (DISCONNECTED_STATES.includes(payload.state)) {
    return "disconnected";
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
  const initialOverlayMode = resolveOverlayMode(initialState);
  const reconnectSession = useTabsStore((state) => state.reconnectSession);
  const hasBackgroundImage = useSettingsStore((state) => state.backgroundImageEnabled && !!state.backgroundImage);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuOverlayActiveRef = useRef(false);
  const hasReachedReadyStateRef = useRef(initialOverlayMode === "none");
  const disconnectedLockedRef = useRef(initialOverlayMode === "disconnected" || initialOverlayMode === "failed");
  const [menuMaskVisible, setMenuMaskVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [overlayMode, setOverlayMode] = useState<"connecting" | "failed" | "disconnected" | "none">(initialOverlayMode);
  const [state, setState] = useState<NativeRdpStatePayload>(initialState);
  const stateRef = useRef(state);
  const [resizeMaskVisible, setResizeMaskVisible] = useState(false);
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
        if (disconnectedLockedRef.current && !DISCONNECTED_STATES.includes(payload.state) && !FAILED_STATES.includes(payload.state)) {
          return;
        }

        setRetrying(false);
        setState(payload);

        if (FAILED_STATES.includes(payload.state)) {
          disconnectedLockedRef.current = true;
          setOverlayMode(hasReachedReadyStateRef.current ? "disconnected" : "failed");
          return;
        }

        if (DISCONNECTED_STATES.includes(payload.state)) {
          setOverlayMode(hasReachedReadyStateRef.current ? "disconnected" : "failed");
          if (!hasReachedReadyStateRef.current && payload.state !== "error") {
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
        disconnectedLockedRef.current = true;
        setRetrying(false);
        hasReachedReadyStateRef.current = false;
        setOverlayMode("failed");
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

        disconnectedLockedRef.current = true;
        setRetrying(false);
        hasReachedReadyStateRef.current = false;
        setOverlayMode(stateRef.current.state === "connected" ? "disconnected" : "failed");
        setState({
          state: stateRef.current.state === "connected" ? "closed" : "error",
          detail: stateRef.current.state === "connected"
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

    // Delay the initial pushRect by one macrotask (setTimeout 0) so that all
    // React effects — including App.tsx updating CSS variables like --bh (which
    // collapses the bottom bar when switching to an RDP tab) — have fully run
    // before we measure the DOM.  Without this, getBoundingClientRect() returns
    // the pre-layout rect, mount() positions the Win32 window at wrong coords,
    // and the window visibly jumps after the layout settles → two flashes.
    // Calling getBoundingClientRect() inside the setTimeout also forces a
    // synchronous reflow, so we always get the final stable layout values.
    let initialPushTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      initialPushTimer = null;
      void pushRect(true);
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
      setResizeMaskVisible(true);
      if (resizeMaskTimerRef.current !== null) {
        window.clearTimeout(resizeMaskTimerRef.current);
      }
      resizeMaskTimerRef.current = window.setTimeout(() => {
        setResizeMaskVisible(false);
      }, 2000);

      resizeTimeoutId = setTimeout(() => {
        resizeTimeoutId = null;
        void pushRect(false);
      }, 200);
    });

    // Also re-push on window move so the sidecar follows screen position.
    let moveUnlisten: (() => void) | null = null;
    void getCurrentWindow().onMoved(() => {
      if (initialMountDone) {
        void pushRect(false);
      }
    }).then((fn) => {
      moveUnlisten = fn;
    });

    return () => {
      disposed = true;
      lastMountedRectRef.current = null;
      if (initialPushTimer !== null) {
        clearTimeout(initialPushTimer);
      }
      if (resizeTimeoutId !== null) clearTimeout(resizeTimeoutId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (resizeMaskTimerRef.current !== null) {
        window.clearTimeout(resizeMaskTimerRef.current);
      }
      moveUnlisten?.();
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
    hasReachedReadyStateRef.current = initialOverlayMode === "none";
    disconnectedLockedRef.current = initialOverlayMode === "disconnected" || initialOverlayMode === "failed";
  }, [connector, initialOverlayMode]);

  useEffect(() => {
    const hasOverlay = menuMaskVisible || resizeMaskVisible;
    if (hasOverlay) {
      void connector.setVisible(false);
    } else {
      void connector.setVisible(true);
    }
  }, [menuMaskVisible, resizeMaskVisible, connector]);

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

  const isFailed = overlayMode === "failed";
  const isDisconnected = overlayMode === "disconnected";
  const showMenuMask = menuMaskVisible && overlayMode === "connecting";
  const showStatusOverlay = !showMenuMask && overlayMode !== "none";

  const handleReconnect = () => {
    if (retrying) {
      return;
    }

    setRetrying(true);
    hasReachedReadyStateRef.current = false;
    disconnectedLockedRef.current = false;
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
      <TransitionMask 
        visible={resizeMaskVisible} 
        text={t("正在调整会话尺寸...")}
      />
      <div
        ref={containerRef}
        className="absolute inset-0 z-0 overflow-hidden outline-none"
        tabIndex={0}
        onClick={() => void connector.focus()}
      />

      {showStatusOverlay ? (
        <GraphicalSessionOverlay
          mode={isFailed ? "failed" : (isDisconnected ? "disconnected" : "connecting")}
          titleText={isFailed ? t("连接失败") : (isDisconnected ? t("连接断开") : t("正在建立连接"))}
          description={(state.detail?.replace(/MsTscAx\s*/gi, "Windows ") ?? (isFailed
            ? t("无法与 Windows 远程桌面建立连接，请检查目标主机或网络设置。")
            : (isDisconnected ? t("与远程主机的连接已意外中止。") : t("正在初始化连接..."))))}
          protocol="Windows"
          sessionConfigDetails={[
            { label: t("目标地址"), value: useTabsStore.getState().sessions.find(s => s.id === sessionId)?.config?.rdpConfig?.host ? `${useTabsStore.getState().sessions.find(s => s.id === sessionId)?.config?.rdpConfig?.host}:${useTabsStore.getState().sessions.find(s => s.id === sessionId)?.config?.rdpConfig?.port || 3389}` : hostLabel },
            { label: t("身份凭据"), value: useTabsStore.getState().sessions.find(s => s.id === sessionId)?.config?.rdpConfig?.username || t("交互式登录") }
          ]}
          onReconnect={handleReconnect}
          interactive={isDisconnected || isFailed}
          zIndexClass="z-30"
        />
      ) : null}

      {showMenuMask ? (
        <GraphicalSessionOverlay
          mode="connecting"
          titleText={t("系统菜单激活")}
          description={t("应用菜单已打开。为避免原生 ActiveX 组件抢占菜单焦点，当前临时屏蔽原生画面。关闭菜单后将自动恢复。")}
          protocol="Focus Mask"
          zIndexClass="z-30"
        />
      ) : null}
    </main>
  );
}
