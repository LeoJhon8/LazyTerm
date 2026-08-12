import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import { NativeRdpHostView } from "@/components/terminal/NativeRdpHostView";
import type { INativeRdpConnector, IRdpConnector, RdpFramePayload } from "@/types/terminal";
import {
  type BaseSessionViewProps,
  VIEW_CONTAINER_CLASSNAME,
  HIDDEN_CLASSNAME,
  clamp,
} from "./BaseSessionView";
import { ConnectionStatusOverlay } from "./ConnectionStatusOverlay";
import {
  useBaseGraphicSessionView,
  getPointerPositionScaled,
  getRdpScancode,
} from "./BaseGraphicSessionView";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const RDP_SCROLLBAR_SIZE = 16;
const RDP_SCROLLBAR_REVEAL_DISTANCE = 32;
const RDP_SCROLLBAR_KEEP_VISIBLE_DISTANCE = 56;

interface RdpScrollMetrics {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  left: number;
  top: number;
  maxLeft: number;
  maxTop: number;
}

const EMPTY_SCROLL_METRICS: RdpScrollMetrics = {
  viewportWidth: 0,
  viewportHeight: 0,
  contentWidth: 0,
  contentHeight: 0,
  left: 0,
  top: 0,
  maxLeft: 0,
  maxTop: 0,
};

/**
 * RemoteDesktopView 组件
 */
