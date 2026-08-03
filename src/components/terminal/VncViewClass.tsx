import { useEffect, useRef, useState, useCallback } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import type { IVncConnector, VncFramePayload } from "@/types/terminal";
import {
  type BaseSessionViewProps,
  VIEW_CONTAINER_CLASSNAME,
  CANVAS_CLASSNAME,
  HIDDEN_CLASSNAME,
  INTERACTIVE_CONTAINER_CLASSNAME,
} from "./BaseSessionView";
import { ConnectionStatusOverlay } from "./ConnectionStatusOverlay";
import { SessionTransitionMask } from "./SessionTransitionMask";
import {
  useBaseGraphicSessionView,
  getPointerPositionScaled,
  mapVncKeyboardEvent,
  buildCursorStyleFromRgba,
} from "./BaseGraphicSessionView";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const VNC_STARTUP_TRACE_WINDOW_MS = 15_000;
const VNC_POINTER_MOVE_LOG_INTERVAL_MS = 250;
const VNC_SLOW_DRAW_LOG_THRESHOLD_MS = 20;
const VNC_ENABLE_DIAGNOSTIC_LOGS = false;
const VNC_KEYSTROKE_PASTE_MAX_LENGTH = 4096;

const VNC_KEY_SYM = {
  backspace: 0xff08,
  tab: 0xff09,
  escape: 0xff1b,
  printScreen: 0xff61,
  delete: 0xffff,
  controlLeft: 0xffe3,
  altLeft: 0xffe9,
  metaLeft: 0xffeb,
} as const;

const VNC_COMMON_KEY_SEQUENCES = [
  { label: "Ctrl+Alt+Del", keySyms: [VNC_KEY_SYM.controlLeft, VNC_KEY_SYM.altLeft, VNC_KEY_SYM.delete] },
  { label: "Ctrl+Esc", keySyms: [VNC_KEY_SYM.controlLeft, VNC_KEY_SYM.escape] },
  { label: "Alt+Tab", keySyms: [VNC_KEY_SYM.altLeft, VNC_KEY_SYM.tab] },
  { label: "Alt+Esc", keySyms: [VNC_KEY_SYM.altLeft, VNC_KEY_SYM.escape] },
  { label: "Windows", keySyms: [VNC_KEY_SYM.metaLeft] },
  { label: "Print Screen", keySyms: [VNC_KEY_SYM.printScreen] },
  { label: "Ctrl+Alt+Backspace", keySyms: [VNC_KEY_SYM.controlLeft, VNC_KEY_SYM.altLeft, VNC_KEY_SYM.backspace] },
] as const;

function normalizeVncPasteText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function canPasteVncTextAsKeystrokes(text: string) {
  return text.length > 0
    && text.length <= VNC_KEYSTROKE_PASTE_MAX_LENGTH
    && /^[\t\n\x20-\x7e]*$/.test(text);
}

