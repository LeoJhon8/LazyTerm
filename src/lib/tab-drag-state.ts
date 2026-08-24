/**
 * 跨组件拖拽分屏状态管理
 * 
 * 使用模块级可变状态 + CustomEvent 实现 TabBar → PaneView 的拖拽通信
 * 不使用 React state 避免高频更新的性能问题
 */

/** 拖拽状态 */
export interface TabDragState {
  isDragging: boolean;
  sessionId: string | null;
  pointerX: number;
  pointerY: number;
  input: "pointer" | "keyboard" | null;
}

/** 当前拖拽状态（可变引用） */
export const tabDragState: TabDragState = {
  isDragging: false,
  sessionId: null,
  pointerX: 0,
  pointerY: 0,
  input: null,
};

// ========== 事件名常量 ==========

export const TAB_DRAG_START_EVENT = "lazy-term-tab-drag-start";
export const TAB_DRAG_MOVE_EVENT = "lazy-term-tab-drag-move";
export const TAB_DRAG_END_EVENT = "lazy-term-tab-drag-end";
export const TAB_DRAG_CANCEL_EVENT = "lazy-term-tab-drag-cancel";

export type TabDragCancelReason =
  | "dnd"
  | "pointer-lost"
  | "pointerup-fallback"
  | "window-blur"
  | "restart"
  | "unmount"
  | "manual";

// ========== TabBar 侧 API ==========

let pointerMoveHandler: ((e: PointerEvent) => void) | null = null;

function detachPointerTracking() {
  if (!pointerMoveHandler) {
    return;
  }

  window.removeEventListener("pointermove", pointerMoveHandler);
  pointerMoveHandler = null;
}

function resetTabDragState() {
  tabDragState.isDragging = false;
  tabDragState.sessionId = null;
  tabDragState.input = null;
  detachPointerTracking();
}

export function updateTabDragPosition(x: number, y: number) {
  const sessionId = tabDragState.sessionId;
  if (!tabDragState.isDragging || !sessionId) {
    return;
  }

  tabDragState.pointerX = x;
  tabDragState.pointerY = y;
  window.dispatchEvent(new CustomEvent(TAB_DRAG_MOVE_EVENT, {
    detail: { x, y, sessionId },
  }));
}

/**
 * 开始标签拖拽（由 TabBar 调用）
 */
export function startTabDrag(
  sessionId: string,
  initialPointer?: { x: number; y: number },
) {
  if (tabDragState.isDragging) {
    cancelTabDrag("restart");
  } else {
    detachPointerTracking();
  }

  tabDragState.isDragging = true;
  tabDragState.sessionId = sessionId;
  tabDragState.pointerX = initialPointer?.x ?? 0;
  tabDragState.pointerY = initialPointer?.y ?? 0;
  tabDragState.input = initialPointer ? "pointer" : "keyboard";

  // 监听全局鼠标移动来追踪指针位置
  pointerMoveHandler = (e: PointerEvent) => {
    if (tabDragState.input === "pointer" && (e.buttons & 1) === 0) {
      cancelTabDrag("pointer-lost");
      return;
    }

    updateTabDragPosition(e.clientX, e.clientY);
  };
  window.addEventListener("pointermove", pointerMoveHandler);

  window.dispatchEvent(new CustomEvent(TAB_DRAG_START_EVENT, {
    detail: { sessionId },
  }));
}

/**
 * 结束标签拖拽（由 TabBar 调用）
 */
export function endTabDrag() {
  if (!tabDragState.isDragging || !tabDragState.sessionId) {
    detachPointerTracking();
    return;
  }

  const sessionId = tabDragState.sessionId;
  const x = tabDragState.pointerX;
  const y = tabDragState.pointerY;

  resetTabDragState();

  window.dispatchEvent(new CustomEvent(TAB_DRAG_END_EVENT, {
    detail: { sessionId, x, y },
  }));
}

/**
 * 取消标签拖拽，只清理位置选择状态，不触发分屏。
 */
export function cancelTabDrag(reason: TabDragCancelReason = "manual") {
  if (!tabDragState.isDragging || !tabDragState.sessionId) {
    detachPointerTracking();
    return;
  }

  const sessionId = tabDragState.sessionId;
  const input = tabDragState.input;
  resetTabDragState();
  window.dispatchEvent(new CustomEvent(TAB_DRAG_CANCEL_EVENT, {
    detail: { sessionId, input, reason },
  }));
}
