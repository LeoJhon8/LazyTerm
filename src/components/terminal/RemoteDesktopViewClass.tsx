import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import { NativeRdpHostView } from "@/components/terminal/NativeRdpHostView";
import type { INativeRdpConnector, IRdpConnector, RdpFramePayload } from "@/types/terminal";
import {
  type BaseSessionViewProps,
  GraphicalSessionOverlay,
  TransitionMask,
  VIEW_CONTAINER_CLASSNAME,
  CANVAS_CLASSNAME,
  HIDDEN_CLASSNAME,
  INTERACTIVE_CONTAINER_CLASSNAME,
} from "./BaseSessionView";
import {
  useBaseGraphicSessionView,
  getPointerPositionCentered,
  getRdpScancode,
} from "./BaseGraphicSessionView";
import { cn } from "@/lib/utils";

/**
 * RemoteDesktopView 组件
 * 继承 BaseGraphicSessionView 的图形化视图抽象子类
 */
export function RemoteDesktopViewClass(props: BaseSessionViewProps) {
  const { paneId, sessionId } = props;

  // 图形化会话状态
  const {
    canvasRef,
    containerRef,
    frameSize,
    setFrameSize,
    setConnected,
    notifyVisualReady,
    renderRgbaFrame,
    renderBlobFrame,
  } = useBaseGraphicSessionView(props);

  // RDP 特有状态
  const { sessions } = useTabsStore();
  const activeSession = sessions.find((session) => session.id === sessionId);
  const backend = activeSession?.config?.rdpConfig?.backend ?? "ironrdp";
  const connector = activeSession?.connector?.protocol === "rdp" ? activeSession.connector : null;
  const nativeConnector = activeSession && connector && backend === "msrdpax"
    ? connector as INativeRdpConnector
    : null;
  const ironConnector = connector && backend !== "msrdpax" ? connector as IRdpConnector : null;

  const resizeTimerRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<RdpFramePayload | null>(null);
  const decodeInFlightRef = useRef(false);
  const drawTokenRef = useRef(0);
  const everConnectedRef = useRef(false);
  const [isClosed, setIsClosed] = useState(false);
  const [transitionMaskVisible, setTransitionMaskVisible] = useState(true);
  const [resizeMaskVisible, setResizeMaskVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const reconnectSession = useTabsStore((state) => state.reconnectSession);

  const markVisualReady = useCallback(() => {
    if (!transitionMaskVisible) return;
    setTransitionMaskVisible(false);
    notifyVisualReady();
  }, [transitionMaskVisible, notifyVisualReady]);

  // IronRDP 帧处理
  useEffect(() => {
    if (!ironConnector) {
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

        if (frame.encoding === "rgba") {
          const rgbaBytes = new Uint8Array(frame.imageBytes);
          const expectedLength = frame.desktopWidth * frame.desktopHeight * 4;
          if (rgbaBytes.length !== expectedLength) {
            throw new Error(`Unexpected RGBA frame size: ${rgbaBytes.length} !== ${expectedLength}`);
          }

          if (disposed || drawToken !== drawTokenRef.current) {
            return;
          }

          success = renderRgbaFrame(canvas, rgbaBytes, frame.desktopWidth, frame.desktopHeight);
          if (success) markVisualReady();
        } else {
          const blob = new Blob([frame.imageBytes], { type: "image/jpeg" });

          success = await renderBlobFrame(canvas, blob, frame.desktopWidth, frame.desktopHeight, {
            disposed,
            token: drawToken,
            currentToken: drawTokenRef.current,
          });

          if (success) markVisualReady();
        }

        if (success) {
          setFrameSize({
            width: frame.desktopWidth,
            height: frame.desktopHeight,
          });
          setConnected(true);
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

    ironConnector.onFrame((nextFrame) => {
      everConnectedRef.current = true;
      pendingFrameRef.current = nextFrame;
      void drawFrame();
      setConnected(true);
    }).catch((error) => {
      if (ironConnector.isConnected) {
        logger.error("FE/terminal-view/rdp", "Register frame listener failed", { error });
      }
    });

    const disposeClose = ironConnector.onClose(() => {
      setIsClosed(true);
      setConnected(false);
    });

    return () => {
      disposed = true;
      disposeClose();
      pendingFrameRef.current = null;
      decodeInFlightRef.current = false;
      setTransitionMaskVisible(true);
      setFrameSize(null);
      if (cleanupCanvas) {
        const context = cleanupCanvas.getContext("2d");
        context?.clearRect(0, 0, cleanupCanvas.width, cleanupCanvas.height);
      }
      ironConnector.releaseInputs();
    };
  }, [activeSession, ironConnector, markVisualReady, notifyVisualReady, renderBlobFrame, renderRgbaFrame, setConnected, setFrameSize, canvasRef]);

  // 重置视觉就绪状态
  useEffect(() => {
    setTransitionMaskVisible(true);
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

      if (payload.state === "disconnected" || payload.state === "closed" || payload.state === "error") {
        setConnected(false);
      }
    }).catch((error) => {
      if (!disposed) {
        logger.error("FE/terminal-view/native-rdp", "Register native state listener failed", { error });
      }
    });

    const disposeClose = nativeConnector.onClose(() => {
      setConnected(false);
    });

    return () => {
      disposed = true;
      disposeClose();
    };
  }, [markVisualReady, nativeConnector, setConnected]);

  // 自动调整大小
  useEffect(() => {
    if (!ironConnector || !containerRef.current || !frameSize || !(activeSession?.config?.rdpConfig?.autoResize ?? true)) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(200, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(200, Math.floor(entry.contentRect.height));

      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
      }

      setResizeMaskVisible(true);
      if ((resizeObserver as any)._maskTimer) {
        window.clearTimeout((resizeObserver as any)._maskTimer);
      }
      (resizeObserver as any)._maskTimer = window.setTimeout(() => {
        setResizeMaskVisible(false);
      }, 2000);

      resizeTimerRef.current = window.setTimeout(() => {
        ironConnector.resize(nextWidth, nextHeight);
      }, 250);
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if ((resizeObserver as any)._maskTimer) {
        window.clearTimeout((resizeObserver as any)._maskTimer);
      }
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [activeSession?.config?.rdpConfig?.autoResize, ironConnector, frameSize, containerRef]);

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

  if (!activeSession || !ironConnector) {
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

    ironConnector.sendPointer({
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

    ironConnector.sendPointer({
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
    ironConnector.sendKey({ scancode, down });
  };

  // 渲染内容
  return (
    <main
      className={cn(VIEW_CONTAINER_CLASSNAME, "bg-(--terminal-shell)")}
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
        onBlur={() => ironConnector.releaseInputs()}
      >
        <canvas
          ref={canvasRef}
          className={frameSize ? CANVAS_CLASSNAME : HIDDEN_CLASSNAME}
        />

        <GraphicalSessionOverlay
          mode={!ironConnector.isConnected 
            ? (isClosed ? (everConnectedRef.current ? "disconnected" : "failed") : "connecting") 
            : (!frameSize ? "connecting" : "none")}
          titleText={!ironConnector.isConnected 
            ? (isClosed ? (everConnectedRef.current ? "连接断开" : "连接失败") : "正在建立连接") 
            : "正在建立连接"}
          description={!ironConnector.isConnected
            ? (isClosed ? (everConnectedRef.current ? "与远程主机的连接已意外中止。" : "建立 RDP 连接失败，请检查配置信息或目标状态。") : "正在初始化连接...")
            : "正在尝试建立 RDP 连接并进行首帧解码..."}
          protocol="Windows"
          sessionConfigDetails={[
            { label: "目标地址", value: activeSession.config?.rdpConfig?.host ? `${activeSession.config.rdpConfig.host}:${activeSession.config.rdpConfig.port || 3389}` : activeSession.title },
            { label: "验证凭据", value: activeSession.config?.rdpConfig?.username || "交互式登录" }
          ]}
          onReconnect={() => {
            if (retrying) return;
            setRetrying(true);
            reconnectSession(activeSession.id);
          }}
          interactive={!ironConnector.isConnected}
          zIndexClass="z-30"
        />

        <TransitionMask
          visible={transitionMaskVisible || resizeMaskVisible}
          text={transitionMaskVisible ? "正在同步 Windows 远程桌面画面..." : "正在调整会话尺寸..."}
        />
      </div>
    </main>
  );
}
