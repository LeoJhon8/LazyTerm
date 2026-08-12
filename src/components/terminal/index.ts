/**
 * 终端视图组件导出
 * 终端视图共享类型与工具
 */

export {
  type BaseSessionViewProps,
  clamp,
  VIEW_CONTAINER_CLASSNAME,
  CANVAS_CLASSNAME,
  HIDDEN_CLASSNAME,
  INTERACTIVE_CONTAINER_CLASSNAME,
} from "./BaseSessionView";
export { ConnectionStatusOverlay } from "./ConnectionStatusOverlay";

// 图形化视图抽象子类
export {
  useBaseGraphicSessionView,
  type BaseGraphicSessionViewResult,
  RDP_SCANCODE_MAP,
  VNC_KEYSYM_MAP,
  getPointerPositionCentered,
  getPointerPositionScaled,
  buildCursorStyleFromRgba,
  mapVncKeyboardEvent,
  getRdpScancode,
} from "./BaseGraphicSessionView";

// 视图组件
export { TerminalViewClass } from "./TerminalViewClass";
export { RemoteDesktopViewClass } from "./RemoteDesktopViewClass";
export { VncViewClass } from "./VncViewClass";
export { NativeRdpHostView } from "./NativeRdpHostView";
