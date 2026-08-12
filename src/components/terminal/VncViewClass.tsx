import { useEffect, useRef, useState, useCallback } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

import { logger } from "@/lib/logger";
import { useSettingsStore } from "@/store/settings";
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
import {
  useBaseGraphicSessionView,
  getPointerPositionCentered,
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
import { windowResizeCoordinator } from "@/services/windowResizeCoordinator";

const VNC_STARTUP_TRACE_WINDOW_MS = 15_000;
const VNC_POINTER_MOVE_LOG_INTERVAL_MS = 250;
const VNC_SLOW_DRAW_LOG_THRESHOLD_MS = 20;
const VNC_ENABLE_DIAGNOSTIC_LOGS = false;
const VNC_KEYSTROKE_PASTE_MAX_LENGTH = 4096;
const VNC_FRAME_QUEUE_MAX_LENGTH = 120;
const VNC_FULL_FRAME_WATCHDOG_MS = 3_000;

interface QueuedVncFrame {
  frame: VncFramePayload;
  sequence: number;
}

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
  const { paneId, sessionId, isVisible = true } = props;
  const {
    canvasRef,
    containerRef,
    frameSize,
    setFrameSize,
    notifyVisualReady,
    renderBlobFrame,
  } = useBaseGraphicSessionView(props);

  const { sessions } = useTabsStore();
  const hasBackgroundImage = useSettingsStore(
    (state) => state.backgroundImageEnabled && !!state.backgroundImage,
  );
  const activeSession = sessions.find((session) => session.id === sessionId);
  const connector = activeSession?.connector?.protocol === "vnc" ? activeSession.connector as IVncConnector : null;
  const viewOnly = activeSession?.config?.vncConfig?.viewOnly ?? false;

  const pointerMaskRef = useRef(0);
  const pointerTargetRef = useRef<number | null>(null);
  const pointerMoveFrameRef = useRef<number | null>(null);
  const pendingPointerMoveRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const lastPointerPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const contextMenuPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const frameQueueRef = useRef<QueuedVncFrame[]>([]);
  const activeFrameRef = useRef<VncFramePayload | null>(null);
  const awaitingFullFrameRef = useRef(true);
  const fullRefreshRequestedRef = useRef(false);
  const fullRefreshRequestedAtRef = useRef<number | null>(null);
  const desktopSizeRef = useRef<{ width: number; height: number } | null>(null);
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
  const reconnectSession = useTabsStore((state) => state.reconnectSession);

  const lastResizeRequestRef = useRef<{ width: number; height: number } | null>(null);

  const focusVncView = useCallback(() => {
    if (!isVisible || useTabsStore.getState().focusSessionId !== sessionId) {
      return;
    }

    containerRef.current?.focus({ preventScroll: true });
  }, [containerRef, isVisible, sessionId]);

  useEffect(() => {
    const animationFrameId = window.requestAnimationFrame(focusVncView);
    window.addEventListener("lazy-term-focus", focusVncView);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener("lazy-term-focus", focusVncView);
    };
  }, [focusVncView]);

  // 容器稳定后请求 ExtendedDesktopSize；不支持该能力的服务端会由后端安全忽略。
  useEffect(() => {
    const container = containerRef.current;
    if (!isVisible || !container || !frameSize || !connector || viewOnly) {
      return;
    }

    const readRequestedSize = (rect: DOMRectReadOnly) => {
      const clampDimension = (value: number, minimum: number) => {
        const rounded = Math.round(value);
        const even = rounded - (rounded % 2);
        return Math.min(8192, Math.max(minimum, even));
      };
      let width = clampDimension(rect.width, 320);
      let height = clampDimension(rect.height, 240);
      const maximumPixels = 32 * 1024 * 1024;
      if (width * height > maximumPixels) {
        const scale = Math.sqrt(maximumPixels / (width * height));
        width = clampDimension(width * scale, 320);
        height = clampDimension(height * scale, 240);
      }
      return { width, height };
    };

    return windowResizeCoordinator.observe(container, (snapshot, rect) => {
      if (snapshot.phase !== "idle" || !isVisible) {
        return;
      }

      const requestedSize = readRequestedSize(rect);
      if (
        requestedSize.width === frameSize.width
        && requestedSize.height === frameSize.height
      ) {
        lastResizeRequestRef.current = requestedSize;
        return;
      }
      if (
        lastResizeRequestRef.current?.width === requestedSize.width
        && lastResizeRequestRef.current?.height === requestedSize.height
      ) {
        return;
      }

      lastResizeRequestRef.current = requestedSize;
      connector.resize(requestedSize.width, requestedSize.height);
    });
  }, [connector, containerRef, frameSize?.height, frameSize?.width, isVisible, viewOnly]);

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
    frameQueueRef.current = [];
    activeFrameRef.current = null;
    awaitingFullFrameRef.current = true;
    fullRefreshRequestedRef.current = false;
    fullRefreshRequestedAtRef.current = null;
    desktopSizeRef.current = null;

    const requestFullFrame = () => {
      if (disposed || !awaitingFullFrameRef.current) {
        return;
      }

      const requestedAt = fullRefreshRequestedAtRef.current;
      if (
        fullRefreshRequestedRef.current
        && requestedAt !== null
        && nowMs() - requestedAt < VNC_FULL_FRAME_WATCHDOG_MS
      ) {
        return;
      }

      fullRefreshRequestedRef.current = true;
      fullRefreshRequestedAtRef.current = nowMs();
      connector.requestFrame(true);
    };

    const recoverWithFullFrame = () => {
      awaitingFullFrameRef.current = true;
      fullRefreshRequestedRef.current = false;
      fullRefreshRequestedAtRef.current = null;
      frameQueueRef.current = [];
      drawTokenRef.current += 1;
      requestFullFrame();
    };

    const drawNextFrame = async () => {
      if (decodeInFlightRef.current || disposed) {
        return;
      }

      const queuedFrame = frameQueueRef.current.shift();
      if (!queuedFrame) {
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        frameQueueRef.current.unshift(queuedFrame);
        return;
      }
      const { frame, sequence: frameSeq } = queuedFrame;

      if (frame.encoding !== "rgba" && frame.encoding !== "png" && frame.encoding !== "jpeg") {
        recoverWithFullFrame();
        return;
      }

      decodeInFlightRef.current = true;
      activeFrameRef.current = frame;
      const drawToken = ++drawTokenRef.current;
      const drawStartedAt = nowMs();

      try {
        let success = false;
        const regionRight = frame.regionLeft + frame.regionWidth;
        const regionBottom = frame.regionTop + frame.regionHeight;
        if (
          frame.regionWidth === 0
          || frame.regionHeight === 0
          || regionRight > frame.desktopWidth
          || regionBottom > frame.desktopHeight
        ) {
          throw new Error(
            `Invalid VNC frame region: ${frame.regionWidth}x${frame.regionHeight}@${frame.regionLeft},${frame.regionTop} for ${frame.desktopWidth}x${frame.desktopHeight}`,
          );
        }

        if (canvas.width !== frame.desktopWidth || canvas.height !== frame.desktopHeight) {
          canvas.width = frame.desktopWidth;
          canvas.height = frame.desktopHeight;
        }

        if (frame.encoding === "rgba") {
          const expectedLength = frame.regionWidth * frame.regionHeight * 4;
          if (frame.imageBytes.byteLength !== expectedLength) {
            throw new Error(
              `Unexpected VNC RGBA frame size: ${frame.imageBytes.byteLength} !== ${expectedLength}`,
            );
          }

          const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
          if (!context) {
            throw new Error("VNC canvas 2D context is unavailable");
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
            isCurrent: () => !disposed && drawToken === drawTokenRef.current,
          });
        }

        if (success && !disposed && drawToken === drawTokenRef.current) {
          const drawElapsed = Math.round(nowMs() - drawStartedAt);
          if (inStartupTraceWindow() || drawElapsed >= VNC_SLOW_DRAW_LOG_THRESHOLD_MS) {
            logFrame(
              `t=${elapsedMs()}ms seq=${frameSeq} phase=draw encoding=${frame.encoding} full=${frame.fullFrame} region=${frame.regionWidth}x${frame.regionHeight}@${frame.regionLeft},${frame.regionTop} area_pct=${frameAreaPct(frame)} draw_ms=${drawElapsed} decode_in_flight=${decodeInFlightRef.current} queued=${frameQueueRef.current.length}`,
            );
          }
          desktopSizeRef.current = {
            width: frame.desktopWidth,
            height: frame.desktopHeight,
          };
          setFrameSize((current) => (
            current?.width === frame.desktopWidth && current?.height === frame.desktopHeight
              ? current
              : {
                  width: frame.desktopWidth,
                  height: frame.desktopHeight,
                }
          ));
          if (frame.fullFrame) {
            notifyVisualReady();
          }
        } else if (!disposed && drawToken === drawTokenRef.current) {
          recoverWithFullFrame();
        }
      } catch (error) {
        if (!disposed) {
          logger.error("FE/terminal-view/vnc", "Canvas decode failed", { error });
          if (drawToken === drawTokenRef.current) {
            recoverWithFullFrame();
          }
        }
      } finally {
        activeFrameRef.current = null;
        decodeInFlightRef.current = false;
        if (!disposed && frameQueueRef.current.length > 0) {
          void drawNextFrame();
        }
      }
    };

    const fullFrameWatchdog = window.setInterval(() => {
      if (awaitingFullFrameRef.current) {
        requestFullFrame();
      }
    }, 1_000);

    connector.onFrame((nextFrame) => {
      const frameSeq = ++frameSeqRef.current;
      if (inStartupTraceWindow() || nextFrame.fullFrame || decodeInFlightRef.current) {
        logFrame(
          `t=${elapsedMs()}ms seq=${frameSeq} phase=recv encoding=${nextFrame.encoding} full=${nextFrame.fullFrame} region=${nextFrame.regionWidth}x${nextFrame.regionHeight}@${nextFrame.regionLeft},${nextFrame.regionTop} area_pct=${frameAreaPct(nextFrame)} decode_in_flight=${decodeInFlightRef.current} queued=${frameQueueRef.current.length}`,
        );
      }

      const knownDesktopSize = desktopSizeRef.current;
      const desktopChanged = knownDesktopSize !== null
        && (knownDesktopSize.width !== nextFrame.desktopWidth
          || knownDesktopSize.height !== nextFrame.desktopHeight);

      if (nextFrame.fullFrame) {
        awaitingFullFrameRef.current = false;
        fullRefreshRequestedRef.current = false;
        fullRefreshRequestedAtRef.current = null;
        desktopSizeRef.current = {
          width: nextFrame.desktopWidth,
          height: nextFrame.desktopHeight,
        };
        frameQueueRef.current = [{ frame: nextFrame, sequence: frameSeq }];

        if (decodeInFlightRef.current && activeFrameRef.current?.encoding !== "rgba") {
          drawTokenRef.current += 1;
        }
      } else {
        if (desktopChanged) {
          recoverWithFullFrame();
          return;
        }
        if (awaitingFullFrameRef.current) {
          requestFullFrame();
          return;
        }
        if (frameQueueRef.current.length >= VNC_FRAME_QUEUE_MAX_LENGTH) {
          recoverWithFullFrame();
          return;
        }
        frameQueueRef.current.push({ frame: nextFrame, sequence: frameSeq });
      }

      void drawNextFrame();
    }).then(() => {
      requestFullFrame();
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
      window.clearInterval(fullFrameWatchdog);
      drawTokenRef.current += 1;
      pointerMaskRef.current = 0;
      pointerTargetRef.current = null;
      pendingPointerMoveRef.current = null;
      lastPointerPointRef.current = null;
      if (pointerMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current);
        pointerMoveFrameRef.current = null;
      }
      suppressedPasteKeyCodesRef.current.clear();
      frameQueueRef.current = [];
      activeFrameRef.current = null;
      awaitingFullFrameRef.current = true;
      fullRefreshRequestedRef.current = false;
      fullRefreshRequestedAtRef.current = null;
      desktopSizeRef.current = null;
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
    pendingPointerMoveRef.current = null;
    lastPointerPointRef.current = null;
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }
    contextMenuPointRef.current = null;
    setCursorStyle("default");
  }, [activeSession?.id]);

  useEffect(() => {
    if (activeSession?.connectionStatus.phase !== "reconnecting") {
      return;
    }

    drawTokenRef.current += 1;
    frameQueueRef.current = [];
    activeFrameRef.current = null;
    decodeInFlightRef.current = false;
    awaitingFullFrameRef.current = true;
    fullRefreshRequestedRef.current = false;
    fullRefreshRequestedAtRef.current = null;
    desktopSizeRef.current = null;
  }, [activeSession?.connectionStatus.phase]);

  if (!activeSession || !connector) {
    return null;
  }

  const emitPointer = useCallback((clientX: number, clientY: number, buttonMask: number, source: "move" | "down" | "up" | "cancel" | "wheel") => {
    const pointerSurface = canvasRef.current ?? containerRef.current;
    if (viewOnly || !frameSize || !pointerSurface) {
      return;
    }

    const point = getPointerPositionCentered(
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
        `t=${elapsedMs()}ms seq=${inputSeqRef.current} kind=${source} x=${point.x} y=${point.y} button_mask=${buttonMask} decode_in_flight=${decodeInFlightRef.current} queued=${frameQueueRef.current.length}`,
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

  const discardPendingPointerMove = () => {
    pendingPointerMoveRef.current = null;
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (viewOnly) {
      return;
    }

    const point = { clientX: event.clientX, clientY: event.clientY };
    lastPointerPointRef.current = point;
    pendingPointerMoveRef.current = point;
    if (pointerMoveFrameRef.current !== null) {
      return;
    }

    pointerMoveFrameRef.current = window.requestAnimationFrame(() => {
      pointerMoveFrameRef.current = null;
      const pendingPoint = pendingPointerMoveRef.current;
      pendingPointerMoveRef.current = null;
      if (pendingPoint) {
        emitPointer(
          pendingPoint.clientX,
          pendingPoint.clientY,
          pointerMaskRef.current,
          "move",
        );
      }
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (viewOnly) {
      return;
    }
    event.preventDefault();
    event.currentTarget.focus();
    discardPendingPointerMove();
    lastPointerPointRef.current = { clientX: event.clientX, clientY: event.clientY };
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
    discardPendingPointerMove();
    lastPointerPointRef.current = { clientX: event.clientX, clientY: event.clientY };
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
    discardPendingPointerMove();
    lastPointerPointRef.current = { clientX: event.clientX, clientY: event.clientY };
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
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.preventDefault();
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
        `t=${elapsedMs()}ms seq=${inputSeqRef.current} kind=key key_sym=${keySym} down=${down} code=${event.code} decode_in_flight=${decodeInFlightRef.current} queued=${frameQueueRef.current.length}`,
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

  const handleCompositionEnd = (event: React.CompositionEvent<HTMLDivElement>) => {
    if (viewOnly || !event.data) {
      return;
    }

    event.preventDefault();
    void connector.typeText(event.data, []).catch((error) => {
      logger.error("FE/terminal-view/vnc/input", "IME text input failed", { error });
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
      discardPendingPointerMove();
      lastPointerPointRef.current = { clientX: event.clientX, clientY: event.clientY };

      const wheelMask = event.deltaY < 0 ? 8 : 16;
      emitPointer(event.clientX, event.clientY, pointerMaskRef.current | wheelMask, "wheel");
      emitPointer(event.clientX, event.clientY, pointerMaskRef.current, "wheel");
    };

    container.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onNativeWheel);
    };
  }, [containerRef, emitPointer, viewOnly]);

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
          style={{ backgroundColor: hasBackgroundImage ? "transparent" : undefined }}
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
            onCompositionEnd={handleCompositionEnd}
            onPaste={handlePaste}
            onBlur={() => {
              discardPendingPointerMove();
              const lastPoint = lastPointerPointRef.current;
              if (pointerMaskRef.current !== 0 && lastPoint) {
                emitPointer(lastPoint.clientX, lastPoint.clientY, 0, "cancel");
              }
              pointerMaskRef.current = 0;
              pointerTargetRef.current = null;
            }}
          >
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
