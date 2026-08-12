/**
 * 会话视图通用 props
 */
export interface BaseSessionViewProps {
  /** 面板 ID */
  paneId: string;
  /** 会话 ID */
  sessionId: string;
  /** 当前工作区中的视图是否可见 */
  isVisible?: boolean;
  /** 视觉准备就绪回调 */
  onVisualReady?: (sessionId: string) => void;
}

/**
 * 通用工具函数：限制数值范围
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 通用容器样式类名
 */
export const VIEW_CONTAINER_CLASSNAME =
  "terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden shadow-(--panel-shadow)";

/**
 * Canvas 容器样式类名
 */
export const CANVAS_CLASSNAME = "h-full w-full select-none object-contain";

/**
 * 隐藏元素样式类名
 */
export const HIDDEN_CLASSNAME = "hidden";

/**
 * 交互容器样式类名
 */
export const INTERACTIVE_CONTAINER_CLASSNAME =
  "relative flex h-full w-full items-center justify-center overflow-hidden outline-none";
