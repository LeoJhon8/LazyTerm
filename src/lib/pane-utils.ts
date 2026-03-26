/**
 * Pane 操作工具函数
 * 提供纯函数式的 Pane 管理能力，支持被外部直接调用
 */

import { logger } from "@/lib/logger";

// ========== 常量定义 ==========

/** 最小 Pane 数量（0 表示可以没有 pane，此时展示桌面首页） */
export const MIN_PANES = 0;

/** 最大 Pane 数量（当前版本限制为 2） */
export const MAX_PANES = 2;

/** 默认 Pane 方向 */
export const DEFAULT_PANE_DIRECTION: PaneDirection = "horizontal";

/** 默认 Pane 大小 */
export const DEFAULT_PANE_SIZE = 1;

// ========== 类型定义 ==========

export type PaneDirection = "horizontal" | "vertical";

export interface Pane {
  /** 面板唯一标识 */
  id: string;
  /** 当前显示的会话 ID */
  sessionId: string | null;
  /** 面板方向（用于分屏布局） */
  direction: PaneDirection;
  /** 面板大小比例（0-1之间） */
  size: number;
}

export interface PaneOperationResult {
  success: boolean;
  panes: Pane[];
  focusedPaneId: string | null;
  message?: string;
}

// ========== ID 生成工具 ==========

/**
 * 生成唯一面板 ID
 */
export function generatePaneId(): string {
  return `pane-${Math.random().toString(36).substring(2, 11)}`;
}

// ========== 查询工具 ==========

/**
 * 根据 ID 查找 Pane
 */
export function findPaneById(panes: Pane[], paneId: string): Pane | undefined {
  return panes.find((p) => p.id === paneId);
}

/**
 * 根据会话 ID 查找 Pane
 */
export function findPaneBySession(panes: Pane[], sessionId: string): Pane | undefined {
  return panes.find((p) => p.sessionId === sessionId);
}

/**
 * 获取 Pane 索引
 */
export function getPaneIndex(panes: Pane[], paneId: string): number {
  return panes.findIndex((p) => p.id === paneId);
}

/**
 * 检查是否可以新增 Pane
 */
export function canAddPane(panes: Pane[]): boolean {
  return panes.length < MAX_PANES;
}

/**
 * 检查是否可以移除 Pane
 */
export function canRemovePane(panes: Pane[]): boolean {
  return panes.length > MIN_PANES;
}

/**
 * 获取当前 Pane 数量
 */
export function getPaneCount(panes: Pane[]): number {
  return panes.length;
}

/**
 * 检查是否为最后一个 Pane
 */
export function isLastPane(panes: Pane[], paneId: string): boolean {
  return panes.length === 1 && panes[0]?.id === paneId;
}

// ========== 创建工具 ==========

/**
 * 创建默认 Pane
 */
export function createDefaultPane(sessionId: string | null = null): Pane {
  return {
    id: generatePaneId(),
    sessionId,
    direction: DEFAULT_PANE_DIRECTION,
    size: DEFAULT_PANE_SIZE,
  };
}

/**
 * 初始化 Pane 列表（根据 MIN_PANES 创建默认 Pane）
 * 当 MIN_PANES = 0 时返回空数组（显示桌面首页）
 */
export function initializePanes(): Pane[] {
  if (MIN_PANES === 0) {
    logger.debug("FE/pane-utils", "Initialized empty panes (MIN_PANES = 0)");
    return [];
  }
  const defaultPane = createDefaultPane();
  logger.debug("FE/pane-utils", "Initialized default pane", { paneId: defaultPane.id });
  return [defaultPane];
}

// ========== 核心操作 ==========

/**
 * 新增 Pane
 * @param panes 当前 Pane 列表
 * @param sessionId 要关联的会话 ID
 * @returns 操作结果
 */
export function addPane(
  panes: Pane[],
  sessionId: string | null = null
): PaneOperationResult {
  // 检查是否已达上限
  if (!canAddPane(panes)) {
    logger.warn("FE/pane-utils/add", "Maximum panes reached", {
      current: panes.length,
      max: MAX_PANES,
    });
    return {
      success: false,
      panes,
      focusedPaneId: null,
      message: `已达到最大 Pane 数量限制 (${MAX_PANES})`,
    };
  }

  const newPane = createDefaultPane(sessionId);
  const newSize = 1 / (panes.length + 1);

  // 重新计算所有 Pane 的大小
  const updatedPanes = panes.map((p) => ({ ...p, size: newSize }));
  updatedPanes.push({ ...newPane, size: newSize });

  logger.info("FE/pane-utils/add", "Created new pane", {
    paneId: newPane.id,
    sessionId,
    totalPanes: updatedPanes.length,
  });

  return {
    success: true,
    panes: updatedPanes,
    focusedPaneId: newPane.id,
  };
}

