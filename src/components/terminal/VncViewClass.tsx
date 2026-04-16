import { useEffect, useRef, useState, useCallback } from "react";

import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import type { IVncConnector, VncFramePayload } from "@/types/terminal";
import {
  type BaseSessionViewProps,
  TransitionMask,
  GraphicalSessionOverlay,
  VIEW_CONTAINER_CLASSNAME,
  CANVAS_CLASSNAME,
  HIDDEN_CLASSNAME,
  INTERACTIVE_CONTAINER_CLASSNAME,
} from "./BaseSessionView";
import {
  useBaseGraphicSessionView,
  getPointerPositionScaled,
  mapVncKeyboardEvent,
  buildCursorStyleFromRgba,
} from "./BaseGraphicSessionView";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const VNC_STARTUP_TRACE_WINDOW_MS = 15_000;
const VNC_POINTER_MOVE_LOG_INTERVAL_MS = 250;
const VNC_SLOW_DRAW_LOG_THRESHOLD_MS = 20;
const VNC_ENABLE_DIAGNOSTIC_LOGS = false;

export function VncViewClass(props: BaseSessionViewProps) {
  const { t } = useI18n();
  const { paneId, sessionId } = props;
  const {
    canvasRef,
    containerRef,
    frameSize,
    setFrameSize,
    setConnected,
    notifyVisualReady,
    renderBlobFrame,
  } = useBaseGraphicSessionView(props);

  const { sessions } = useTabsStore();
  const activeSession = sessions.find((session) => session.id === sessionId);
  const connector = activeSession?.connector?.protocol === "vnc" ? activeSession.connector as IVncConnector : null;

  const pointerMaskRef = useRef(0);
  const pointerTargetRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<VncFramePayload | null>(null);
  const pendingFrameSeqRef = useRef(0);
  const decodeInFlightRef = useRef(false);
  const drawTokenRef = useRef(0);
  const traceStartedAtRef = useRef(
    typeof performance !== "undefined" ? performance.now() : Date.now(),
  );
  const frameSeqRef = useRef(0);
  const inputSeqRef = useRef(0);
  const lastPointerMoveLogAtRef = useRef(0);
  const everConnectedRef = useRef(false);
  const [isClosed, setIsClosed] = useState(false);
  const [cursorStyle, setCursorStyle] = useState("default");
  const [retrying, setRetrying] = useState(false);
  const reconnectSession = useTabsStore((state) => state.reconnectSession);

  const [resizeMaskVisible, setResizeMaskVisible] = useState(false);
  const resizeTimerRef = useRef<number | null>(null);

  // ResizeObserver for mask timing
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Skip initial mount
    let initialMount = true;
    
    const resizeObserver = new ResizeObserver(() => {
      if (initialMount) {
        initialMount = false;
        return;
      }
      setResizeMaskVisible(true);
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        setResizeMaskVisible(false);
      }, 2000);
    });

    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [containerRef]);

  const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const elapsedMs = () => Math.round(nowMs() - traceStartedAtRef.current);
  const inStartupTraceWindow = () => VNC_ENABLE_DIAGNOSTIC_LOGS && elapsedMs() <= VNC_STARTUP_TRACE_WINDOW_MS;
  const frameAreaPct = (frame: VncFramePayload) => {
    const desktopArea = frame.desktopWidth * frame.desktopHeight;
    if (!desktopArea) {
      return 0;
    }
    return Math.round((frame.regionWidth * frame.regionHeight * 100) / desktopArea);
  };
  const logFrame = (message: string) => {
    if (VNC_ENABLE_DIAGNOSTIC_LOGS) {
      logger.info("FE/terminal-view/vnc/frame", message);
    }
  };
  const logInput = (message: string) => {
    if (VNC_ENABLE_DIAGNOSTIC_LOGS) {
      logger.info("FE/terminal-view/vnc/input", message);
    }
  };

  useEffect(() => {
    if (!connector) {
      return;
    }

    let disposed = false;
    const cleanupCanvas = canvasRef.current;
    traceStartedAtRef.current = nowMs();
    frameSeqRef.current = 0;
    inputSeqRef.current = 0;
    lastPointerMoveLogAtRef.current = 0;
    pendingFrameSeqRef.current = 0;

    const drawLatestFrame = async () => {
      if (decodeInFlightRef.current || disposed) {
        return;
      }

      const frame = pendingFrameRef.current;
      const frameSeq = pendingFrameSeqRef.current;
      const canvas = canvasRef.current;
      if (!frame || !canvas) {
        return;
      }

      if (frame.encoding !== "rgba" && frame.encoding !== "png" && frame.encoding !== "jpeg") {
        pendingFrameRef.current = null;
        return;
      }

      decodeInFlightRef.current = true;
      const drawToken = ++drawTokenRef.current;
      const drawStartedAt = nowMs();

      try {
        let success = false;

        if (canvas.width !== frame.desktopWidth || canvas.height !== frame.desktopHeight) {
          canvas.width = frame.desktopWidth;
          canvas.height = frame.desktopHeight;
        }

        if (frame.encoding === "rgba") {
          const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
          if (!context) {
            return;
          }

          context.imageSmoothingEnabled = false;
          context.putImageData(
            new ImageData(
              new Uint8ClampedArray(frame.imageBytes),
              frame.regionWidth,
              frame.regionHeight,
            ),
            frame.regionLeft,
            frame.regionTop,
          );
          success = true;
        } else {
          const blob = new Blob([frame.imageBytes], {
            type: frame.encoding === "png" ? "image/png" : "image/jpeg",
          });
          success = await renderBlobFrame(canvas, blob, frame.desktopWidth, frame.desktopHeight, {
            disposed,
            token: drawToken,
            currentToken: drawTokenRef.current,
          });
        }

        if (success && !disposed && drawToken === drawTokenRef.current) {
          const drawElapsed = Math.round(nowMs() - drawStartedAt);
          if (inStartupTraceWindow() || drawElapsed >= VNC_SLOW_DRAW_LOG_THRESHOLD_MS) {
            logFrame(
              `t=${elapsedMs()}ms seq=${frameSeq} phase=draw encoding=${frame.encoding} full=${frame.fullFrame} region=${frame.regionWidth}x${frame.regionHeight}@${frame.regionLeft},${frame.regionTop} area_pct=${frameAreaPct(frame)} draw_ms=${drawElapsed} decode_in_flight=${decodeInFlightRef.current} pending_replaced=${pendingFrameRef.current !== frame}`,
            );
          }
          setFrameSize({
            width: frame.desktopWidth,
            height: frame.desktopHeight,
          });
          setConnected(true);
          notifyVisualReady();
        }
      } catch (error) {
        if (!disposed) {
          logger.error("FE/terminal-view/vnc", "Canvas decode failed", { error });
        }
      } finally {
        decodeInFlightRef.current = false;
        if (!disposed && pendingFrameRef.current !== frame) {
          void drawLatestFrame();
        }
      }
    };

    connector.onFrame((nextFrame) => {
      everConnectedRef.current = true;
      const frameSeq = ++frameSeqRef.current;
      pendingFrameSeqRef.current = frameSeq;
      if (inStartupTraceWindow() || nextFrame.fullFrame || decodeInFlightRef.current) {
        logFrame(
          `t=${elapsedMs()}ms seq=${frameSeq} phase=recv encoding=${nextFrame.encoding} full=${nextFrame.fullFrame} region=${nextFrame.regionWidth}x${nextFrame.regionHeight}@${nextFrame.regionLeft},${nextFrame.regionTop} area_pct=${frameAreaPct(nextFrame)} decode_in_flight=${decodeInFlightRef.current} has_pending=${pendingFrameRef.current !== null}`,
        );
      }
      pendingFrameRef.current = nextFrame;
      void drawLatestFrame();
    }).catch((error) => {
      if (connector.isConnected) {
        logger.error("FE/terminal-view/vnc", "Register frame listener failed", { error });
      }
    });

    connector.onCursor((nextCursor) => {
      const style = buildCursorStyleFromRgba(
        nextCursor.width,
        nextCursor.height,
        new Uint8Array(nextCursor.rgbaBytes),
        nextCursor.hotspotX,
        nextCursor.hotspotY
      );
      setCursorStyle(style);
    }).catch((error) => {
      if (connector.isConnected) {
        logger.error("FE/terminal-view/vnc", "Register cursor listener failed", { error });
      }
    });

    connector.requestFrame(true);

    const disposeClose = connector.onClose(() => {
      setIsClosed(true);
      setConnected(false);
    });

    return () => {
      disposed = true;
      drawTokenRef.current += 1;
      disposeClose();
      pointerMaskRef.current = 0;
      pointerTargetRef.current = null;
      pendingFrameRef.current = null;
      pendingFrameSeqRef.current = 0;
      decodeInFlightRef.current = false;
      setFrameSize(null);
      setCursorStyle("default");
      if (cleanupCanvas) {
        const context = cleanupCanvas.getContext("2d");
        context?.clearRect(0, 0, cleanupCanvas.width, cleanupCanvas.height);
      }
    };
  }, [connector, notifyVisualReady, renderBlobFrame, setConnected, setFrameSize, canvasRef]);

  useEffect(() => {
    pointerMaskRef.current = 0;
    pointerTargetRef.current = null;
    setCursorStyle("default");
  }, [activeSession?.id]);

  if (!activeSession || !connector) {
    return null;
  }

  const isViewOnly = activeSession.config?.vncConfig?.viewOnly ?? false;

  const emitPointer = useCallback((clientX: number, clientY: number, buttonMask: number, source: "move" | "down" | "up" | "cancel" | "wheel") => {
    const pointerSurface = canvasRef.current ?? containerRef.current;
    if (!frameSize || !pointerSurface) {
      return;
    }

    const point = getPointerPositionScaled(
      pointerSurface,
      {
        desktopWidth: frameSize.width,
        desktopHeight: frameSize.height,
      },
      clientX,
      clientY,
    );

    const currentNow = nowMs();
    const shouldLogMove = source === "move"
      && inStartupTraceWindow()
      && currentNow - lastPointerMoveLogAtRef.current >= VNC_POINTER_MOVE_LOG_INTERVAL_MS;
    const shouldLog = source !== "move" ? inStartupTraceWindow() : shouldLogMove;
    if (shouldLog) {
      if (source === "move") {
        lastPointerMoveLogAtRef.current = currentNow;
      }
      inputSeqRef.current += 1;
      logInput(
        `t=${elapsedMs()}ms seq=${inputSeqRef.current} kind=${source} x=${point.x} y=${point.y} button_mask=${buttonMask} decode_in_flight=${decodeInFlightRef.current} has_pending=${pendingFrameRef.current !== null}`,
      );
    }

    connector.sendPointer({
      x: point.x,
      y: point.y,
      buttonMask,
    });
  }, [canvasRef, connector, containerRef, frameSize]);

  const buttonBit = (button: number) => {
    switch (button) {
      case 0: return 1;
      case 1: return 2;
      case 2: return 4;
      default: return 0;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isViewOnly) return;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "move");
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isViewOnly) return;

    event.preventDefault();
    event.currentTarget.focus();
    pointerTargetRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bit = buttonBit(event.button);
    pointerMaskRef.current |= bit;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "down");
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isViewOnly) return;

    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerTargetRef.current = null;
    const bit = buttonBit(event.button);
    pointerMaskRef.current &= ~bit;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "up");
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (pointerTargetRef.current !== null && event.currentTarget.hasPointerCapture(pointerTargetRef.current)) {
      event.currentTarget.releasePointerCapture(pointerTargetRef.current);
    }
    pointerTargetRef.current = null;
    pointerMaskRef.current = 0;
    emitPointer(event.clientX, event.clientY, 0, "cancel");
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (isViewOnly) return;

    const keySym = mapVncKeyboardEvent(event);
    if (keySym === null) return;

    event.preventDefault();
    if (inStartupTraceWindow()) {
      inputSeqRef.current += 1;
      logInput(
        `t=${elapsedMs()}ms seq=${inputSeqRef.current} kind=key key_sym=${keySym} down=${down} code=${event.code} decode_in_flight=${decodeInFlightRef.current} has_pending=${pendingFrameRef.current !== null}`,
      );
    }
    connector.sendKey({ keySym, down });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (isViewOnly) {
        return;
      }

      const wheelMask = event.deltaY < 0 ? 8 : 16;
      emitPointer(event.clientX, event.clientY, pointerMaskRef.current | wheelMask, "wheel");
      emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "wheel");
    };

    container.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onNativeWheel);
    };
  }, [containerRef, emitPointer, isViewOnly]);

  return (
    <main
      className={cn(VIEW_CONTAINER_CLASSNAME, "bg-(--terminal-shell)")}
      data-view-type="vnc"
      data-session-id={sessionId}
      data-pane-id={paneId}
    >
      <div
        ref={containerRef}
        className={INTERACTIVE_CONTAINER_CLASSNAME}
        style={{ cursor: cursorStyle }}
        tabIndex={0}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={(event) => handleKey(event, true)}
        onKeyUp={(event) => handleKey(event, false)}
        onBlur={() => {
          pointerMaskRef.current = 0;
          pointerTargetRef.current = null;
        }}
      >
        <TransitionMask 
          visible={resizeMaskVisible} 
          text={t("正在调整画面比例...")}
        />
        <canvas
          ref={canvasRef}
          className={frameSize ? CANVAS_CLASSNAME : HIDDEN_CLASSNAME}
        />

        <GraphicalSessionOverlay
          mode={!connector.isConnected 
            ? (isClosed ? (everConnectedRef.current ? "disconnected" : "failed") : "connecting") 
            : (!frameSize ? "connecting" : "none")}
          titleText={!connector.isConnected 
            ? (isClosed ? (everConnectedRef.current ? t("连接断开") : t("连接失败")) : t("正在建立连接"))
            : t("正在建立连接")}
          description={!connector.isConnected 
            ? (isClosed ? (everConnectedRef.current ? t("与远程主机的 VNC 连接已终止。") : t("无法与 VNC 服务器建立连接，请检查配置。")) : t("正在初始化连接..."))
            : t("正在尝试与目标主机建立 RFB 协议通信并解码首帧画面...")}
          protocol="VNC"
          sessionConfigDetails={[
            { label: t("目标地址"), value: activeSession.config?.vncConfig?.host ? `${activeSession.config.vncConfig.host}:${activeSession.config.vncConfig.port || 5900}` : activeSession.title },
            { label: t("颜色深度"), value: t("真彩色 (24-bit)") }
          ]}
          onReconnect={() => {
            if (retrying) return;
            setRetrying(true);
            reconnectSession(activeSession.id);
          }}
          interactive={!connector.isConnected}
          zIndexClass="z-30"
        />
      </div>
    </main>
  );
}
