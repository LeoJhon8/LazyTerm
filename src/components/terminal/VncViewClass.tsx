import { useEffect, useRef, useState, useCallback } from "react";
import { Monitor } from "lucide-react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import type { IVncConnector, VncFramePayload } from "@/types/terminal";
import {
  type BaseSessionViewProps,
  useBaseSessionView,
  ConnectionStatusBadge,
  DisconnectedBanner,
  LoadingPlaceholder,
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

/**
 * 检查是否为完整快照
 */
function isCompleteSnapshot(frame: VncFramePayload) {
  return frame.fullFrame
    && frame.regionLeft === 0
    && frame.regionTop === 0
    && frame.regionWidth === frame.desktopWidth
    && frame.regionHeight === frame.desktopHeight;
}

/**
 * VncView 组件
 * 继承 BaseGraphicSessionView 的图形化视图抽象子类
 */
export function VncViewClass(props: BaseSessionViewProps) {
  const { paneId, sessionId } = props;

  // 基础会话状态
  const { setConnected } = useBaseSessionView(props);

  // 图形化会话状态
  const {
    canvasRef,
    containerRef,
    frameSize,
    setFrameSize,
    notifyVisualReady,
    renderRgbaFrame,
    renderBlobFrame,
  } = useBaseGraphicSessionView(props);

  // VNC 特有状态
  const { sessions } = useTabsStore();
  const activeSession = sessions.find((session) => session.id === sessionId);
  const connector = activeSession?.connector?.protocol === "vnc" ? activeSession.connector as IVncConnector : null;

  const pointerMaskRef = useRef(0);
  const pointerTargetRef = useRef<number | null>(null);
  const [cursorStyle, setCursorStyle] = useState("default");

  // VNC 帧处理
  useEffect(() => {
    if (!connector) {
      return;
    }

    let disposed = false;
    const cleanupCanvas = canvasRef.current;
    let paintToken = 0;

    const paintSnapshot = async (frame: VncFramePayload) => {
      if (!isCompleteSnapshot(frame) || disposed) {
        return;
      }

      if (frame.encoding !== "rgba" && frame.encoding !== "png") {
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const currentToken = ++paintToken;

      try {
        let success = false;

        if (frame.encoding === "rgba") {
          const rgbaBytes = new Uint8Array(frame.imageBytes);
          success = renderRgbaFrame(canvas, rgbaBytes, frame.desktopWidth, frame.desktopHeight);
        } else {
          const mime = frame.encoding === "png" ? "image/png" : "image/jpeg";
          const blob = new Blob([frame.imageBytes], { type: mime });

          success = await renderBlobFrame(canvas, blob, frame.desktopWidth, frame.desktopHeight, {
            disposed,
            token: currentToken,
            currentToken: paintToken,
          });
        }

        if (success && !disposed && currentToken === paintToken) {
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
      }
    };

    connector.onFrame((nextFrame) => {
      void paintSnapshot(nextFrame);
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
      setConnected(false);
    });

    return () => {
      disposed = true;
      paintToken += 1;
      disposeClose();
      pointerMaskRef.current = 0;
      pointerTargetRef.current = null;
      setFrameSize(null);
      setCursorStyle("default");
      if (cleanupCanvas) {
        const context = cleanupCanvas.getContext("2d");
        context?.clearRect(0, 0, cleanupCanvas.width, cleanupCanvas.height);
      }
    };
  }, [connector, notifyVisualReady, renderBlobFrame, renderRgbaFrame, setConnected, setFrameSize, canvasRef]);

  // 重置指针状态
  useEffect(() => {
    pointerMaskRef.current = 0;
    pointerTargetRef.current = null;
    setCursorStyle("default");
  }, [activeSession?.id]);

  if (!activeSession || !connector) {
    return null;
  }

  const isViewOnly = activeSession.config?.vncConfig?.viewOnly ?? false;

  // 指针事件处理
  const emitPointer = (clientX: number, clientY: number, buttonMask: number) => {
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

    connector.sendPointer({
      x: point.x,
      y: point.y,
      buttonMask,
    });
  };

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
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isViewOnly) return;

    pointerTargetRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bit = buttonBit(event.button);
    pointerMaskRef.current |= bit;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isViewOnly) return;

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
    if (isViewOnly) return;

    const wheelMask = event.deltaY < 0 ? 8 : 16;
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current | wheelMask);
    emitPointer(event.clientX, event.clientY, pointerMaskRef.current);
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (isViewOnly) return;

    const keySym = mapVncKeyboardEvent(event);
    if (keySym === null) return;

    event.preventDefault();
    connector.sendKey({ keySym, down });
  };

  // 渲染内容
  return (
    <main
      className={cn(VIEW_CONTAINER_CLASSNAME, "bg-black")}
      data-view-type="vnc"
      data-session-id={sessionId}
      data-pane-id={paneId}
    >
      <div
        ref={containerRef}
        className={INTERACTIVE_CONTAINER_CLASSNAME}
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
          className={frameSize ? CANVAS_CLASSNAME : HIDDEN_CLASSNAME}
        />

        {!frameSize ? (
          <LoadingPlaceholder
            icon={<Monitor className="h-10 w-10 text-emerald-300" />}
            title="正在连接 VNC 桌面"
            description="首次握手和首帧解码可能需要几秒。连接建立后，鼠标与键盘输入会直接发送到远端桌面。"
          />
        ) : null}

        <ConnectionStatusBadge
          title={activeSession.title}
          connected={true}
          extraInfo={
            <>
              {frameSize ? <span>{frameSize.width} x {frameSize.height}</span> : null}
              {isViewOnly ? <span>只读</span> : null}
            </>
          }
        />

        {!connector.isConnected ? (
          <DisconnectedBanner message="VNC 连接已断开，关闭标签或重新发起连接以恢复。" />
        ) : null}
      </div>
    </main>
  );
}
