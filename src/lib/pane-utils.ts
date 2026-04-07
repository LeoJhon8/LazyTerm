/**
 * Pane 树形布局工具函数
 * 提供纯函数式的递归树操作能力
 * 
 * 数据模型：
 * - PaneLeaf: 叶子节点，包含一个 session
 * - PaneSplit: 分裂节点，包含两个子节点 + 方向 + 比例
 * - PaneNode: 叶子或分裂节点的联合类型
 */

import { logger } from "@/lib/logger";

// ========== 类型定义 ==========

export type SplitDirection = "horizontal" | "vertical";

/** 叶子节点 — 直接显示 session */
export interface PaneLeaf {
  type: "leaf";
  id: string;
  sessionId: string | null;
}

/** 分裂节点 — 包含两个子节点 */
export interface PaneSplit {
  type: "split";
  id: string;
  direction: SplitDirection;
  /** 第一个子节点的大小比例 (0.1 ~ 0.9) */
  ratio: number;
  children: [PaneNode, PaneNode];
}

/** 面板树节点 */
export type PaneNode = PaneLeaf | PaneSplit;

/** 拖拽放置区域 */
export type DropZone = "left" | "right" | "top" | "bottom";

// ========== 常量定义 ==========

/** 最小分裂比例 */
export const MIN_RATIO = 0.1;

/** 最大分裂比例 */
export const MAX_RATIO = 0.9;

/** 默认分裂比例 */
export const DEFAULT_RATIO = 0.5;

// ========== ID 生成 ==========

/** 生成唯一面板 ID */
export function generatePaneId(): string {
  return `pane-${Math.random().toString(36).substring(2, 11)}`;
}

/** 生成唯一分裂 ID */
export function generateSplitId(): string {
  return `split-${Math.random().toString(36).substring(2, 11)}`;
}

// ========== 创建工具 ==========

/** 创建叶子节点 */
export function createLeaf(sessionId: string | null = null): PaneLeaf {
  return {
    type: "leaf",
    id: generatePaneId(),
    sessionId,
  };
}

/** 创建分裂节点 */
export function createSplit(
  direction: SplitDirection,
  first: PaneNode,
  second: PaneNode,
  ratio: number = DEFAULT_RATIO
): PaneSplit {
  return {
    type: "split",
    id: generateSplitId(),
    direction,
    ratio: clampRatio(ratio),
    children: [first, second],
  };
}

// ========== 查询工具 ==========

/** 判断是否为叶子节点 */
export function isLeaf(node: PaneNode): node is PaneLeaf {
  return node.type === "leaf";
}

/** 判断是否为分裂节点 */
export function isSplit(node: PaneNode): node is PaneSplit {
  return node.type === "split";
}

/** 在树中查找叶子节点 */
export function findLeafById(root: PaneNode | null, leafId: string): PaneLeaf | undefined {
  if (!root) return undefined;
  if (isLeaf(root)) {
    return root.id === leafId ? root : undefined;
  }
  return findLeafById(root.children[0], leafId) || findLeafById(root.children[1], leafId);
}

/** 根据会话 ID 查找叶子节点 */
export function findLeafBySession(root: PaneNode | null, sessionId: string): PaneLeaf | undefined {
  if (!root) return undefined;
  if (isLeaf(root)) {
    return root.sessionId === sessionId ? root : undefined;
  }
  return findLeafBySession(root.children[0], sessionId) || findLeafBySession(root.children[1], sessionId);
}

/** 获取所有叶子节点 */
export function getAllLeaves(root: PaneNode | null): PaneLeaf[] {
  if (!root) return [];
  if (isLeaf(root)) return [root];
  return [...getAllLeaves(root.children[0]), ...getAllLeaves(root.children[1])];
}

/** 在树中查找分裂节点 */
export function findSplitById(root: PaneNode | null, splitId: string): PaneSplit | undefined {
  if (!root) return undefined;
  if (isSplit(root)) {
    if (root.id === splitId) return root;
    return findSplitById(root.children[0], splitId) || findSplitById(root.children[1], splitId);
  }
  return undefined;
}

