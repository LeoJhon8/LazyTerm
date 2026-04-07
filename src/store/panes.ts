import { create } from "zustand";
import { logger } from "@/lib/logger";
import { useTabsStore } from "./tabs";
import {
  type PaneNode,
  type PaneLeaf,
  type SplitDirection,
  type DropZone,
  createLeaf,
  findLeafById,
  findLeafBySession,
  getAllLeaves,
  splitLeaf,
  removeLeaf,
  setLeafSession as setLeafSessionUtil,
  setSplitRatio as setSplitRatioUtil,
  maximizeLeaf as maximizeLeafUtil,
  getNextFocusableLeaf,
  getLeafCount,
} from "@/lib/pane-utils";

// 重新导出类型
export type { PaneNode, PaneLeaf, PaneSplit, SplitDirection, DropZone } from "@/lib/pane-utils";

export interface WorkspaceTree {
  rootNode: PaneNode | null;
  focusedPaneId: string | null;
}

/**
 * 分屏状态管理接口
 * 
 * 数据模型：递归树结构
 * - rootNode 为 null 时显示欢迎页
 * - rootNode 为 PaneLeaf 时显示单个面板
 * - rootNode 为 PaneSplit 时显示分裂布局
 * 
 * 注意：分屏状态不持久化，每次打开应用时重置
 */
interface PanesState {
  // ========== 状态 ==========
  
  /** 所有工作区（每个 Tab 对应一个） */
  workspaces: Record<string, WorkspaceTree>;

  // ========== 核心操作 ==========
  
  /** 获取当前活跃的工作区树 */
  getActiveWorkspace: () => WorkspaceTree;

  /** 获取指定工作区树 */
  getWorkspace: (tabId: string) => WorkspaceTree;

  /** 清理工作区（当 Tab 关闭时调用） */
  cleanupWorkspace: (tabId: string) => void;

  /** 
   * 添加一个新的叶子面板到当前工作区
   */
  addPane: (sessionId?: string) => string | null;
  
  /**
   * 分裂指定叶子面板
   */
  splitPane: (leafId: string, direction: SplitDirection, sessionId?: string, dropZone?: DropZone) => string | null;
  
  /**
   * 移除叶子面板
   */
  removePane: (leafId: string) => boolean;
  
  /**
   * 最大化叶子面板
   */
  maximizePane: (leafId: string) => void;
  
  /**
   * 设置叶子面板的会话
   */
  setPaneSession: (leafId: string, sessionId: string | null) => void;
  
  /**
   * 设置分裂节点的比例
   */
  setSplitRatio: (splitId: string, ratio: number) => void;
  
  /**
   * 设置焦点面板
   */
  focusPane: (leafId: string) => void;
  
  /**
   * 清空当前工作区所有面板
   */
  clearPanes: () => void;

  // ========== 查询方法 ==========
  
  /** 获取所有叶子列表 */
  getAllLeaves: (tabId?: string) => PaneLeaf[];
  
  /** 获取焦点面板 */
  getFocusedPane: () => PaneLeaf | undefined;
  
  /** 获取指定会话所在的叶子 ID (全局搜索或指定工作区) */
  getPaneIdBySession: (sessionId: string) => string | undefined;

  /** 根据 ID 查找叶子 (全局搜索) */
  getLeafById: (leafId: string) => PaneLeaf | undefined;

  /** 根据 会话ID 查找叶子 (全局搜索) */
  getLeafBySession: (sessionId: string) => PaneLeaf | undefined;
  
  /** 获取当前工作区叶子数量 */
  getPaneCount: () => number;
}

/** 获取当前 activeTabId */
const getActiveTabId = () => {
  const activeTabId = useTabsStore.getState().activeTabId;
  return activeTabId;
};

/**
 * 分屏状态 Store
 */
