import { useCallback, useEffect, useRef } from "react";
import { logger } from "@/lib/logger";
import { useSettingsStore } from "@/store/settings";
import { useTabsStore } from "@/store/tabs";
import { NativeRdpHostView } from "@/components/terminal/NativeRdpHostView";
import type { INativeRdpConnector, IRdpConnector, RdpFramePayload } from "@/types/terminal";
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
  getRdpScancode,
} from "./BaseGraphicSessionView";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

/**
 * RemoteDesktopView 组件
 */
export function RemoteDesktopViewClass(props: BaseSessionViewProps) {
  const { t } = useI18n();
  const { paneId, sessionId } = props;

  // 图形化会话状态
  const {
    canvasRef,
    containerRef,
    frameSize,
    setFrameSize,
    notifyVisualReady,
    renderBlobFrame,
  } = useBaseGraphicSessionView(props);

  // RDP 特有状态
  const { sessions } = useTabsStore();
  const hasBackgroundImage = useSettingsStore(
    (state) => state.backgroundImageEnabled && !!state.backgroundImage,
  );
  const activeSession = sessions.find((session) => session.id === sessionId);
  const connector = activeSession?.connector?.protocol === "rdp" ? activeSession.connector : null;
  const backend = connector?.backend ?? activeSession?.config?.rdpConfig?.backend ?? "freerdp";
  const nativeConnector = activeSession && connector && backend === "msrdpax"
    ? connector as INativeRdpConnector
    : null;
  const canvasConnector = connector && backend !== "msrdpax" ? connector as IRdpConnector : null;

  const resizeTimerRef = useRef<number | null>(null);
  const frameSizeRef = useRef(frameSize);
  const pendingFrameRef = useRef<RdpFramePayload | null>(null);
  const decodeInFlightRef = useRef(false);
  const drawTokenRef = useRef(0);
  const visualReadyNotifiedRef = useRef(false);
  const notifyVisualReadyRef = useRef(notifyVisualReady);
  const reconnectSession = useTabsStore((state) => state.reconnectSession);

  useEffect(() => {
    notifyVisualReadyRef.current = notifyVisualReady;
  }, [notifyVisualReady]);

  useEffect(() => {
    frameSizeRef.current = frameSize;
  }, [frameSize]);

  const markVisualReady = useCallback(() => {
    if (visualReadyNotifiedRef.current) return;
    visualReadyNotifiedRef.current = true;
    notifyVisualReadyRef.current();
  }, []);

  // Canvas RDP 帧处理
  useEffect(() => {
    if (!canvasConnector) {
      return;
    }

    let disposed = false;
    const cleanupCanvas = canvasRef.current;

    const drawFrame = async () => {
      if (decodeInFlightRef.current || disposed) {
        return;
      }

      const frame = pendingFrameRef.current;
      const canvas = canvasRef.current;
      if (!frame || !canvas) {
        return;
      }

      decodeInFlightRef.current = true;
      const drawToken = ++drawTokenRef.current;

      try {
        let success = false;

        if (canvas.width !== frame.desktopWidth || canvas.height !== frame.desktopHeight) {
          canvas.width = frame.desktopWidth;
          canvas.height = frame.desktopHeight;
        }

        if (frame.encoding === "rgba") {
          const rgbaBytes = new Uint8Array(frame.imageBytes);
          const expectedLength = frame.regionWidth * frame.regionHeight * 4;
          if (rgbaBytes.length !== expectedLength) {
            throw new Error(`Unexpected RGBA frame size: ${rgbaBytes.length} !== ${expectedLength}`);
          }

          if (disposed || drawToken !== drawTokenRef.current) {
            return;
          }

          const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
          if (!context) {
            return;
          }

          context.imageSmoothingEnabled = false;
          context.putImageData(
            new ImageData(new Uint8ClampedArray(rgbaBytes), frame.regionWidth, frame.regionHeight),
            frame.regionLeft,
            frame.regionTop,
          );
          success = true;
          if (success) markVisualReady();
        } else {
          const blob = new Blob([frame.imageBytes], { type: "image/jpeg" });
          if (frame.fullFrame) {
            success = await renderBlobFrame(canvas, blob, frame.desktopWidth, frame.desktopHeight, {
              isCurrent: () => !disposed && drawToken === drawTokenRef.current,
            });
          } else {
            const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
            if (!context) {
              return;
            }

            context.imageSmoothingEnabled = false;
            let decodedSource: CanvasImageSource;
            let decodedBitmap: ImageBitmap | null = null;

            try {
              if (typeof createImageBitmap === "function") {
                decodedBitmap = await createImageBitmap(blob);
                decodedSource = decodedBitmap;
              } else {
                decodedSource = await new Promise<HTMLImageElement>((resolve, reject) => {
                  const objectUrl = URL.createObjectURL(blob);
                  const image = new Image();
                  image.onload = () => {
                    URL.revokeObjectURL(objectUrl);
                    resolve(image);
                  };
                  image.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error("Image decode failed"));
                  };
                  image.src = objectUrl;
                });
              }

              if (disposed || drawToken !== drawTokenRef.current) {
                decodedBitmap?.close();
                return;
              }

              context.drawImage(
                decodedSource,
                frame.regionLeft,
                frame.regionTop,
                frame.regionWidth,
                frame.regionHeight,
              );
              decodedBitmap?.close();
              success = true;
            } catch (error) {
              decodedBitmap?.close();
              throw error;
            }
          }

          if (success) markVisualReady();
        }

        if (success) {
          setFrameSize((current) => (
            current?.width === frame.desktopWidth && current?.height === frame.desktopHeight
              ? current
              : { width: frame.desktopWidth, height: frame.desktopHeight }
          ));
        }
      } catch (error) {
        if (!disposed) {
          logger.error("FE/terminal-view/rdp", "Canvas decode failed", { error });
        }
      } finally {
        decodeInFlightRef.current = false;
        if (!disposed && pendingFrameRef.current !== frame) {
          void drawFrame();
        }
      }
    };

    canvasConnector.onFrame((nextFrame) => {
      pendingFrameRef.current = nextFrame;
      void drawFrame();
    }).then(() => {
      if (!disposed) {
        canvasConnector.requestFrame();
      }
    }).catch((error) => {
      if (canvasConnector.isConnected) {
        logger.error("FE/terminal-view/rdp", "Register frame listener failed", { error });
      }
    });

    return () => {
      disposed = true;
      pendingFrameRef.current = null;
      decodeInFlightRef.current = false;
      visualReadyNotifiedRef.current = false;
      setFrameSize(null);
      if (cleanupCanvas) {
        const context = cleanupCanvas.getContext("2d");
        context?.clearRect(0, 0, cleanupCanvas.width, cleanupCanvas.height);
      }
      canvasConnector.releaseInputs();
    };
  }, [canvasConnector, markVisualReady, renderBlobFrame, setFrameSize, canvasRef]);

  // 重置视觉就绪状态
  useEffect(() => {
    visualReadyNotifiedRef.current = false;
  }, [activeSession?.id]);

  // Native RDP 状态处理
  useEffect(() => {
    if (!nativeConnector) {
      return;
    }

    let disposed = false;

    nativeConnector.onState((payload) => {
      if (disposed) {
        return;
      }

      if (["visible", "focused", "connected"].includes(payload.state)) {
        markVisualReady();
      }

    }).catch((error) => {
      if (!disposed) {
        logger.error("FE/terminal-view/native-rdp", "Register native state listener failed", { error });
      }
    });

    return () => {
      disposed = true;
    };
  }, [markVisualReady, nativeConnector]);

  // 自动调整大小
  useEffect(() => {
    const container = containerRef.current;
    if (!canvasConnector || backend === "freerdp" || !container || !(activeSession?.config?.rdpConfig?.autoResize ?? true)) {
      return;
    }

    let lastObservedSize: { width: number; height: number } | null = null;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const observedWidth = Math.floor(entry.contentRect.width);
      const observedHeight = Math.floor(entry.contentRect.height);
      if (observedWidth <= 0 || observedHeight <= 0) {
        return;
      }

      if (!lastObservedSize) {
        lastObservedSize = { width: observedWidth, height: observedHeight };
        return;
      }

      if (observedWidth === lastObservedSize.width && observedHeight === lastObservedSize.height) {
        return;
      }
      lastObservedSize = { width: observedWidth, height: observedHeight };

      const currentFrameSize = frameSizeRef.current;
      if (!currentFrameSize) {
        return;
      }

      const nextWidth = Math.max(200, observedWidth);
      const nextHeight = Math.max(200, observedHeight);

      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }

      if (nextWidth === currentFrameSize.width && nextHeight === currentFrameSize.height) {
        return;
      }

      resizeTimerRef.current = window.setTimeout(() => {
        canvasConnector.resize(nextWidth, nextHeight);
        resizeTimerRef.current = null;
      }, 250);
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [activeSession?.config?.rdpConfig?.autoResize, backend, canvasConnector, containerRef]);

  // Native RDP 渲染
  if (activeSession && nativeConnector) {
    const hostLabel = activeSession.config?.rdpConfig?.host && activeSession.config.rdpConfig.port
      ? `${activeSession.config.rdpConfig.host}:${activeSession.config.rdpConfig.port}`
      : activeSession.title;

    return (
      <div className="relative h-full min-h-0 w-full min-w-0" data-view-type="rdp-native">
        <NativeRdpHostView
          sessionId={activeSession.id}
          hostLabel={hostLabel}
          connector={nativeConnector}
          onVisualReady={markVisualReady}
        />
      </div>
    );
  }

  if (!activeSession || !canvasConnector) {
    return null;
  }

  // 鼠标事件处理
  const handlePointer = (event: React.MouseEvent<HTMLDivElement>, kind: "move" | "down" | "up") => {
    if (!frameSize || !containerRef.current) {
      return;
    }

    const point = getPointerPositionCentered(
      containerRef.current,
      {
        desktopWidth: frameSize.width,
        desktopHeight: frameSize.height,
      },
      event.clientX,
      event.clientY,
    );

    canvasConnector.sendPointer({
      kind,
      x: point.x,
      y: point.y,
      button: event.button,
    });
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    if (!frameSize || !containerRef.current) {
      return;
    }

    const point = getPointerPositionCentered(
      containerRef.current,
      {
        desktopWidth: frameSize.width,
        desktopHeight: frameSize.height,
      },
      event.clientX,
      event.clientY,
    );

    canvasConnector.sendPointer({
      kind: "wheel",
      x: point.x,
      y: point.y,
      deltaX: Math.round(event.deltaX),
      deltaY: Math.round(event.deltaY),
    });
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>, down: boolean) => {
    const scancode = getRdpScancode(event);
    if (!scancode) {
      return;
    }

    event.preventDefault();
    canvasConnector.sendKey({ scancode, down });
  };

  // 渲染内容
  return (
    <main
      className={cn(VIEW_CONTAINER_CLASSNAME, "bg-(--terminal-shell)")}
      style={{ backgroundColor: hasBackgroundImage ? "transparent" : undefined }}
      data-view-type="rdp"
      data-session-id={sessionId}
      data-pane-id={paneId}
    >
      <div
        ref={containerRef}
        className={INTERACTIVE_CONTAINER_CLASSNAME}
        tabIndex={0}
        onClick={(event) => event.currentTarget.focus()}
        onMouseMove={(event) => handlePointer(event, "move")}
        onMouseDown={(event) => handlePointer(event, "down")}
        onMouseUp={(event) => handlePointer(event, "up")}
        onWheel={handleWheel}
        onKeyDown={(event) => handleKey(event, true)}
        onKeyUp={(event) => handleKey(event, false)}
        onBlur={() => canvasConnector.releaseInputs()}
      >
        <canvas
          ref={canvasRef}
          className={frameSize ? CANVAS_CLASSNAME : HIDDEN_CLASSNAME}
        />

        <ConnectionStatusOverlay
          status={activeSession.connectionStatus}
          protocol="Windows"
          target={activeSession.config?.rdpConfig?.host
            ? `${activeSession.config.rdpConfig.host}:${activeSession.config.rdpConfig.port || 3389}`
            : activeSession.title}
          details={[
            { label: t("验证凭据"), value: activeSession.config?.rdpConfig?.username || t("交互式登录") }
          ]}
          onReconnect={() => reconnectSession(activeSession.id)}
        />

      </div>
    </main>
  );
}
