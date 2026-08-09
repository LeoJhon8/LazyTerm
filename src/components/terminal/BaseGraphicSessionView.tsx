import { useEffect, useRef, useState, useCallback } from "react";
import { logger } from "@/lib/logger";
import {
  type BaseSessionViewProps,
  clamp,
} from "./BaseSessionView";

/**
 * 图形化会话视图的通用 Hook 返回类型
 */
export interface BaseGraphicSessionViewResult {
  /** Canvas 引用 */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** 容器引用 */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 帧尺寸 */
  frameSize: { width: number; height: number } | null;
  /** 设置帧尺寸 */
  setFrameSize: React.Dispatch<React.SetStateAction<{ width: number; height: number } | null>>;
  /** 视觉就绪通知 */
  notifyVisualReady: () => void;
  /** 渲染 RGBA 帧到 Canvas */
  renderRgbaFrame: (canvas: HTMLCanvasElement, rgbaBytes: Uint8Array, width: number, height: number) => boolean;
  /** 渲染 Blob 帧到 Canvas（JPEG/PNG） */
  renderBlobFrame: (
    canvas: HTMLCanvasElement,
    blob: Blob,
    width: number,
    height: number,
    guard?: { isCurrent: () => boolean }
  ) => Promise<boolean>;
}

/**
 * 图形化会话视图的通用 Hook
 * 封装 Canvas 渲染、帧处理和视觉就绪通知的共享逻辑
 */
export function useBaseGraphicSessionView(
  props: BaseSessionViewProps
): BaseGraphicSessionViewResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const visualReadyNotifiedRef = useRef(false);

  /**
   * 通知视觉就绪（只触发一次）
   */
  const notifyVisualReady = useCallback(() => {
    if (!visualReadyNotifiedRef.current) {
      visualReadyNotifiedRef.current = true;
      props.onVisualReady?.(props.sessionId);
    }
  }, [props.onVisualReady, props.sessionId]);

  /**
   * 重置视觉就绪状态
   */
  const resetVisualReady = useCallback(() => {
    visualReadyNotifiedRef.current = false;
  }, []);

  /**
   * 渲染 RGBA 帧到 Canvas
   */
  const renderRgbaFrame = useCallback((
    canvas: HTMLCanvasElement,
    rgbaBytes: Uint8Array,
    width: number,
    height: number
  ): boolean => {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) return false;

    context.imageSmoothingEnabled = false;
    context.putImageData(new ImageData(new Uint8ClampedArray(rgbaBytes), width, height), 0, 0);
    return true;
  }, []);

  /**
   * 渲染 Blob 帧到 Canvas（支持 JPEG/PNG）
   */
  const renderBlobFrame = useCallback(async (
    canvas: HTMLCanvasElement,
    blob: Blob,
    width: number,
    height: number,
    guard?: { isCurrent: () => boolean }
  ): Promise<boolean> => {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) return false;

    context.imageSmoothingEnabled = false;

    let decodedSource: CanvasImageSource;
    let decodedBitmap: ImageBitmap | null = null;

    try {
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

      // 解码是异步的，提交前必须读取实时状态，避免会话切换后绘制旧画面。
      if (guard && !guard.isCurrent()) {
        decodedBitmap?.close();
        return false;
      }

      context.drawImage(decodedSource, 0, 0, canvas.width, canvas.height);
      decodedBitmap?.close();
      return true;
    } catch (error) {
      logger.error("FE/graphic-view/render", "Failed to render blob frame", { error });
      return false;
    }
  }, []);

  // 会话切换时重置视觉就绪状态
  useEffect(() => {
    resetVisualReady();
  }, [props.sessionId, resetVisualReady]);

  return {
    canvasRef,
    containerRef,
    frameSize,
    setFrameSize,
    notifyVisualReady,
    renderRgbaFrame,
    renderBlobFrame,
  };
}

/**
 * RDP 扫描码映射表
 */
export const RDP_SCANCODE_MAP: Record<string, number> = {
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

/**
 * VNC Keysym 映射表
 */
export const VNC_KEYSYM_MAP: Record<string, number> = {
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

/**
 * 计算指针位置（适用于居中缩放的显示模式）
 */
export function getPointerPositionCentered(
  container: HTMLElement,
  frame: { desktopWidth: number; desktopHeight: number },
  clientX: number,
  clientY: number
) {
  const rect = container.getBoundingClientRect();
  const scale = Math.min(rect.width / frame.desktopWidth, rect.height / frame.desktopHeight);
  const displayWidth = frame.desktopWidth * scale;
  const displayHeight = frame.desktopHeight * scale;
  const offsetX = (rect.width - displayWidth) / 2;
  const offsetY = (rect.height - displayHeight) / 2;

  const x = (clientX - rect.left - offsetX) / scale;
  const y = (clientY - rect.top - offsetY) / scale;

  return {
    x: Math.round(clamp(x, 0, frame.desktopWidth - 1)),
    y: Math.round(clamp(y, 0, frame.desktopHeight - 1)),
  };
}

/**
 * 计算指针位置（适用于填充模式的显示）
 */
export function getPointerPositionScaled(
  target: HTMLElement,
  frame: { desktopWidth: number; desktopHeight: number },
  clientX: number,
  clientY: number
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

/**
 * 构建光标样式（从 RGBA 数据）
 */
export function buildCursorStyleFromRgba(
  width: number,
  height: number,
  rgbaBytes: Uint8Array,
  hotspotX: number,
  hotspotY: number
): string {
  if (width === 0 || height === 0 || rgbaBytes.length === 0) {
    return "none";
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return "default";
  }

  context.putImageData(new ImageData(new Uint8ClampedArray(rgbaBytes), width, height), 0, 0);
  const url = canvas.toDataURL("image/png");
  return `url(${url}) ${hotspotX} ${hotspotY}, default`;
}

/**
 * 将 VNC Keysym 映射应用于键盘事件
 */
export function mapVncKeyboardEvent(event: React.KeyboardEvent<HTMLDivElement>): number | null {
  if (VNC_KEYSYM_MAP[event.code]) {
    return VNC_KEYSYM_MAP[event.code];
  }

  if (VNC_KEYSYM_MAP[event.key]) {
    return VNC_KEYSYM_MAP[event.key];
  }

  if (event.key.length === 1) {
    const codePoint = event.key.codePointAt(0);
    if (codePoint === undefined) {
      return null;
    }
    return codePoint <= 0xff ? codePoint : 0x01000000 | codePoint;
  }

  return null;
}

/**
 * 获取 RDP 扫描码
 */
export function getRdpScancode(event: React.KeyboardEvent<HTMLDivElement>): number | null {
  return RDP_SCANCODE_MAP[event.code] ?? null;
}
