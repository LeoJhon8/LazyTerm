import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, MousePointer2, RefreshCcw } from "lucide-react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import type { IVncConnector, VncCursorPayload, VncFramePayload } from "@/types/terminal";

const VNC_PRESENT_DELAY_MS = 10;

const KEYSYM_MAP: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Insert: 0xff63,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Shift: 0xffe1,
  ShiftLeft: 0xffe1,
  ShiftRight: 0xffe2,
  Control: 0xffe3,
  ControlLeft: 0xffe3,
  ControlRight: 0xffe4,
  Alt: 0xffe9,
  AltLeft: 0xffe9,
  AltRight: 0xffea,
  Meta: 0xffeb,
  MetaLeft: 0xffeb,
  MetaRight: 0xffec,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getPointerPosition(
  target: HTMLElement,
  frame: Pick<VncFramePayload, "desktopWidth" | "desktopHeight">,
  clientX: number,
  clientY: number,
) {
  const rect = target.getBoundingClientRect();
  const scaleX = frame.desktopWidth / rect.width;
  const scaleY = frame.desktopHeight / rect.height;

  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;

  return {
    x: Math.round(clamp(x, 0, frame.desktopWidth - 1)),
    y: Math.round(clamp(y, 0, frame.desktopHeight - 1)),
  };
}

function buildCursorStyle(cursor: VncCursorPayload): string {
  if (cursor.width === 0 || cursor.height === 0 || cursor.rgbaBytes.length === 0) {
    return "none";
  }

  const canvas = document.createElement("canvas");
  canvas.width = cursor.width;
  canvas.height = cursor.height;

  const context = canvas.getContext("2d");
  if (!context) {
    return "default";
  }

  context.putImageData(new ImageData(new Uint8ClampedArray(cursor.rgbaBytes), cursor.width, cursor.height), 0, 0);
  const url = canvas.toDataURL("image/png");
  return `url(${url}) ${cursor.hotspotX} ${cursor.hotspotY}, default`;
}

function mapKeyboardEventToKeysym(event: React.KeyboardEvent<HTMLDivElement>): number | null {
  if (KEYSYM_MAP[event.code]) {
    return KEYSYM_MAP[event.code];
  }

  if (KEYSYM_MAP[event.key]) {
    return KEYSYM_MAP[event.key];
  }

  if (event.key.length === 1) {
    return event.key.codePointAt(0) ?? null;
  }

  return null;
}