export function VncViewClass(props: BaseSessionViewProps) {
  const { t } = useI18n();
  const { paneId, sessionId } = props;
  const {
    canvasRef,
    containerRef,
    frameSize,
    setFrameSize,
    notifyVisualReady,
    renderBlobFrame,
  } = useBaseGraphicSessionView(props);

  const { sessions } = useTabsStore();
  const activeSession = sessions.find((session) => session.id === sessionId);
  const connector = activeSession?.connector?.protocol === "vnc" ? activeSession.connector as IVncConnector : null;
  const viewOnly = activeSession?.config?.vncConfig?.viewOnly ?? false;

  const pointerMaskRef = useRef(0);
  const pointerTargetRef = useRef<number | null>(null);
  const contextMenuPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
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
  const suppressedPasteKeyCodesRef = useRef(new Set<string>());
  const [cursorStyle, setCursorStyle] = useState("default");
  const [visuallyReadyConnector, setVisuallyReadyConnector] = useState<IVncConnector | null>(null);
  const reconnectSession = useTabsStore((state) => state.reconnectSession);

  const [resizeMaskVisible, setResizeMaskVisible] = useState(false);
  const resizeTimerRef = useRef<number | null>(null);

  // 仅在 VNC 画布的实际显示尺寸变化时显示比例调整遮罩。
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas || !frameSize) {
      return;
    }

    const readRenderedSize = () => {
      const rect = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      return {
        width: Math.round(rect.width * pixelRatio),
        height: Math.round(rect.height * pixelRatio),
      };
    };
    let lastRenderedSize: { width: number; height: number } | null = readRenderedSize();

    const resizeObserver = new ResizeObserver(() => {
      const nextRenderedSize = readRenderedSize();
      if (nextRenderedSize.width <= 0 || nextRenderedSize.height <= 0) {
        return;
      }
      if (
        !lastRenderedSize
        || lastRenderedSize.width <= 0
        || lastRenderedSize.height <= 0
      ) {
        lastRenderedSize = nextRenderedSize;
        return;
      }
      if (
        nextRenderedSize.width === lastRenderedSize.width
        && nextRenderedSize.height === lastRenderedSize.height
      ) {
        return;
      }

      lastRenderedSize = nextRenderedSize;
      setResizeMaskVisible(true);
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        setResizeMaskVisible(false);
        resizeTimerRef.current = null;
      }, 2000);
    });

    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      setResizeMaskVisible(false);
    };
  }, [canvasRef, containerRef, frameSize?.height, frameSize?.width]);

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
          setFrameSize((current) => (
            current?.width === frame.desktopWidth && current?.height === frame.desktopHeight
              ? current
              : {
                  width: frame.desktopWidth,
                  height: frame.desktopHeight,
                }
          ));
          if (frame.fullFrame) {
            setVisuallyReadyConnector(connector);
            notifyVisualReady();
          }
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
      const frameSeq = ++frameSeqRef.current;
      pendingFrameSeqRef.current = frameSeq;
      if (inStartupTraceWindow() || nextFrame.fullFrame || decodeInFlightRef.current) {
        logFrame(
          `t=${elapsedMs()}ms seq=${frameSeq} phase=recv encoding=${nextFrame.encoding} full=${nextFrame.fullFrame} region=${nextFrame.regionWidth}x${nextFrame.regionHeight}@${nextFrame.regionLeft},${nextFrame.regionTop} area_pct=${frameAreaPct(nextFrame)} decode_in_flight=${decodeInFlightRef.current} has_pending=${pendingFrameRef.current !== null}`,
        );
      }
      pendingFrameRef.current = nextFrame;
      void drawLatestFrame();
    }).then(() => {
      if (!disposed) {
        connector.requestFrame(true);
      }
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

    connector.onClipboard((text) => {
      if (disposed || useTabsStore.getState().focusSessionId !== sessionId) {
        return;
      }
      writeText(text).catch((error) => {
        logger.error("FE/terminal-view/vnc/clipboard", "Write remote clipboard failed", { error });
      });
    }).catch((error) => {
      if (connector.isConnected) {
        logger.error("FE/terminal-view/vnc/clipboard", "Register clipboard listener failed", { error });
      }
    });

    return () => {
      disposed = true;
      drawTokenRef.current += 1;
      pointerMaskRef.current = 0;
      pointerTargetRef.current = null;
      suppressedPasteKeyCodesRef.current.clear();
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
  }, [connector, notifyVisualReady, renderBlobFrame, setFrameSize, canvasRef]);

  useEffect(() => {
    pointerMaskRef.current = 0;
    pointerTargetRef.current = null;
    contextMenuPointRef.current = null;
    setCursorStyle("default");
  }, [activeSession?.id]);

  if (!activeSession || !connector) {
    return null;
  }

  const emitPointer = useCallback((clientX: number, clientY: number, buttonMask: number, source: "move" | "down" | "up" | "cancel" | "wheel") => {
    const pointerSurface = canvasRef.current ?? containerRef.current;
    if (viewOnly || !frameSize || !pointerSurface) {
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
  }, [canvasRef, connector, containerRef, frameSize, viewOnly]);

  const buttonBit = (button: number) => {
    switch (button) {
      case 0: return 1;
      case 1: return 2;
      case 2: return 4;
      default: return 0;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "move");
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (viewOnly) {
      return;
    }
    event.preventDefault();
    event.currentTarget.focus();
    if (event.button === 2 && !event.shiftKey) {
      contextMenuPointRef.current = { clientX: event.clientX, clientY: event.clientY };
      return;
    }
    pointerTargetRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bit = buttonBit(event.button);
    pointerMaskRef.current |= bit;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "down");
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (viewOnly) {
      return;
    }
    event.preventDefault();
    if (event.button === 2 && !event.shiftKey) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerTargetRef.current = null;
    const bit = buttonBit(event.button);
    pointerMaskRef.current &= ~bit;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "up");
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (viewOnly) {
      return;
    }
    event.preventDefault();
    if (pointerTargetRef.current !== null && event.currentTarget.hasPointerCapture(pointerTargetRef.current)) {
      event.currentTarget.releasePointerCapture(pointerTargetRef.current);
    }
    pointerTargetRef.current = null;
    pointerMaskRef.current = 0;
    emitPointer(event.clientX, event.clientY, 0, "cancel");
  };

  const pasteLocalText = (text: string, keySym: number, modifierKeySyms: number[]) => {
    const normalizedText = normalizeVncPasteText(text);
    if (!normalizedText) {
      return Promise.resolve();
    }

    if (canPasteVncTextAsKeystrokes(normalizedText)) {
      return connector.typeText(normalizedText, modifierKeySyms);
    }

    return connector.pasteClipboard(text, keySym, modifierKeySyms);
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (viewOnly) {
      return;
    }

    const keySym = mapVncKeyboardEvent(event);
    if (keySym === null) return;

    const isPasteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
    if (!down && suppressedPasteKeyCodesRef.current.delete(event.code)) {
      event.preventDefault();
      return;
    }

    if (down && isPasteShortcut) {
      event.preventDefault();
      if (event.repeat) {
        return;
      }

      suppressedPasteKeyCodesRef.current.add(event.code);
      const modifierKeySyms: number[] = [];
      if (event.ctrlKey) modifierKeySyms.push(0xffe3);
      if (event.metaKey) modifierKeySyms.push(0xffeb);
      if (event.shiftKey) modifierKeySyms.push(0xffe1);

      readText()
        .then((text) => pasteLocalText(text, keySym, modifierKeySyms))
        .catch((error) => {
          logger.error("FE/terminal-view/vnc/clipboard", "Paste local clipboard failed", { error });
        });
      return;
    }

    event.preventDefault();
    if (inStartupTraceWindow()) {
      inputSeqRef.current += 1;
      logInput(
        `t=${elapsedMs()}ms seq=${inputSeqRef.current} kind=key key_sym=${keySym} down=${down} code=${event.code} decode_in_flight=${decodeInFlightRef.current} has_pending=${pendingFrameRef.current !== null}`,
      );
    }
    connector.sendKey({ keySym, down });
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (viewOnly) {
      return;
    }

    const text = event.clipboardData.getData("text/plain");
    if (!text) {
      return;
    }

    event.preventDefault();
    void pasteLocalText(text, 0x76, [0xffe3]).catch((error) => {
      logger.error("FE/terminal-view/vnc/clipboard", "Paste local clipboard failed", { error });
    });
  };

  const sendRemoteRightClick = () => {
    const point = contextMenuPointRef.current;
    if (!point || viewOnly || !connector.isConnected) {
      return;
    }

    emitPointer(point.clientX, point.clientY, 4, "down");
    emitPointer(point.clientX, point.clientY, 0, "up");
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onNativeWheel = (event: WheelEvent) => {
      if (viewOnly) {
        return;
      }
      event.preventDefault();

      const wheelMask = event.deltaY < 0 ? 8 : 16;
      emitPointer(event.clientX, event.clientY, pointerMaskRef.current | wheelMask, "wheel");
      emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "wheel");
    };

    container.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onNativeWheel);
    };
  }, [containerRef, emitPointer, viewOnly]);

  const transitionMaskVisible = visuallyReadyConnector !== connector;

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
            return;
          }

          contextMenuPointRef.current = { clientX: event.clientX, clientY: event.clientY };
        }}
      >
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
            onPaste={handlePaste}
            onBlur={() => {
              pointerMaskRef.current = 0;
              pointerTargetRef.current = null;
            }}
          >
            <SessionTransitionMask
              visible={activeSession.connectionStatus.phase === "connected" && (transitionMaskVisible || resizeMaskVisible)}
              text={transitionMaskVisible ? t("正在同步 VNC 画面...") : t("正在调整画面比例...")}
            />
            <canvas
              ref={canvasRef}
              className={frameSize ? CANVAS_CLASSNAME : HIDDEN_CLASSNAME}
            />

            {viewOnly && (
              <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-md border border-border/70 bg-background/85 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                {t("仅查看")}
              </div>
            )}

            <ConnectionStatusOverlay
              status={activeSession.connectionStatus}
              protocol="VNC"
              target={activeSession.config?.vncConfig?.host
                ? `${activeSession.config.vncConfig.host}:${activeSession.config.vncConfig.port || 5900}`
                : activeSession.title}
              details={[
                { label: t("颜色深度"), value: t("真彩色 (24-bit)") }
              ]}
              onReconnect={() => reconnectSession(activeSession.id)}
            />
          </div>
        </main>
      </ContextMenuTrigger>
      <ContextMenuContent
        updatePositionStrategy="always"
        className="min-w-52 text-xs"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          containerRef.current?.focus({ preventScroll: true });
        }}
      >
        <ContextMenuLabel className="py-1 text-xs text-muted-foreground">
          {t("发送常用按键")}
        </ContextMenuLabel>
        {VNC_COMMON_KEY_SEQUENCES.map((sequence) => (
          <ContextMenuItem
            key={sequence.label}
            className="py-1.5 text-xs"
            disabled={viewOnly || !connector.isConnected}
            onSelect={() => connector.sendKeySequence({ keySyms: [...sequence.keySyms] })}
          >
            {sequence.label}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem
          className="py-1.5 text-xs"
          disabled={viewOnly || !connector.isConnected || !contextMenuPointRef.current}
          onSelect={sendRemoteRightClick}
        >
          {t("发送鼠标右键")}
          <ContextMenuShortcut>Shift+{t("右键")}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