/** 查找叶子节点的父分裂节点 */
export function findParentSplit(root: PaneNode | null, leafId: string): PaneSplit | undefined {
  if (!root || isLeaf(root)) return undefined;
  
  for (const child of root.children) {
    if (isLeaf(child) && child.id === leafId) {
      return root;
    }
    if (isSplit(child)) {
      const found = findParentSplit(child, leafId);
      if (found) return found;
    }
  }
  return undefined;
}

/** 获取叶子数量 */
export function getLeafCount(root: PaneNode | null): number {
  if (!root) return 0;
  if (isLeaf(root)) return 1;
  return getLeafCount(root.children[0]) + getLeafCount(root.children[1]);
}

// ========== 核心操作 ==========

/**
 * 分裂叶子节点
 * 将目标叶子替换为一个分裂节点，包含原叶子和新叶子
 * 
 * @param root 树根节点
 * @param leafId 要分裂的叶子 ID
 * @param direction 分裂方向
 * @param newSessionId 新叶子的会话 ID
 * @param dropZone 放置区域 — 决定新叶子在前还是在后
 * @returns 新树根和新叶子ID
 */
export function splitLeaf(
  root: PaneNode | null,
  leafId: string,
  direction: SplitDirection,
  newSessionId: string | null = null,
  dropZone: DropZone = "right"
): { root: PaneNode | null; newLeafId: string | null } {
  if (!root) {
    logger.error("FE/pane-utils/splitLeaf", "Root is null");
    return { root: null, newLeafId: null };
  }

  const newLeaf = createLeaf(newSessionId);

  const replaceInTree = (node: PaneNode): PaneNode => {
    if (isLeaf(node)) {
      if (node.id === leafId) {
        // 根据 dropZone 决定新叶子的位置
        const newFirst = (dropZone === "left" || dropZone === "top") ? newLeaf : node;
        const newSecond = (dropZone === "left" || dropZone === "top") ? node : newLeaf;
        return createSplit(direction, newFirst, newSecond, DEFAULT_RATIO);
      }
      return node;
    }

    // 递归替换子节点
    const newChildren: [PaneNode, PaneNode] = [
      replaceInTree(node.children[0]),
      replaceInTree(node.children[1]),
    ];

    if (newChildren[0] === node.children[0] && newChildren[1] === node.children[1]) {
      return node; // 没有变化
    }

    return { ...node, children: newChildren };
  };

  const newRoot = replaceInTree(root);

  logger.info("FE/pane-utils/splitLeaf", "Split leaf", {
    leafId,
    direction,
    dropZone,
    newLeafId: newLeaf.id,
    newSessionId,
  });

  return { root: newRoot, newLeafId: newLeaf.id };
}

/**
 * 移除叶子节点
 * 将父分裂节点替换为剩余的兄弟节点
 * 
 * @param root 树根节点
 * @param leafId 要移除的叶子 ID
 * @returns 新树根
 */
export function removeLeaf(root: PaneNode | null, leafId: string): PaneNode | null {
  if (!root) return null;

  // 根节点就是要移除的叶子
  if (isLeaf(root)) {
    if (root.id === leafId) {
      logger.info("FE/pane-utils/removeLeaf", "Removed root leaf", { leafId });
      return null;
    }
    return root;
  }

  // 检查子节点
  const [first, second] = root.children;

  // 如果第一个子节点是目标叶子，返回第二个子节点
  if (isLeaf(first) && first.id === leafId) {
    logger.info("FE/pane-utils/removeLeaf", "Removed leaf, promoting sibling", { leafId });
    return second;
  }

  // 如果第二个子节点是目标叶子，返回第一个子节点
  if (isLeaf(second) && second.id === leafId) {
    logger.info("FE/pane-utils/removeLeaf", "Removed leaf, promoting sibling", { leafId });
    return first;
  }

  // 递归处理子节点
  const newFirst = isLeaf(first) ? first : removeLeafFromSplit(first, leafId);
  const newSecond = isLeaf(second) ? second : removeLeafFromSplit(second, leafId);

  if (newFirst === null) return newSecond;
  if (newSecond === null) return newFirst;

  if (newFirst === first && newSecond === second) {
    return root; // 没有变化
  }

  return { ...root, children: [newFirst, newSecond] };
}