/**
 * 移除 Pane
 * @param panes 当前 Pane 列表
 * @param paneId 要移除的 Pane ID
 * @param currentFocusedId 当前焦点 Pane ID
 * @returns 操作结果
 */
export function removePane(
  panes: Pane[],
  paneId: string,
  currentFocusedId: string | null = null
): PaneOperationResult {
  // 检查是否已达下限
  if (!canRemovePane(panes)) {
    logger.warn("FE/pane-utils/remove", "Cannot remove pane, minimum reached");
    return {
      success: false,
      panes,
      focusedPaneId: currentFocusedId,
      message: `至少需要保留 ${MIN_PANES} 个 Pane`,
    };
  }

  const paneToRemove = findPaneById(panes, paneId);
  if (!paneToRemove) {
    logger.error("FE/pane-utils/remove", "Pane not found", { paneId });
    return {
      success: false,
      panes,
      focusedPaneId: currentFocusedId,
      message: "Pane 不存在",
    };
  }

  const remainingPanes = panes.filter((p) => p.id !== paneId);

  // 重新计算大小
  const newSize = 1 / remainingPanes.length;
  const resizedPanes = remainingPanes.map((p) => ({ ...p, size: newSize }));

  // 更新焦点
  let nextFocusId = currentFocusedId;
  if (currentFocusedId === paneId) {
    // 如果移除的是焦点 Pane，将焦点移到另一个 Pane
    nextFocusId = remainingPanes[remainingPanes.length - 1]?.id || null;
  }

  logger.info("FE/pane-utils/remove", "Removed pane", {
    paneId,
    remainingPanes: resizedPanes.length,
  });

  return {
    success: true,
    panes: resizedPanes,
    focusedPaneId: nextFocusId,
  };
}

/**
 * 拆分 Pane（创建新 Pane 并调整布局）
 * @param panes 当前 Pane 列表
 * @param sourcePaneId 要拆分的源 Pane ID
 * @param direction 拆分方向
 * @param sessionId 新 Pane 的会话 ID（可选）
 * @returns 操作结果
 */
export function splitPane(
  panes: Pane[],
  sourcePaneId: string,
  direction: PaneDirection = "horizontal",
  sessionId?: string
): PaneOperationResult & { newPaneId?: string } {
  if (!canAddPane(panes)) {
    logger.warn("FE/pane-utils/split", "Maximum panes reached", {
      current: panes.length,
      max: MAX_PANES,
    });
    return {
      success: false,
      panes,
      focusedPaneId: null,
      message: `已达到最大 Pane 数量限制 (${MAX_PANES})`,
    };
  }

  const sourcePane = findPaneById(panes, sourcePaneId);
  if (!sourcePane) {
    logger.error("FE/pane-utils/split", "Source pane not found", { sourcePaneId });
    return {
      success: false,
      panes,
      focusedPaneId: null,
      message: "源 Pane 不存在",
    };
  }

  const newPaneId = generatePaneId();
  const newSessionId = sessionId ?? sourcePane.sessionId;

  // 创建新 Pane
  const newPane: Pane = {
    id: newPaneId,
    sessionId: newSessionId,
    direction,
    size: 0.5,
  };

  // 更新源 Pane
  const updatedPanes = panes.map((p) => {
    if (p.id === sourcePaneId) {
      return { ...p, direction, size: 0.5 };
    }
    return p;
  });

  updatedPanes.push(newPane);

  logger.info("FE/pane-utils/split", "Split pane", {
    sourcePaneId,
    newPaneId,
    direction,
    sessionId: newSessionId,
  });

  return {
    success: true,
    panes: updatedPanes,
    focusedPaneId: newPaneId,
    newPaneId,
  };
}

/**
 * 合并 Pane（将两个 Pane 合并为一个）
 * @param panes 当前 Pane 列表
 * @param paneId 要合并的 Pane ID
 * @param targetPaneId 目标 Pane ID（可选，默认为另一个 Pane）
 * @param currentFocusedId 当前焦点 Pane ID
 * @returns 操作结果
 */
