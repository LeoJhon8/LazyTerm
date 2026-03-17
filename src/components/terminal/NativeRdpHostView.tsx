import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import { useSettingsStore } from "@/store/settings";
import { useTabsStore } from "@/store/tabs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LoaderCircle, RefreshCcw } from "lucide-react";
import type {
  INativeRdpConnector,
  NativeHostRect,
  NativeRdpStatePayload,
} from "@/types/terminal";

const NATIVE_RDP_OVERLAY_EVENT = "lazy-native-rdp-overlay";
const READY_STATES: NativeRdpStatePayload["state"][] = ["connected"];
const DISCONNECTED_STATES: NativeRdpStatePayload["state"][] = ["disconnected", "closed", "error"];

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
  title,
  connector,
  onVisualReady,
}: {
  sessionId: string;
  title: string;
  connector: INativeRdpConnector;
  onVisualReady?: () => void;
}) {
  const reconnectSession = useTabsStore((state) => state.reconnectSession);
  const hasBackgroundImage = useSettingsStore((state) => state.backgroundImageEnabled && !!state.backgroundImage);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuOverlayActiveRef = useRef(false);
  const hasReachedReadyStateRef = useRef(false);
  const disconnectedLockedRef = useRef(false);
  const [menuMaskVisible, setMenuMaskVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [overlayMode, setOverlayMode] = useState<"connecting" | "disconnected" | "none">("connecting");
  const [state, setState] = useState<NativeRdpStatePayload>({
    state: "launching",
    detail: "正在准备 MsTscAx 原生宿主。",
  });
  const visualReadyNotifiedRef = useRef(false);
  const lastMountedRectRef = useRef<NativeHostRect | null>(null);

  useEffect(() => {
    let disposed = false;

    connector.onState((payload) => {
      if (!disposed) {
        if (disconnectedLockedRef.current && !DISCONNECTED_STATES.includes(payload.state)) {
          return;
        }

        setRetrying(false);
        setState(payload);

        if (DISCONNECTED_STATES.includes(payload.state)) {
          disconnectedLockedRef.current = true;
          setOverlayMode("disconnected");
          return;
        }

        if (READY_STATES.includes(payload.state)) {
          hasReachedReadyStateRef.current = true;
          setOverlayMode("none");
          return;
        }

        if (!hasReachedReadyStateRef.current) {
          setOverlayMode("connecting");
        }
      }
    }).catch((error) => {
      if (!disposed) {
        disconnectedLockedRef.current = true;
        setRetrying(false);
        hasReachedReadyStateRef.current = false;
        setOverlayMode("disconnected");
        setState({
          state: "closed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    });

    const disposeClose = connector.onClose(() => {
      if (!disposed) {
        disconnectedLockedRef.current = true;
        setRetrying(false);
        hasReachedReadyStateRef.current = false;
        setOverlayMode("disconnected");
        setState({
          state: "closed",
          detail: "Native RDP 原生宿主会话已断开。",
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
    let rafId: number | null = null;
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
    resizeObserver = new ResizeObserver(() => {
      if (!initialMountDone || rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        void pushRect(false);
      });
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
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (resizeObserver) {
        resizeObserver.disconnect();
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
    hasReachedReadyStateRef.current = false;
    disconnectedLockedRef.current = false;
  }, [connector]);

  useEffect(() => {
    const applyMenuOverlay = (active: boolean) => {
      if (menuOverlayActiveRef.current === active) {
        return;
      }

      menuOverlayActiveRef.current = active;
      setMenuMaskVisible(active);

      if (active) {
        void connector.setVisible(false);
      } else {
        void connector.setVisible(true);
      }
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

  const isDisconnected = overlayMode === "disconnected";
  const showMenuMask = menuMaskVisible && overlayMode === "none";
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
      detail: "正在重新连接 Windows 远程桌面。",
    });
    reconnectSession(sessionId);
  };

  const renderOverlay = ({
    chipLabel,
    titleText,
    description,
    cards,
    footer,
    interactive = false,
    zIndexClass = "z-20",
  }: {
    chipLabel: string;
    titleText: string;
    description: string;
    cards: Array<{ title: string; detail: string }>;
    footer?: React.ReactNode;
    interactive?: boolean;
    zIndexClass?: string;
  }) => (
    <div className={`${interactive ? "" : "pointer-events-none "}absolute inset-0 ${zIndexClass}`}>
      <div className="terminal-empty-state h-full">
        <div className="terminal-empty-card text-center">
          <div className="chip-row mx-auto mb-4 w-fit text-[11px] text-muted-foreground">{chipLabel}</div>
          <h2 className="mb-2 text-2xl font-semibold tracking-tight">{titleText}</h2>
          <p className="mx-auto mb-6 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
          <div className={`grid gap-3 text-left ${cards.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {cards.map((card) => (
              <div key={card.title} className="rounded-2xl border border-border/70 bg-background/56 p-4">
                <div className="mb-2 text-sm font-medium">{card.title}</div>
                <div className="text-xs leading-5 text-muted-foreground">{card.detail}</div>
              </div>
            ))}
          </div>
          {footer ? <div className="mt-6 flex justify-center">{footer}</div> : null}
        </div>
      </div>
    </div>
  );

  return (
    <main
      className="terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden border border-(--terminal-border) bg-(--terminal-shell) shadow-(--panel-shadow)"
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

      {showStatusOverlay ? (
        renderOverlay({
          chipLabel: "Windows Workspace",
          titleText: isDisconnected ? "连接断开" : "连接中",
          description: state.detail ?? (isDisconnected ? "Windows 远程桌面会话已断开。" : "正在同步 Windows 原生远程桌面画面。"),
          cards: [
            {
              title: "当前页面",
              detail: title,
            },
            {
              title: "连接状态",
              detail: isDisconnected ? "会话已终止，可在当前标签内直接发起重连。" : "原生宿主正在建立或恢复 Windows 桌面连接。",
            },
          ],
          footer: isDisconnected ? (
            <Button type="button" onClick={handleReconnect} className="pointer-events-auto min-w-32">
              <RefreshCcw className="h-4 w-4" />
              重连
            </Button>
          ) : (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
              正在建立 Windows 连接
            </div>
          ),
          interactive: isDisconnected,
          zIndexClass: "z-30",
        })
      ) : null}

      {showMenuMask ? (
        renderOverlay({
          chipLabel: "Lazy Terminal Workspace",
          titleText: "把终端、SSH 和常用命令收进一个工作台",
          description: "Web 菜单已打开，当前临时遮蔽 MsTscAx 原生宿主窗口，避免原生层覆盖右键菜单与下拉选项。菜单关闭后会自动恢复当前原生远程桌面画面。",
          cards: [
            {
              title: "菜单交互",
              detail: "优先保证 Web 右键菜单与下拉菜单完整显示。",
            },
            {
              title: "原生会话",
              detail: "仅临时遮蔽 native 宿主，不销毁当前 MsTscAx 会话。",
            },
            {
              title: "自动恢复",
              detail: "菜单关闭后自动恢复原生画面与交互焦点。",
            },
          ],
          zIndexClass: "z-20",
        })
      ) : null}
    </main>
  );
}