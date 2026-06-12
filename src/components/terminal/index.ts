/**
 * 终端视图组件导出
 * 使用模板方法模式实现，所有视图继承自 BaseSessionView
 */

export { 
  useBaseSessionView,
  type BaseSessionViewProps,
  type BaseSessionViewResult,
  ConnectionStatusBadge,
  clamp,
  VIEW_CONTAINER_CLASSNAME,
  CANVAS_CLASSNAME,
  HIDDEN_CLASSNAME,
  INTERACTIVE_CONTAINER_CLASSNAME,
} from "./BaseSessionView";
export { ConnectionStatusOverlay } from "./ConnectionStatusOverlay";
export { SessionTransitionMask } from "./SessionTransitionMask";

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