export function mergePane(
  panes: Pane[],
  paneId: string,
  targetPaneId?: string,
  currentFocusedId: string | null = null
): PaneOperationResult {
  if (!canRemovePane(panes)) {
    logger.warn("FE/pane-utils/merge", "Cannot merge, minimum panes reached");
    return {
      success: false,
      panes,
      focusedPaneId: currentFocusedId,
      message: `至少需要保留 ${MIN_PANES} 个 Pane`,
    };
  }

  const paneToMerge = findPaneById(panes, paneId);
  if (!paneToMerge) {
    logger.error("FE/pane-utils/merge", "Pane to merge not found", { paneId });
    return {
      success: false,
      panes,
      focusedPaneId: currentFocusedId,
      message: "要合并的 Pane 不存在",
    };
  }

  // 如果没有指定目标 Pane，选择另一个 Pane
  let targetId = targetPaneId;
  if (!targetId) {
    const otherPane = panes.find((p) => p.id !== paneId);
    targetId = otherPane?.id;
  }

  if (!targetId || targetId === paneId) {
    logger.error("FE/pane-utils/merge", "Invalid target pane", { targetPaneId });
    return {
      success: false,
      panes,
      focusedPaneId: currentFocusedId,
      message: "目标 Pane 无效",
    };
  }

  const remainingPanes = panes.filter((p) => p.id !== paneId);

  // 重新计算大小
  const newSize = 1 / remainingPanes.length;
  const resizedPanes = remainingPanes.map((p) => ({
    ...p,
    size: newSize,
    direction: DEFAULT_PANE_DIRECTION as PaneDirection,
  }));

  // 更新焦点
  let nextFocusId = currentFocusedId;
  if (currentFocusedId === paneId) {
    nextFocusId = targetId;
  }

  logger.info("FE/pane-utils/merge", "Merged pane", { paneId, targetPaneId: targetId });

  return {
    success: true,
    panes: resizedPanes,
    focusedPaneId: nextFocusId,
  };
}

// ========== 修改工具 ==========

/**
 * 设置 Pane 的会话
 */
export function setPaneSession(
  panes: Pane[],
  paneId: string,
  sessionId: string | null
): Pane[] {
  return panes.map((p) => (p.id === paneId ? { ...p, sessionId } : p));
}

/**
 * 交换两个 Pane 的会话
 */
export function swapPaneSessions(panes: Pane[], paneId1: string, paneId2: string): Pane[] {
  const pane1 = findPaneById(panes, paneId1);
  const pane2 = findPaneById(panes, paneId2);

  if (!pane1 || !pane2) {
    logger.error("FE/pane-utils/swap", "Pane not found", { paneId1, paneId2 });
    return panes;
  }

  return panes.map((p) => {
    if (p.id === paneId1) {
      return { ...p, sessionId: pane2.sessionId };
    }
    if (p.id === paneId2) {
      return { ...p, sessionId: pane1.sessionId };
    }
    return p;
  });
}

/**
 * 移动会话到指定 Pane
 */
export function moveSessionToPane(
  panes: Pane[],
  sessionId: string,
  targetPaneId: string
): Pane[] {
  return panes.map((p) => {
    if (p.sessionId === sessionId) {
      return { ...p, sessionId: null };
    }
    if (p.id === targetPaneId) {
      return { ...p, sessionId };
    }
    return p;
  });
}

/**
 * 设置 Pane 大小
 */
export function setPaneSize(panes: Pane[], paneId: string, size: number): Pane[] {
  const clampedSize = Math.max(0.1, Math.min(0.9, size));
  return panes.map((p) => (p.id === paneId ? { ...p, size: clampedSize } : p));
}

/**
 * 设置 Pane 方向
 */
export function setPaneDirection(
  panes: Pane[],
  paneId: string,
  direction: PaneDirection
): Pane[] {
  return panes.map((p) => (p.id === paneId ? { ...p, direction } : p));
}

// ========== 焦点管理 ==========

/**
 * 切换焦点到指定 Pane
 */
export function focusPane(
  panes: Pane[],
  paneId: string,
  currentFocusedId: string | null = null
): string | null {
  const paneExists = panes.some((p) => p.id === paneId);
  if (!paneExists) {
    logger.error("FE/pane-utils/focus", "Pane not found", { paneId });
    return currentFocusedId;
  }
  return paneId;
}

/**
 * 获取下一个可聚焦的 Pane ID
 */
export function getNextFocusablePane(
  panes: Pane[],
  excludePaneId?: string
): string | null {
  const availablePanes = excludePaneId
    ? panes.filter((p) => p.id !== excludePaneId)
    : panes;
  return availablePanes[availablePanes.length - 1]?.id || null;
}

// ========== 批量操作 ==========

/**
 * 清空所有 Pane（根据 MIN_PANES 重置）
 * 当 MIN_PANES = 0 时返回空数组，否则返回单个默认 Pane
 */
export function clearPanes(): Pane[] {
  logger.info("FE/pane-utils/clear", "Cleared all panes");
  return initializePanes();
}

/**
 * 重置 Pane 大小为均匀分布
 */
export function resetPaneSizes(panes: Pane[]): Pane[] {
  const newSize = 1 / panes.length;
  return panes.map((p) => ({ ...p, size: newSize }));
}
