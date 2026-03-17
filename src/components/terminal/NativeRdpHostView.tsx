import { useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Layers3, Monitor, Move, PanelTopClose } from "lucide-react";
import type {
  INativeRdpConnector,
  NativeHostRect,
  NativeRdpStatePayload,
  NativeRdpTracePayload,
} from "@/types/terminal";

const NATIVE_RDP_OVERLAY_EVENT = "lazy-native-rdp-overlay";

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
export function NativeRdpHostView({
  title,
  connector,
}: {
  title: string;
  connector: INativeRdpConnector;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuOverlayActiveRef = useRef(false);
  const [menuMaskVisible, setMenuMaskVisible] = useState(false);
  const [state, setState] = useState<NativeRdpStatePayload>({
    state: "launching",
    detail: "正在准备 MsTscAx 原生宿主。",
  });
  const [traceItems, setTraceItems] = useState<NativeRdpTracePayload[]>([]);

  useEffect(() => {
    let disposed = false;

    connector.onState((payload) => {
      if (!disposed) {
        setState(payload);
      }
    }).catch((error) => {
      if (!disposed) {
        setState({
          state: "closed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    });

    const disposeClose = connector.onClose(() => {
      if (!disposed) {
        setState({
          state: "closed",
          detail: "Native RDP 原生宿主会话已断开。",
        });
      }
    });

    const disposeTrace = connector.onTrace((item) => {
      if (disposed) {
        return;
      }

      setTraceItems((prev) => {
        const next = [...prev, item];
        if (next.length > 24) {
          next.splice(0, next.length - 24);
        }
        return next;
      });
    });

    return () => {
      disposed = true;
      disposeClose();
      disposeTrace();
    };
  }, [connector]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    void connector.setVisible(true);

    let rafId: number | null = null;

    const pushRect = () => {
      void readHostRect(element).then((rect) => {
        void connector.mount(rect).catch((error) => {
          logger.error("FE/terminal-view/native-rdp", "Mount failed", {error});
        });
      });
    };

    pushRect();
    const resizeObserver = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(pushRect);
    });
    resizeObserver.observe(element);

    // Also re-push on window move so the sidecar follows screen position.
    let moveUnlisten: (() => void) | null = null;
    void getCurrentWindow().onMoved(() => {
      pushRect();
    }).then((fn) => {
      moveUnlisten = fn;
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      moveUnlisten?.();
      void connector.setVisible(false);
    };
  }, [connector]);

  useEffect(() => {
    const applyMenuOverlay = (active: boolean, source: string) => {
      if (menuOverlayActiveRef.current === active) {
        return;
      }

      menuOverlayActiveRef.current = active;
      setMenuMaskVisible(active);

      if (active) {
        logger.debug("FE/terminal-view/native-rdp", `Menu overlay active (${source}), hide native host`);
        void connector.setVisible(false);
      } else {
        logger.debug("FE/terminal-view/native-rdp", `Menu overlay inactive (${source}), restore native host`);
        void connector.setVisible(true);
      }
    };

    const handleOverlayState = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      applyMenuOverlay(customEvent.detail === true, "event");
    };

    const hasVisibleWebOverlay = () => Boolean(document.body.querySelector([
      "[data-radix-popper-content-wrapper]",
      "[role='menu']",
      "[role='listbox']",
      "[role='dialog']",
      "[role='alertdialog']",
    ].join(", ")));

    const observer = new MutationObserver(() => {
      applyMenuOverlay(hasVisibleWebOverlay(), "observer");
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state", "hidden", "style"],
    });

    applyMenuOverlay(hasVisibleWebOverlay(), "initial-sync");

    window.addEventListener(NATIVE_RDP_OVERLAY_EVENT, handleOverlayState as EventListener);

    return () => {
      window.removeEventListener(NATIVE_RDP_OVERLAY_EVENT, handleOverlayState as EventListener);
      observer.disconnect();
      menuOverlayActiveRef.current = false;
      setMenuMaskVisible(false);
    };
  }, [connector]);

  return (
    <main className="terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden border border-(--terminal-border) bg-(--terminal-shell) shadow-(--panel-shadow)">
      <div
        ref={containerRef}
        className="absolute inset-0 z-0 overflow-hidden outline-none"
        tabIndex={0}
        onClick={() => void connector.focus()}
      />

      {!menuMaskVisible ? (
        <>
          <div className="pointer-events-none absolute inset-4 z-10 rounded-[28px] border border-sky-400/20 border-dashed bg-sky-500/4" />

          <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-slate-950/58 px-4 py-3 text-white/80 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-md">
            <div className="flex items-start gap-3">
              <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{title}</div>
                <div className="mt-1 text-xs leading-5 text-white/65">
                  MsTscAx 原生宿主已接管当前内容区域，并跟随当前标签内容区同步显示尺寸。
                </div>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 right-4 z-10 max-w-[min(34rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-black/42 px-4 py-3 text-[11px] leading-5 text-white/72 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-md">
            <div className="grid gap-1.5 text-left">
              <div className="flex items-center gap-2"><Layers3 className="h-3.5 w-3.5 text-sky-300" /> 状态: {state.state}</div>
              <div className="flex items-center gap-2"><PanelTopClose className="h-3.5 w-3.5 text-sky-300" /> 说明: {state.detail ?? "等待后续状态更新"}</div>
              {state.rect ? (
                <div className="flex items-center gap-2"><Move className="h-3.5 w-3.5 text-sky-300" /> 挂载区域: {state.rect.width} x {state.rect.height} @ ({state.rect.x}, {state.rect.y})</div>
              ) : null}
            </div>
            {traceItems.length > 0 ? (
              <div className="mt-3 max-h-28 overflow-hidden border-t border-white/10 pt-2 font-mono text-[10px] text-white/55">
                {traceItems.slice(-3).map((item, index) => {
                  const time = new Date(item.timestampMs).toLocaleTimeString();
                  return (
                    <div key={`${item.timestampMs}-${index}`} className="whitespace-pre-wrap wrap-break-word">
                      [{time}] [{item.level}] {item.stage}: {item.message}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {menuMaskVisible ? (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div className="terminal-empty-state h-full">
            <div className="terminal-empty-card">
              <div className="chip-row mb-4 text-[11px] text-muted-foreground">Lazy Terminal Workspace</div>
              <h2 className="mb-2 text-2xl font-semibold tracking-tight">把终端、SSH 和常用命令收进一个工作台</h2>
              <p className="mb-6 max-w-md text-sm leading-6 text-muted-foreground">
                Web 菜单已打开，当前临时遮蔽 MsTscAx 原生宿主窗口，避免原生层覆盖右键菜单与下拉选项。菜单关闭后会自动恢复当前原生远程桌面画面。
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-border/70 bg-background/56 p-4">
                  <div className="mb-2 text-sm font-medium">菜单交互</div>
                  <div className="text-xs leading-5 text-muted-foreground">优先保证 Web 右键菜单与下拉菜单完整显示。</div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/56 p-4">
                  <div className="mb-2 text-sm font-medium">原生会话</div>
                  <div className="text-xs leading-5 text-muted-foreground">仅临时遮蔽 native 宿主，不销毁当前 MsTscAx 会话。</div>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/56 p-4">
                  <div className="mb-2 text-sm font-medium">自动恢复</div>
                  <div className="text-xs leading-5 text-muted-foreground">菜单关闭后自动恢复原生画面与交互焦点。</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}