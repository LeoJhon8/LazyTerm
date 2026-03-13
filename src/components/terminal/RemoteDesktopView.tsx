import { useEffect, useRef, useState } from "react";
import { Monitor, MousePointer2, RefreshCcw } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import type { IRdpConnector, RdpFramePayload } from "@/types/terminal";

const SCANCODE_MAP: Record<string, number> = {
  Escape: 0x01,
  Digit1: 0x02,
  Digit2: 0x03,
  Digit3: 0x04,
  Digit4: 0x05,
  Digit5: 0x06,
  Digit6: 0x07,
  Digit7: 0x08,
  Digit8: 0x09,
  Digit9: 0x0a,
  Digit0: 0x0b,
  Minus: 0x0c,
  Equal: 0x0d,
  Backspace: 0x0e,
  Tab: 0x0f,
  KeyQ: 0x10,
  KeyW: 0x11,
  KeyE: 0x12,
  KeyR: 0x13,
  KeyT: 0x14,
  KeyY: 0x15,
  KeyU: 0x16,
  KeyI: 0x17,
  KeyO: 0x18,
  KeyP: 0x19,
  BracketLeft: 0x1a,
  BracketRight: 0x1b,
  Enter: 0x1c,
  ControlLeft: 0x1d,
  KeyA: 0x1e,
  KeyS: 0x1f,
  KeyD: 0x20,
  KeyF: 0x21,
  KeyG: 0x22,
  KeyH: 0x23,
  KeyJ: 0x24,
  KeyK: 0x25,
  KeyL: 0x26,
  Semicolon: 0x27,
  Quote: 0x28,
  Backquote: 0x29,
  ShiftLeft: 0x2a,
  Backslash: 0x2b,
  KeyZ: 0x2c,
  KeyX: 0x2d,
  KeyC: 0x2e,
  KeyV: 0x2f,
  KeyB: 0x30,
  KeyN: 0x31,
  KeyM: 0x32,
  Comma: 0x33,
  Period: 0x34,
  Slash: 0x35,
  ShiftRight: 0x36,
  NumpadMultiply: 0x37,
  AltLeft: 0x38,
  Space: 0x39,
  CapsLock: 0x3a,
  F1: 0x3b,
  F2: 0x3c,
  F3: 0x3d,
  F4: 0x3e,
  F5: 0x3f,
  F6: 0x40,
  F7: 0x41,
  F8: 0x42,
  F9: 0x43,
  F10: 0x44,
  NumLock: 0x45,
  ScrollLock: 0x46,
  Numpad7: 0x47,
  Numpad8: 0x48,
  Numpad9: 0x49,
  NumpadSubtract: 0x4a,
  Numpad4: 0x4b,
  Numpad5: 0x4c,
  Numpad6: 0x4d,
  NumpadAdd: 0x4e,
  Numpad1: 0x4f,
  Numpad2: 0x50,
  Numpad3: 0x51,
  Numpad0: 0x52,
  NumpadDecimal: 0x53,
  IntlBackslash: 0x56,
  F11: 0x57,
  F12: 0x58,
  NumpadEnter: 0xe01c,
  ControlRight: 0xe01d,
  NumpadDivide: 0xe035,
  AltRight: 0xe038,
  Home: 0xe047,
  ArrowUp: 0xe048,
  PageUp: 0xe049,
  ArrowLeft: 0xe04b,
  ArrowRight: 0xe04d,
  End: 0xe04f,
  ArrowDown: 0xe050,
  PageDown: 0xe051,
  Insert: 0xe052,
  Delete: 0xe053,
  MetaLeft: 0xe05b,
  MetaRight: 0xe05c,
  ContextMenu: 0xe05d,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function base64ToUint8Array(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function getPointerPosition(
  container: HTMLDivElement,
  frame: Pick<RdpFramePayload, "width" | "height">,
  clientX: number,
  clientY: number,
) {
  const rect = container.getBoundingClientRect();
  const scale = Math.min(rect.width / frame.width, rect.height / frame.height);
  const displayWidth = frame.width * scale;
  const displayHeight = frame.height * scale;
  const offsetX = (rect.width - displayWidth) / 2;
  const offsetY = (rect.height - displayHeight) / 2;

  const x = (clientX - rect.left - offsetX) / scale;
  const y = (clientY - rect.top - offsetY) / scale;

  return {
    x: Math.round(clamp(x, 0, frame.width - 1)),
    y: Math.round(clamp(y, 0, frame.height - 1)),
  };
}

export function RemoteDesktopView() {
  const { activeSessionId, sessions } = useTabsStore();
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const connector = activeSession?.connector?.protocol === "rdp" ? activeSession.connector as IRdpConnector : null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<RdpFramePayload | null>(null);
  const decodeInFlightRef = useRef(false);
  const drawTokenRef = useRef(0);
  const [connected, setConnected] = useState(true);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (!connector) {
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
        const byteArray = base64ToUint8Array(frame.imageBase64);
        const blob = new Blob([byteArray], { type: frame.mimeType });
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

        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width;
          canvas.height = frame.height;
        }

        const context = canvas.getContext("2d", {
          alpha: false,
          desynchronized: true,
        });

        if (!context) {
          decodedBitmap?.close();
          return;
        }

        context.imageSmoothingEnabled = true;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(decodedSource, 0, 0, canvas.width, canvas.height);
        decodedBitmap?.close();
      } catch (error) {
        if (!disposed) {
          console.error("[RDP] Canvas decode failed:", error);
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
        if (current?.width === nextFrame.width && current.height === nextFrame.height) {
          return current;
        }

        return { width: nextFrame.width, height: nextFrame.height };
      });

      void drawFrame();

      setConnected(true);
    }).catch((error) => {
      if (connector.isConnected) {
        console.error("[RDP] Register frame listener failed:", error);
      }
    });

    const disposeClose = connector.onClose(() => {
      setConnected(false);
    });

    return () => {
      disposed = true;
      disposeClose();
      pendingFrameRef.current = null;
      decodeInFlightRef.current = false;
      setFrameSize(null);
      if (cleanupCanvas) {
        const context = cleanupCanvas.getContext("2d");
        context?.clearRect(0, 0, cleanupCanvas.width, cleanupCanvas.height);
      }
      connector.releaseInputs();
    };
  }, [connector]);

  useEffect(() => {
    if (!connector || !containerRef.current || !frameSize || !(activeSession?.config?.rdpConfig?.autoResize ?? true)) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(200, Math.floor(entry.contentRect.width));
      const nextHeight = Math.max(200, Math.floor(entry.contentRect.height));

      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
      }

      resizeTimerRef.current = window.setTimeout(() => {
        connector.resize(nextWidth, nextHeight);
      }, 250);
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [activeSession?.config?.rdpConfig?.autoResize, connector, frameSize]);

  if (!activeSession || !connector) {
    return null;
  }

  const handlePointer = (event: React.MouseEvent<HTMLDivElement>, kind: "move" | "down" | "up") => {
    if (!frameSize || !containerRef.current) {
      return;
    }

    const point = getPointerPosition(containerRef.current, frameSize, event.clientX, event.clientY);
    connector.sendPointer({
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

    const point = getPointerPosition(containerRef.current, frameSize, event.clientX, event.clientY);
    connector.sendPointer({
      kind: "wheel",
      x: point.x,
      y: point.y,
      deltaX: Math.round(event.deltaX),
      deltaY: Math.round(event.deltaY),
    });
  };

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>, down: boolean) => {
    const scancode = SCANCODE_MAP[event.code];
    if (!scancode) {
      return;
    }

    event.preventDefault();
    connector.sendKey({ scancode, down });
  };

  return (
    <main className="terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden border border-(--terminal-border) bg-black shadow-(--panel-shadow)">
      <div
        ref={containerRef}
        className="relative flex h-full w-full items-center justify-center overflow-hidden outline-none"
        tabIndex={0}
        onClick={(event) => event.currentTarget.focus()}
        onMouseMove={(event) => handlePointer(event, "move")}
        onMouseDown={(event) => handlePointer(event, "down")}
        onMouseUp={(event) => handlePointer(event, "up")}
        onWheel={handleWheel}
        onKeyDown={(event) => handleKey(event, true)}
        onKeyUp={(event) => handleKey(event, false)}
        onBlur={() => connector.releaseInputs()}
      >
        <canvas
          ref={canvasRef}
          className={frameSize ? "max-h-full max-w-full select-none object-contain" : "hidden"}
        />

        {!frameSize ? (
          <div className="flex max-w-md flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/6 px-8 py-10 text-center text-white/80">
            <Monitor className="h-10 w-10 text-sky-300" />
            <div>
              <div className="text-lg font-semibold text-white">正在连接远程桌面</div>
              <div className="mt-2 text-sm leading-6 text-white/60">首次握手和首帧解码可能需要几秒。连接建立后，鼠标与键盘输入会直接发送到远端主机。</div>
            </div>
          </div>
        ) : null}

        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-white/80 backdrop-blur-md">
          <MousePointer2 className="h-3.5 w-3.5" />
          <span>{activeSession.title}</span>
          {frameSize ? <span>{frameSize.width} x {frameSize.height}</span> : null}
        </div>

        {!connected ? (
          <div className="absolute inset-x-0 bottom-6 mx-auto flex w-fit items-center gap-2 rounded-full border border-amber-300/25 bg-amber-500/15 px-4 py-2 text-sm text-amber-100 backdrop-blur-md">
            <RefreshCcw className="h-4 w-4" />
            <span>远程桌面连接已断开，关闭标签或重新发起连接以恢复。</span>
          </div>
        ) : null}
      </div>
    </main>
  );
}