export function VncView() {
  const { activeSessionId, sessions } = useTabsStore();
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const connector = activeSession?.connector?.protocol === "vnc" ? activeSession.connector as IVncConnector : null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const backBufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerMaskRef = useRef(0);
  const pendingFrameRef = useRef<VncFramePayload | null>(null);
  const decodeInFlightRef = useRef(false);
  const drawTokenRef = useRef(0);
  const pointerTargetRef = useRef<number | null>(null);
  const presentTimerRef = useRef<number | null>(null);
  const presentRafRef = useRef<number | null>(null);
  const [connected, setConnected] = useState(true);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [transitionMaskVisible, setTransitionMaskVisible] = useState(true);
  const [cursorStyle, setCursorStyle] = useState("default");

  const markVisualReady = useCallback(() => {
    setTransitionMaskVisible(false);
  }, []);

  useEffect(() => {
    if (!connector) {
      return;
    }

    let disposed = false;
    const cleanupCanvas = canvasRef.current;
    if (!backBufferCanvasRef.current) {
      backBufferCanvasRef.current = document.createElement("canvas");
    }

    const presentBackBuffer = () => {
      presentRafRef.current = null;

      const frontCanvas = canvasRef.current;
      const backCanvas = backBufferCanvasRef.current;
      if (!frontCanvas || !backCanvas || disposed) {
        return;
      }

      if (frontCanvas.width !== backCanvas.width || frontCanvas.height !== backCanvas.height) {
        frontCanvas.width = backCanvas.width;
        frontCanvas.height = backCanvas.height;
      }

      const frontContext = frontCanvas.getContext("2d", {
        alpha: false,
        desynchronized: true,
      });

      if (!frontContext) {
        return;
      }

      frontContext.imageSmoothingEnabled = false;
      frontContext.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
      frontContext.drawImage(backCanvas, 0, 0);
      markVisualReady();
    };

    const schedulePresent = () => {
      if (presentTimerRef.current !== null) {
        window.clearTimeout(presentTimerRef.current);
      }

      presentTimerRef.current = window.setTimeout(() => {
        presentTimerRef.current = null;
        if (presentRafRef.current !== null) {
          window.cancelAnimationFrame(presentRafRef.current);
        }
        presentRafRef.current = window.requestAnimationFrame(presentBackBuffer);
      }, VNC_PRESENT_DELAY_MS);
    };

    const drawFrame = async () => {
      if (decodeInFlightRef.current || disposed) {
        return;
      }

      const frame = pendingFrameRef.current;
      const backCanvas = backBufferCanvasRef.current;
      if (!frame || !backCanvas) {
        return;
      }

      decodeInFlightRef.current = true;
      const drawToken = ++drawTokenRef.current;

      try {
        if (backCanvas.width !== frame.desktopWidth || backCanvas.height !== frame.desktopHeight) {
          backCanvas.width = frame.desktopWidth;
          backCanvas.height = frame.desktopHeight;
        }

        const context = backCanvas.getContext("2d", {
          alpha: false,
          desynchronized: true,
        });

        if (!context) {
          return;
        }

        context.imageSmoothingEnabled = false;

        if (frame.encoding === "rgba") {
          const rgbaBytes = new Uint8ClampedArray(frame.imageBytes);
          const imageData = new ImageData(rgbaBytes, frame.regionWidth, frame.regionHeight);

          if (disposed || drawToken !== drawTokenRef.current) {
            return;
          }

          context.putImageData(imageData, frame.regionLeft, frame.regionTop);
          schedulePresent();
        } else {
          const blob = new Blob([frame.imageBytes], { type: "image/jpeg" });
          let decodedSource: CanvasImageSource;
          let decodedBitmap: ImageBitmap | null = null;

          if (typeof createImageBitmap === "function") {
            decodedBitmap = await createImageBitmap(blob);
            decodedSource = decodedBitmap;
          } else {
            const image = await new Promise<HTMLImageElement>((resolve, reject) => {
              const objectUrl = URL.createObjectURL(blob);
              const img = new Image();
              img.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(img);
              };
              img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("Image decode failed"));
              };
              img.src = objectUrl;
            });

            decodedSource = image;
          }

          if (disposed || drawToken !== drawTokenRef.current) {
            decodedBitmap?.close();
            return;
          }

          context.drawImage(decodedSource, frame.regionLeft, frame.regionTop, frame.regionWidth, frame.regionHeight);
          decodedBitmap?.close();
          schedulePresent();
        }
      } catch (error) {
        if (!disposed) {
          logger.error("FE/terminal-view/vnc", "Canvas decode failed", { error });
        }
      } finally {
        decodeInFlightRef.current = false;
        if (!disposed && pendingFrameRef.current !== frame) {
          void drawFrame();
        }
      }
    };

    connector.onFrame((nextFrame) => {
      pendingFrameRef.current = nextFrame;
      setFrameSize((current) => {
        if (current?.width === nextFrame.desktopWidth && current.height === nextFrame.desktopHeight) {
          return current;
        }

        return {
          width: nextFrame.desktopWidth,
          height: nextFrame.desktopHeight,
        };
      });

      void drawFrame();
      setConnected(true);
    }).catch((error) => {
      if (connector.isConnected) {
        logger.error("FE/terminal-view/vnc", "Register frame listener failed", { error });
      }
    });

    connector.onCursor((nextCursor) => {
      setCursorStyle(buildCursorStyle(nextCursor));
      connector.requestFrame(true);
    }).catch((error) => {
      if (connector.isConnected) {
        logger.error("FE/terminal-view/vnc", "Register cursor listener failed", { error });
      }
    });

    connector.requestFrame(true);

    const disposeClose = connector.onClose(() => {
      setConnected(false);
    });

    return () => {
      disposed = true;
      disposeClose();
      pendingFrameRef.current = null;
      decodeInFlightRef.current = false;
      pointerMaskRef.current = 0;
      pointerTargetRef.current = null;
      if (presentTimerRef.current !== null) {
        window.clearTimeout(presentTimerRef.current);
        presentTimerRef.current = null;
      }
      if (presentRafRef.current !== null) {
        window.cancelAnimationFrame(presentRafRef.current);
        presentRafRef.current = null;
      }
      setTransitionMaskVisible(true);
      setFrameSize(null);
      setCursorStyle("default");
      if (cleanupCanvas) {
        const context = cleanupCanvas.getContext("2d");
        context?.clearRect(0, 0, cleanupCanvas.width, cleanupCanvas.height);
      }
      if (backBufferCanvasRef.current) {
        const context = backBufferCanvasRef.current.getContext("2d");
        context?.clearRect(0, 0, backBufferCanvasRef.current.width, backBufferCanvasRef.current.height);
      }
    };
  }, [connector, markVisualReady]);

  useEffect(() => {
    setTransitionMaskVisible(true);
    pointerMaskRef.current = 0;
    pointerTargetRef.current = null;
    setCursorStyle("default");
  }, [activeSession?.id]);

  if (!activeSession || !connector) {
    return null;
  }

  const isViewOnly = activeSession.config?.vncConfig?.viewOnly ?? false;

  const emitPointer = (clientX: number, clientY: number, buttonMask: number) => {
    const pointerSurface = canvasRef.current ?? containerRef.current;
    if (!frameSize || !pointerSurface) {
      return;
    }

    const point = getPointerPosition(
      pointerSurface,
      {
        desktopWidth: frameSize.width,
        desktopHeight: frameSize.height,
      },
      clientX,
      clientY,
    );

    connector.sendPointer({
      x: point.x,
      y: point.y,
      buttonMask,
    });
  };

  const buttonBit = (button: number) => {
    switch (button) {
      case 0:
        return 1;
      case 1:
        return 2;
      case 2:
        return 4;
      default:
        return 0;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isViewOnly) {
      return;
    }

    emitPointer(event.clientX, event.clientY, pointerMaskRef.current);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isViewOnly) {
      return;
    }

    pointerTargetRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bit = buttonBit(event.button);
    pointerMaskRef.current |= bit;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isViewOnly) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerTargetRef.current = null;
    const bit = buttonBit(event.button);
    pointerMaskRef.current &= ~bit;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerTargetRef.current !== null && event.currentTarget.hasPointerCapture(pointerTargetRef.current)) {
      event.currentTarget.releasePointerCapture(pointerTargetRef.current);
    }
    pointerTargetRef.current = null;
    pointerMaskRef.current = 0;
    emitPointer(event.clientX, event.clientY, 0);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (isViewOnly) {
      return;
    }

    const wheelMask = event.deltaY < 0 ? 8 : 16;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current | wheelMask);
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current);
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (isViewOnly) {
      return;
    }

    const keySym = mapKeyboardEventToKeysym(event);
    if (keySym === null) {
      return;
    }

    event.preventDefault();
    connector.sendKey({ keySym, down });
  };

  return (
    <main className="terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden border border-(--terminal-border) bg-black shadow-(--panel-shadow)">
      <div
        ref={containerRef}
        className="relative flex h-full w-full items-center justify-center overflow-hidden outline-none"
        style={{ cursor: cursorStyle }}
        tabIndex={0}
        onClick={(event) => event.currentTarget.focus()}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onWheel={handleWheel}
        onKeyDown={(event) => handleKey(event, true)}
        onKeyUp={(event) => handleKey(event, false)}
        onBlur={() => {
          pointerMaskRef.current = 0;
          pointerTargetRef.current = null;
        }}
      >
        <canvas
          ref={canvasRef}
          className={frameSize ? "max-h-full max-w-full select-none object-contain" : "hidden"}
        />

        {!frameSize ? (
          <div className="flex max-w-md flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/6 px-8 py-10 text-center text-white/80">
            <Monitor className="h-10 w-10 text-emerald-300" />
            <div>
              <div className="text-lg font-semibold text-white">正在连接 VNC 桌面</div>
              <div className="mt-2 text-sm leading-6 text-white/60">首次握手和首帧解码可能需要几秒。连接建立后，鼠标与键盘输入会直接发送到远端桌面。</div>
            </div>
          </div>
        ) : null}

        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-white/80 backdrop-blur-md">
          <MousePointer2 className="h-3.5 w-3.5" />
          <span>{activeSession.title}</span>
          {frameSize ? <span>{frameSize.width} x {frameSize.height}</span> : null}
          {isViewOnly ? <span>只读</span> : null}
        </div>

        {!connected ? (
          <div className="absolute inset-x-0 bottom-6 mx-auto flex w-fit items-center gap-2 rounded-full border border-amber-300/25 bg-amber-500/15 px-4 py-2 text-sm text-amber-100 backdrop-blur-md">
            <RefreshCcw className="h-4 w-4" />
            <span>VNC 连接已断开，关闭标签或重新发起连接以恢复。</span>
          </div>
        ) : null}

        {transitionMaskVisible ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-sm">
            <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-black/50 px-5 py-3 text-sm text-white/90 shadow-2xl">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300" />
              <span>正在同步 VNC 桌面画面...</span>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}