export const usePanesStore = create<PanesState>()(
  (set, get) => ({
    workspaces: {},

    // ========== 辅助操作 ==========

    getActiveWorkspace: () => {
      const tabId = getActiveTabId();
      if (!tabId) return { rootNode: null, focusedPaneId: null };
      return get().workspaces[tabId] || { rootNode: null, focusedPaneId: null };
    },

    getWorkspace: (tabId) => {
      return get().workspaces[tabId] || { rootNode: null, focusedPaneId: null };
    },

    cleanupWorkspace: (tabId) => {
      set((state) => {
        const newWorkspaces = { ...state.workspaces };
        delete newWorkspaces[tabId];
        return { workspaces: newWorkspaces };
      });
      logger.info("FE/store/panes", "Cleaned up workspace for tab", { tabId });
    },

    // ========== 核心操作 ==========

    addPane: (sessionId) => {
      const tabId = getActiveTabId();
      if (!tabId) return null;

      const ws = get().getActiveWorkspace();
      const { rootNode, focusedPaneId } = ws;
      
      if (!rootNode) {
        // 没有面板，创建新的根叶子
        const leaf = createLeaf(sessionId ?? null);
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [tabId]: { rootNode: leaf, focusedPaneId: leaf.id },
          }
        }));
        logger.info("FE/store/panes", "Created root leaf", { tabId, leafId: leaf.id, sessionId });
        return leaf.id;
      }

      // 有面板，在焦点面板上分裂
      const targetId = focusedPaneId || getAllLeaves(rootNode)[0]?.id;
      if (!targetId) return null;

      const { root: newRoot, newLeafId } = splitLeaf(
        rootNode, targetId, "horizontal", sessionId ?? null, "right"
      );

      if (newRoot && newLeafId) {
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [tabId]: { rootNode: newRoot, focusedPaneId: newLeafId },
          }
        }));
        logger.info("FE/store/panes", "Added pane via split", { tabId, targetId, newLeafId, sessionId });
        return newLeafId;
      }

      return null;
    },

    splitPane: (leafId, direction, sessionId, dropZone = "right") => {
      const tabId = getActiveTabId();
      if (!tabId) return null;

      const ws = get().getActiveWorkspace();
      const { rootNode } = ws;
      
      const { root: newRoot, newLeafId } = splitLeaf(
        rootNode, leafId, direction, sessionId ?? null, dropZone
      );

      if (newRoot && newLeafId) {
        set((state) => ({
          workspaces: {
            ...state.workspaces,
            [tabId]: { rootNode: newRoot, focusedPaneId: newLeafId },
          }
        }));
        return newLeafId;
      }

      return null;
    },

    removePane: (leafId) => {
      const tabId = getActiveTabId();
      if (!tabId) return false;

      const ws = get().getActiveWorkspace();
      const { rootNode, focusedPaneId } = ws;
      
      const newRoot = removeLeaf(rootNode, leafId);
      
      // 更新焦点
      let newFocusId = focusedPaneId;
      if (focusedPaneId === leafId) {
        newFocusId = getNextFocusableLeaf(newRoot, leafId);
      }

      set((state) => ({
        workspaces: {
          ...state.workspaces,
          [tabId]: { rootNode: newRoot, focusedPaneId: newFocusId },
        }
      }));

      logger.info("FE/store/panes", "Removed pane", { tabId, leafId, newFocusId });
      return true;
    },

    maximizePane: (leafId) => {
      const tabId = getActiveTabId();
      if (!tabId) return;

      const ws = get().getActiveWorkspace();
      const newRoot = maximizeLeafUtil(ws.rootNode, leafId);
      set((state) => ({
        workspaces: {
          ...state.workspaces,
          [tabId]: { rootNode: newRoot, focusedPaneId: leafId },
        }
      }));
    },

    setPaneSession: (leafId, sessionId) => {
      const tabId = getActiveTabId();
      if (!tabId) return;

      const ws = get().getActiveWorkspace();
      const newRoot = setLeafSessionUtil(ws.rootNode, leafId, sessionId);
      set((state) => ({
        workspaces: {
          ...state.workspaces,
          [tabId]: { ...ws, rootNode: newRoot },
        }
      }));
      logger.debug("FE/store/panes", "Set pane session", { tabId, leafId, sessionId });
    },

    setSplitRatio: (splitId, ratio) => {
      const tabId = getActiveTabId();
      if (!tabId) return;

      const ws = get().getActiveWorkspace();
      const newRoot = setSplitRatioUtil(ws.rootNode, splitId, ratio);
      set((state) => ({
        workspaces: {
          ...state.workspaces,
          [tabId]: { ...ws, rootNode: newRoot },
        }
      }));
    },

    focusPane: (leafId) => {
      const tabId = getActiveTabId();
      if (!tabId) return;

      const ws = get().getActiveWorkspace();
      const leaf = findLeafById(ws.rootNode, leafId);
      if (!leaf) {
        logger.error("FE/store/panes", "Leaf not found for focus", { leafId });
        return;
      }
      
      set((state) => ({
        workspaces: {
          ...state.workspaces,
          [tabId]: { ...ws, focusedPaneId: leafId },
        }
      }));

      // 同步更新 tabs store 的 focusSessionId
      if (leaf.sessionId) {
        useTabsStore.getState().setFocusSession(leaf.sessionId);
        logger.debug("FE/store/panes", "Focused pane and synced focusSession", { leafId, sessionId: leaf.sessionId });
      }
    },

    clearPanes: () => {
      const tabId = getActiveTabId();
      if (!tabId) return;

      set((state) => ({
        workspaces: {
          ...state.workspaces,
          [tabId]: { rootNode: null, focusedPaneId: null },
        }
      }));
      logger.info("FE/store/panes", "Cleared all panes", { tabId });
    },

    // ========== 查询方法 ==========

    getLeafById: (leafId) => {
      const workspaces = get().workspaces;
      for (const key of Object.keys(workspaces)) {
        const leaf = findLeafById(workspaces[key].rootNode, leafId);
        if (leaf) return leaf;
      }
      return undefined;
    },

    getLeafBySession: (sessionId) => {
      const workspaces = get().workspaces;
      for (const key of Object.keys(workspaces)) {
        const leaf = findLeafBySession(workspaces[key].rootNode, sessionId);
        if (leaf) return leaf;
      }
      return undefined;
    },

    getAllLeaves: (tabId?: string) => {
      if (tabId) {
        const ws = get().workspaces[tabId];
        return ws ? getAllLeaves(ws.rootNode) : [];
      } else {
        const ws = get().getActiveWorkspace();
        return getAllLeaves(ws.rootNode);
      }
    },

    getFocusedPane: () => {
      const ws = get().getActiveWorkspace();
      if (!ws.focusedPaneId || !ws.rootNode) return undefined;
      return findLeafById(ws.rootNode, ws.focusedPaneId);
    },

    getPaneIdBySession: (sessionId) => {
      const leaf = get().getLeafBySession(sessionId);
      return leaf?.id;
    },

    getPaneCount: () => {
      const ws = get().getActiveWorkspace();
      return getLeafCount(ws.rootNode);
    },
  })
);

// ========== 辅助 Hooks ==========

/** 获取指定面板的会话 ID */
export function usePaneSession(paneId: string) {
  return usePanesStore((state) => state.getLeafById(paneId)?.sessionId || null);
}

/** 获取焦点面板的会话 ID */
export function useFocusedPaneSession() {
  return usePanesStore((state) => state.getFocusedPane()?.sessionId || null);
}

/** 获取面板数量 */
export function usePaneCount() {
  return usePanesStore((state) => state.getPaneCount());
}
