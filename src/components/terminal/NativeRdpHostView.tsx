import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Layers3, Monitor, Move, PanelTopClose } from "lucide-react";
import type {
  INativeRdpConnector,
  NativeHostRect,
  NativeRdpStatePayload,
  NativeRdpTracePayload,
} from "@/types/terminal";

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
          console.error("[Native RDP] mount failed:", error);
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

  return (
    <main className="terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden border border-(--terminal-border) bg-black shadow-(--panel-shadow)">
      <div
        ref={containerRef}
        className="relative flex h-full w-full items-center justify-center overflow-hidden outline-none"
        tabIndex={0}
        onClick={() => void connector.focus()}
      >
        <div className="pointer-events-none absolute inset-4 rounded-[28px] border border-sky-400/25 border-dashed bg-sky-500/6" />

        <div className="relative z-10 flex max-w-xl flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/6 px-8 py-10 text-center text-white/80 backdrop-blur-md">
          <Monitor className="h-10 w-10 text-sky-300" />
          <div>
            <div className="text-lg font-semibold text-white">{title}</div>
            <div className="mt-2 text-sm leading-6 text-white/60">
              当前标签已切到 MsTscAx Windows 原生宿主模式。这个视图负责把前端区域同步给 sidecar，并显示 ActiveX 宿主当前的连接与挂载状态。
            </div>
          </div>

          <div className="grid w-full gap-2 rounded-2xl border border-white/10 bg-black/25 p-4 text-left text-xs text-white/70">
            <div className="flex items-center gap-2"><Layers3 className="h-4 w-4 text-sky-300" /> 状态: {state.state}</div>
            <div className="flex items-center gap-2"><PanelTopClose className="h-4 w-4 text-sky-300" /> 说明: {state.detail ?? "等待后续状态更新"}</div>
            {state.rect ? (
              <div className="flex items-center gap-2"><Move className="h-4 w-4 text-sky-300" /> 挂载区域: {state.rect.width} x {state.rect.height} @ ({state.rect.x}, {state.rect.y})</div>
            ) : null}
          </div>

          <div className="w-full rounded-2xl border border-white/10 bg-black/35 p-3 text-left text-[11px] leading-5 text-white/70">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sky-200/85">MsTscAx Trace</div>
            <div className="max-h-40 overflow-y-auto pr-1 font-mono">
              {traceItems.length === 0 ? (
                <div className="text-white/40">等待日志...</div>
              ) : (
                traceItems.map((item, index) => {
                  const time = new Date(item.timestampMs).toLocaleTimeString();
                  return (
                    <div key={`${item.timestampMs}-${index}`} className="whitespace-pre-wrap wrap-break-word">
                      [{time}] [{item.level}] {item.stage}: {item.message}
                      {item.extra ? ` | ${item.extra}` : ""}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}