/** 从分裂节点中递归移除叶子 */
function removeLeafFromSplit(split: PaneSplit, leafId: string): PaneNode | null {
  const [first, second] = split.children;

  // 如果第一个子节点是目标叶子
  if (isLeaf(first) && first.id === leafId) {
    return second;
  }

  // 如果第二个子节点是目标叶子
  if (isLeaf(second) && second.id === leafId) {
    return first;
  }

  // 递归
  const newChildren: [PaneNode, PaneNode] = [
    isSplit(first) ? (removeLeafFromSplit(first, leafId) ?? first) : first,
    isSplit(second) ? (removeLeafFromSplit(second, leafId) ?? second) : second,
  ];

  if (newChildren[0] === first && newChildren[1] === second) {
    return split;
  }

  // 如果某个子节点被移除（变成了 null 的情况不会出现，因为我们上面处理了）
  return { ...split, children: newChildren };
}

/**
 * 设置叶子节点的会话
 */
export function setLeafSession(
  root: PaneNode | null,
  leafId: string,
  sessionId: string | null
): PaneNode | null {
  if (!root) return null;

  if (isLeaf(root)) {
    if (root.id === leafId) {
      return { ...root, sessionId };
    }
    return root;
  }

  const newChildren: [PaneNode, PaneNode] = [
    setLeafSession(root.children[0], leafId, sessionId)!,
    setLeafSession(root.children[1], leafId, sessionId)!,
  ];

  if (newChildren[0] === root.children[0] && newChildren[1] === root.children[1]) {
    return root;
  }

  return { ...root, children: newChildren };
}

/**
 * 设置分裂节点的比例
 */
export function setSplitRatio(
  root: PaneNode | null,
  splitId: string,
  ratio: number
): PaneNode | null {
  if (!root) return null;
  if (isLeaf(root)) return root;

  if (root.id === splitId) {
    return { ...root, ratio: clampRatio(ratio) };
  }

  const newChildren: [PaneNode, PaneNode] = [
    setSplitRatio(root.children[0], splitId, ratio)!,
    setSplitRatio(root.children[1], splitId, ratio)!,
  ];

  if (newChildren[0] === root.children[0] && newChildren[1] === root.children[1]) {
    return root;
  }

  return { ...root, children: newChildren };
}

/**
 * 最大化叶子节点 — 将树根替换为该叶子
 */
export function maximizeLeaf(root: PaneNode | null, leafId: string): PaneNode | null {
  if (!root) return null;

  const leaf = findLeafById(root, leafId);
  if (!leaf) {
    logger.error("FE/pane-utils/maximizeLeaf", "Leaf not found", { leafId });
    return root;
  }

  logger.info("FE/pane-utils/maximizeLeaf", "Maximized leaf", { leafId, sessionId: leaf.sessionId });
  return { ...leaf }; // 返回叶子的副本作为新的根
}

// ========== 工具函数 ==========

/** 限制比例范围 */
export function clampRatio(ratio: number): number {
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, ratio));
}

/**
 * 根据鼠标在面板中的相对位置，确定放置区域
 * 四分区域（类似 Termius）：
 * - 上 25% → top
 * - 下 25% → bottom
 * - 左 25% → left
 * - 右 25% → right
 * 
 * 优先级：最近的边
 */
export function getDropZone(
  relativeX: number,  // 0-1, 鼠标在面板中的水平相对位置
  relativeY: number   // 0-1, 鼠标在面板中的垂直相对位置
): DropZone {
  // 计算距离四个边的距离
  const distLeft = relativeX;
  const distRight = 1 - relativeX;
  const distTop = relativeY;
  const distBottom = 1 - relativeY;

  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist === distLeft) return "left";
  if (minDist === distRight) return "right";
  if (minDist === distTop) return "top";
  return "bottom";
}

/**
 * 将放置区域映射到分裂方向
 */
export function dropZoneToDirection(zone: DropZone): SplitDirection {
  return zone === "left" || zone === "right" ? "horizontal" : "vertical";
}

/**
 * 获取下一个可聚焦的叶子 ID（排除指定叶子）
 */
export function getNextFocusableLeaf(
  root: PaneNode | null,
  excludeLeafId?: string
): string | null {
  const leaves = getAllLeaves(root);
  const available = excludeLeafId 
    ? leaves.filter(l => l.id !== excludeLeafId) 
    : leaves;
  return available[0]?.id || null;
}