export function RemoteDesktopViewClass(props: BaseSessionViewProps) {
  const { t } = useI18n();
  const { paneId, sessionId, isVisible = true } = props;

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
  const activeSession = sessions.find((session) => session.id === sessionId);
  const connector = activeSession?.connector?.protocol === "rdp" ? activeSession.connector : null;
  const backend = connector?.backend ?? activeSession?.config?.rdpConfig?.backend ?? "freerdp";
  const nativeConnector = activeSession && connector && backend === "msrdpax"
    ? connector as INativeRdpConnector
    : null;
  const canvasConnector = connector && backend !== "msrdpax" ? connector as IRdpConnector : null;

  const pendingFrameRef = useRef<RdpFramePayload | null>(null);
  const decodeInFlightRef = useRef(false);
  const drawTokenRef = useRef(0);
  const visualReadyNotifiedRef = useRef(false);
  const notifyVisualReadyRef = useRef(notifyVisualReady);
  const [scrollMetrics, setScrollMetrics] = useState<RdpScrollMetrics>(EMPTY_SCROLL_METRICS);
  const [visibleScrollbars, setVisibleScrollbars] = useState({ horizontal: false, vertical: false });
  const [draggingScrollbar, setDraggingScrollbar] = useState<"horizontal" | "vertical" | null>(null);
  const reconnectSession = useTabsStore((state) => state.reconnectSession);

  useEffect(() => {
    notifyVisualReadyRef.current = notifyVisualReady;
  }, [notifyVisualReady]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!canvasConnector || !container) {
      return;
    }

    const publishInitialViewport = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvasConnector.setInitialViewportSize(rect.width, rect.height);
      }
    };

    publishInitialViewport();
    const observer = new ResizeObserver(publishInitialViewport);
    observer.observe(container);
    return () => observer.disconnect();
  }, [canvasConnector, containerRef]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!canvasConnector || !container) {
      setScrollMetrics(EMPTY_SCROLL_METRICS);
      return;
    }

    const updateMetrics = () => {
      const viewportWidth = container.clientWidth;
      const viewportHeight = container.clientHeight;
      const contentWidth = frameSize?.width ?? 0;
      const contentHeight = frameSize?.height ?? 0;
      const maxLeft = Math.max(0, contentWidth - viewportWidth);
      const maxTop = Math.max(0, contentHeight - viewportHeight);
      const left = Math.min(container.scrollLeft, maxLeft);
      const top = Math.min(container.scrollTop, maxTop);

      if (container.scrollLeft !== left) {
        container.scrollLeft = left;
      }
      if (container.scrollTop !== top) {
        container.scrollTop = top;
      }

      setScrollMetrics((current) => {
        const next = {
          viewportWidth,
          viewportHeight,
          contentWidth,
          contentHeight,
          left,
          top,
          maxLeft,
          maxTop,
        };
        return Object.keys(next).every(
          (key) => current[key as keyof RdpScrollMetrics] === next[key as keyof RdpScrollMetrics],
        ) ? current : next;
      });
    };

    updateMetrics();
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(container);
    container.addEventListener("scroll", updateMetrics, { passive: true });
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", updateMetrics);
    };
  }, [canvasConnector, containerRef, frameSize]);

  useEffect(() => {
    setVisibleScrollbars((current) => ({
      horizontal: scrollMetrics.maxLeft > 0 && current.horizontal,
      vertical: scrollMetrics.maxTop > 0 && current.vertical,
    }));
  }, [scrollMetrics.maxLeft, scrollMetrics.maxTop]);

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
          isVisible={isVisible}
          onVisualReady={markVisualReady}
        />
      </div>
    );
  }

  if (!activeSession || !canvasConnector) {
    return null;
  }

  const resolvePointerPosition = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!frameSize || !canvas) {
      return null;
    }

    const bounds = canvas.getBoundingClientRect();
    if (
      clientX < bounds.left
      || clientX >= bounds.right
      || clientY < bounds.top
      || clientY >= bounds.bottom
    ) {
      return null;
    }

    return getPointerPositionScaled(
      canvas,
      {
        desktopWidth: frameSize.width,
        desktopHeight: frameSize.height,
      },
      clientX,
      clientY,
    );
  };

  // 鼠标事件处理
  const handlePointer = (event: React.MouseEvent<HTMLDivElement>, kind: "move" | "down" | "up") => {
    const point = resolvePointerPosition(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    canvasConnector.sendPointer({
      kind,
      x: point.x,
      y: point.y,
      button: event.button,
    });
  };

  const updateScrollbarVisibility = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container || draggingScrollbar) {
      return;
    }

    const bounds = container.getBoundingClientRect();
    const cursorInside = clientX >= bounds.left
      && clientX <= bounds.right
      && clientY >= bounds.top
      && clientY <= bounds.bottom;
    setVisibleScrollbars((current) => {
      const horizontalDistance = current.horizontal
        ? RDP_SCROLLBAR_KEEP_VISIBLE_DISTANCE
        : RDP_SCROLLBAR_REVEAL_DISTANCE;
      const verticalDistance = current.vertical
        ? RDP_SCROLLBAR_KEEP_VISIBLE_DISTANCE
        : RDP_SCROLLBAR_REVEAL_DISTANCE;
      return {
        horizontal: scrollMetrics.maxLeft > 0
          && cursorInside
          && clientY >= bounds.bottom - horizontalDistance,
        vertical: scrollMetrics.maxTop > 0
          && cursorInside
          && clientX >= bounds.right - verticalDistance,
      };
    });
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const point = resolvePointerPosition(event.clientX, event.clientY);
    if (!point) {
      return;
    }

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
      className={cn(VIEW_CONTAINER_CLASSNAME, "bg-black")}
      data-view-type="rdp"
      data-session-id={sessionId}
      data-pane-id={paneId}
      onMouseMove={(event) => updateScrollbarVisibility(event.clientX, event.clientY)}
      onMouseLeave={() => {
        if (!draggingScrollbar) {
          setVisibleScrollbars({ horizontal: false, vertical: false });
        }
      }}
    >
      <div
        ref={containerRef}
        className="no-scrollbar relative h-full w-full overflow-auto outline-none"
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
        <div className="flex h-max min-h-full w-max min-w-full items-center justify-center">
          <canvas
            ref={canvasRef}
            className={frameSize ? "block shrink-0 select-none" : HIDDEN_CLASSNAME}
            style={frameSize ? { width: frameSize.width, height: frameSize.height } : undefined}
          />
        </div>
      </div>

      <RdpOverlayScrollbars
        containerRef={containerRef}
        metrics={scrollMetrics}
        visible={visibleScrollbars}
        onDraggingChange={(axis) => {
          setDraggingScrollbar(axis);
          if (axis) {
            setVisibleScrollbars((current) => ({
              horizontal: current.horizontal || axis === "horizontal",
              vertical: current.vertical || axis === "vertical",
            }));
          }
        }}
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
    </main>
  );
}

interface RdpOverlayScrollbarsProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  metrics: RdpScrollMetrics;
  visible: { horizontal: boolean; vertical: boolean };
  onDraggingChange: (axis: "horizontal" | "vertical" | null) => void;
}

interface ScrollbarDragState {
  axis: "horizontal" | "vertical";
  pointerId: number;
  pointerStart: number;
  scrollStart: number;
  trackLength: number;
  thumbLength: number;
  maximum: number;
}

