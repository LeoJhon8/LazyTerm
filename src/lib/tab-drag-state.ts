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
}

/** 当前拖拽状态（可变引用） */
export const tabDragState: TabDragState = {
  isDragging: false,
  sessionId: null,
  pointerX: 0,
  pointerY: 0,
};

// ========== 事件名常量 ==========

export const TAB_DRAG_START_EVENT = "lazy-terminal-tab-drag-start";
export const TAB_DRAG_MOVE_EVENT = "lazy-terminal-tab-drag-move";
export const TAB_DRAG_END_EVENT = "lazy-terminal-tab-drag-end";

// ========== TabBar 侧 API ==========

let pointerMoveHandler: ((e: PointerEvent) => void) | null = null;

/**
 * 开始标签拖拽（由 TabBar 调用）
 */
export function startTabDrag(sessionId: string) {
  tabDragState.isDragging = true;
  tabDragState.sessionId = sessionId;

  // 监听全局鼠标移动来追踪指针位置
  pointerMoveHandler = (e: PointerEvent) => {
    tabDragState.pointerX = e.clientX;
    tabDragState.pointerY = e.clientY;
    window.dispatchEvent(new CustomEvent(TAB_DRAG_MOVE_EVENT, {
      detail: { x: e.clientX, y: e.clientY, sessionId },
    }));
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
  const sessionId = tabDragState.sessionId;
  const x = tabDragState.pointerX;
  const y = tabDragState.pointerY;

  tabDragState.isDragging = false;
  tabDragState.sessionId = null;

  if (pointerMoveHandler) {
    window.removeEventListener("pointermove", pointerMoveHandler);
    pointerMoveHandler = null;
  }

  window.dispatchEvent(new CustomEvent(TAB_DRAG_END_EVENT, {
    detail: { sessionId, x, y },
  }));
}