function RdpOverlayScrollbars({
  containerRef,
  metrics,
  visible,
  onDraggingChange,
}: RdpOverlayScrollbarsProps) {
  const dragRef = useRef<ScrollbarDragState | null>(null);
  const horizontalOverflow = metrics.maxLeft > 0;
  const verticalOverflow = metrics.maxTop > 0;
  const horizontalTrackLength = Math.max(
    0,
    metrics.viewportWidth - (verticalOverflow ? RDP_SCROLLBAR_SIZE : 0),
  );
  const verticalTrackLength = Math.max(
    0,
    metrics.viewportHeight - (horizontalOverflow ? RDP_SCROLLBAR_SIZE : 0),
  );
  const horizontalThumbLength = getScrollbarThumbLength(
    horizontalTrackLength,
    metrics.viewportWidth,
    metrics.contentWidth,
  );
  const verticalThumbLength = getScrollbarThumbLength(
    verticalTrackLength,
    metrics.viewportHeight,
    metrics.contentHeight,
  );
  const horizontalThumbOffset = getScrollbarThumbOffset(
    horizontalTrackLength,
    horizontalThumbLength,
    metrics.left,
    metrics.maxLeft,
  );
  const verticalThumbOffset = getScrollbarThumbOffset(
    verticalTrackLength,
    verticalThumbLength,
    metrics.top,
    metrics.maxTop,
  );

  const setScrollOffset = (axis: "horizontal" | "vertical", value: number) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    if (axis === "horizontal") {
      container.scrollLeft = Math.round(clamp(value, 0, metrics.maxLeft));
    } else {
      container.scrollTop = Math.round(clamp(value, 0, metrics.maxTop));
    }
  };

  const beginDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    axis: "horizontal" | "vertical",
    trackLength: number,
    thumbLength: number,
    maximum: number,
    scrollStart: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      axis,
      pointerId: event.pointerId,
      pointerStart: axis === "horizontal" ? event.clientX : event.clientY,
      scrollStart,
      trackLength,
      thumbLength,
      maximum,
    };
    onDraggingChange(axis);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const pointer = drag.axis === "horizontal" ? event.clientX : event.clientY;
    const availableTrack = Math.max(1, drag.trackLength - drag.thumbLength);
    setScrollOffset(
      drag.axis,
      drag.scrollStart + (pointer - drag.pointerStart) * drag.maximum / availableTrack,
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    onDraggingChange(null);
  };

  const pageScroll = (
    event: React.PointerEvent<HTMLDivElement>,
    axis: "horizontal" | "vertical",
    thumbOffset: number,
    thumbLength: number,
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = axis === "horizontal"
      ? event.clientX - bounds.left
      : event.clientY - bounds.top;
    const current = axis === "horizontal" ? metrics.left : metrics.top;
    const page = axis === "horizontal" ? metrics.viewportWidth : metrics.viewportHeight;
    setScrollOffset(axis, current + (pointer < thumbOffset ? -page : pointer > thumbOffset + thumbLength ? page : 0));
  };

  return (
    <>
      {horizontalOverflow && visible.horizontal && (
        <div
          className="absolute bottom-0 left-0 z-20 bg-background/75 backdrop-blur-sm"
          style={{ width: horizontalTrackLength, height: RDP_SCROLLBAR_SIZE }}
          onPointerDown={(event) => pageScroll(event, "horizontal", horizontalThumbOffset, horizontalThumbLength)}
        >
          <div
            role="scrollbar"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={metrics.maxLeft}
            aria-valuenow={metrics.left}
            className="absolute top-0.5 h-3 cursor-default rounded-sm bg-muted-foreground/65 hover:bg-muted-foreground/85"
            style={{ left: horizontalThumbOffset, width: horizontalThumbLength }}
            onPointerDown={(event) => beginDrag(
              event,
              "horizontal",
              horizontalTrackLength,
              horizontalThumbLength,
              metrics.maxLeft,
              metrics.left,
            )}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      )}

      {verticalOverflow && visible.vertical && (
        <div
          className="absolute right-0 top-0 z-20 bg-background/75 backdrop-blur-sm"
          style={{ width: RDP_SCROLLBAR_SIZE, height: verticalTrackLength }}
          onPointerDown={(event) => pageScroll(event, "vertical", verticalThumbOffset, verticalThumbLength)}
        >
          <div
            role="scrollbar"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={metrics.maxTop}
            aria-valuenow={metrics.top}
            className="absolute left-0.5 w-3 cursor-default rounded-sm bg-muted-foreground/65 hover:bg-muted-foreground/85"
            style={{ top: verticalThumbOffset, height: verticalThumbLength }}
            onPointerDown={(event) => beginDrag(
              event,
              "vertical",
              verticalTrackLength,
              verticalThumbLength,
              metrics.maxTop,
              metrics.top,
            )}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      )}

      {horizontalOverflow && verticalOverflow && visible.horizontal && visible.vertical && (
        <div
          className="absolute bottom-0 right-0 z-20 bg-background/85"
          style={{ width: RDP_SCROLLBAR_SIZE, height: RDP_SCROLLBAR_SIZE }}
        />
      )}
    </>
  );
}

function getScrollbarThumbLength(trackLength: number, viewportSize: number, contentSize: number): number {
  if (trackLength <= 0 || viewportSize <= 0 || contentSize <= viewportSize) {
    return trackLength;
  }
  return Math.min(trackLength, Math.max(24, trackLength * viewportSize / contentSize));
}

function getScrollbarThumbOffset(
  trackLength: number,
  thumbLength: number,
  value: number,
  maximum: number,
): number {
  if (maximum <= 0) {
    return 0;
  }
  return (trackLength - thumbLength) * value / maximum;
}
