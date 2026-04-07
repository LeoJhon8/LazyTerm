import { create } from "zustand";
import { logger } from "@/lib/logger";
import { useTabsStore } from "./tabs";
import {
  type Pane,
  type PaneDirection,
  MIN_PANES,
  MAX_PANES,
  initializePanes,
  addPane as addPaneUtil,
  removePane as removePaneUtil,
  splitPane as splitPaneUtil,
  mergePane as mergePaneUtil,
  setPaneSession as setPaneSessionUtil,
  swapPaneSessions as swapPaneSessionsUtil,
  moveSessionToPane as moveSessionToPaneUtil,
  setPaneSize as setPaneSizeUtil,
  focusPane as focusPaneUtil,
  clearPanes as clearPanesUtil,
  resetPaneSizes,
  findPaneById,
  findPaneBySession,
  canAddPane,
  canRemovePane,
} from "@/lib/pane-utils";

// 重新导出类型
export type { Pane, PaneDirection } from "@/lib/pane-utils";
export { MIN_PANES, MAX_PANES } from "@/lib/pane-utils";

/**
 * 分屏状态管理接口
 * 
 * 注意：分屏状态不持久化，每次打开应用时重置
 * 这是设计决策：分屏是"本次会话"的布局选择，而非用户偏好设置
 */
interface PanesState {
  // ========== 状态 ==========
  
  /** 所有面板列表 */
  panes: Pane[];
  /** 当前获得焦点的面板 ID */
  focusedPaneId: string | null;
  /** 最大支持的面板数量 */
  readonly maxPanes: number;
  /** 最小支持的面板数量 */
  readonly minPanes: number;

  // ========== 核心操作 ==========
  
  /** 
   * 初始化面板系统
   * 在应用启动时调用，根据 MIN_PANES 创建默认面板
   * MIN_PANES = 0 时为空数组（显示桌面首页）
   * MIN_PANES > 0 时创建默认 pane
   */
  initializePanes: () => void;
  
  /**
   * 新增 Pane
   * @param sessionId 要关联的会话 ID
   * @returns 新创建的 Pane ID 或 null
   */
  addPane: (sessionId?: string) => string | null;
  
  /**
   * 移除 Pane
   * @param paneId 要移除的 Pane ID
   * @returns 是否成功移除
   */
  removePane: (paneId: string) => boolean;
  
  /**
   * 拆分 Pane
   * @param paneId 要拆分的 Pane ID
   * @param direction 拆分方向
   * @param sessionId 新 Pane 的会话 ID
   * @returns 新创建的 Pane ID 或 null
   */
  splitPane: (paneId: string, direction?: PaneDirection, sessionId?: string) => string | null;
  
  /**
   * 合并 Pane
   * @param paneId 要合并的 Pane ID
   * @param targetPaneId 目标 Pane ID
   * @returns 是否成功合并
   */
  mergePane: (paneId: string, targetPaneId?: string) => boolean;
  
  /**
   * 设置 Pane 的会话
   * @param paneId Pane ID
   * @param sessionId 会话 ID（null 表示清空）
   */
  setPaneSession: (paneId: string, sessionId: string | null) => void;
  
  /**
   * 交换两个 Pane 的会话
   * @param paneId1 第一个 Pane ID
   * @param paneId2 第二个 Pane ID
   */
  swapPanes: (paneId1: string, paneId2: string) => void;
  
  /**
   * 移动会话到指定 Pane
   * @param sessionId 会话 ID
   * @param targetPaneId 目标 Pane ID
   */
  moveSessionToPane: (sessionId: string, targetPaneId: string) => void;
  
  /**
   * 设置焦点 Pane
   * @param paneId Pane ID
   */
  focusPane: (paneId: string) => void;
  
  /**
   * 设置 Pane 大小
   * @param paneId Pane ID
   * @param size 大小比例（0-1）
   */
  setPaneSize: (paneId: string, size: number) => void;
  
  /**
   * 重置所有 Pane 为均匀大小
   */
  resetPaneSizes: () => void;
  
  /**
   * 清空所有 Pane（根据 MIN_PANES 重置）
   */
  clearPanes: () => void;
  
  // ========== 查询方法 ==========
  
  /**
   * 根据 ID 查找 Pane
   */
  getPaneById: (paneId: string) => Pane | undefined;
  
  /**
   * 根据会话 ID 查找 Pane
   */
  getPaneBySession: (sessionId: string) => Pane | undefined;
  
  /**
   * 获取焦点 Pane
   */
  getFocusedPane: () => Pane | undefined;
  
  /**
   * 获取指定会话所在的 Pane ID
   */
  getPaneIdBySession: (sessionId: string) => string | undefined;
  
  /**
   * 检查是否可以新增 Pane
   */
  canAddPane: () => boolean;
  
  /**
   * 检查是否可以移除 Pane
   */
  canRemovePane: () => boolean;
  
  /**
   * 检查是否可以拆分 Pane（等同于 canAddPane）
   */
  canSplit: () => boolean;
  
  /**
   * 获取当前 Pane 数量
   */
  getPaneCount: () => number;
}

/**
 * 分屏状态 Store
 * 
 * 重要：分屏状态不持久化到 localStorage
 * - 每次打开应用时，pane 列表为空
 * - 需要通过 initializePanes() 或 addPane() 来创建 pane
 * - 这是有意的设计：分屏是"本次会话"的布局，不是用户偏好
 */
export const usePanesStore = create<PanesState>()(
  (set, get) => ({
    // 初始状态：空数组，不自动创建 pane
    panes: [],
    focusedPaneId: null,
    maxPanes: MAX_PANES,
    minPanes: MIN_PANES,

    // ========== 核心操作 ==========

    initializePanes: () => {
      const { panes } = get();
      // 如果已经有面板，不重新初始化
      if (panes.length > 0) return;
      
      const defaultPanes = initializePanes();
      set({
        panes: defaultPanes,
        focusedPaneId: defaultPanes[0]?.id || null,
      });
    },

    addPane: (sessionId) => {
      const { panes } = get();
      
      const result = addPaneUtil(panes, sessionId);
      
      if (result.success) {
        set({
          panes: result.panes,
          focusedPaneId: result.focusedPaneId,
        });
        return result.focusedPaneId;
      }
      
      return null;
    },

    removePane: (paneId) => {
      const { panes, focusedPaneId } = get();
      
      const result = removePaneUtil(panes, paneId, focusedPaneId);
      
      if (result.success) {
        set({
          panes: result.panes,
          focusedPaneId: result.focusedPaneId,
        });
        return true;
      }
      
      return false;
    },

    splitPane: (paneId, direction = "horizontal", sessionId) => {
      const { panes } = get();
      
      const result = splitPaneUtil(panes, paneId, direction, sessionId);
      
      if (result.success) {
        set({
          panes: result.panes,
          focusedPaneId: result.focusedPaneId,
        });
        return result.newPaneId || null;
      }
      
      return null;
    },

    mergePane: (paneId, targetPaneId) => {
      const { panes, focusedPaneId } = get();
      
      const result = mergePaneUtil(panes, paneId, targetPaneId, focusedPaneId);
      
      if (result.success) {
        set({
          panes: result.panes,
          focusedPaneId: result.focusedPaneId,
        });
        return true;
      }
      
      return false;
    },

    setPaneSession: (paneId, sessionId) => {
      const { panes } = get();
      const updatedPanes = setPaneSessionUtil(panes, paneId, sessionId);
      set({ panes: updatedPanes });
      logger.debug("FE/store/panes", "Set pane session", { paneId, sessionId });
    },

    swapPanes: (paneId1, paneId2) => {
      const { panes } = get();
      const updatedPanes = swapPaneSessionsUtil(panes, paneId1, paneId2);
      set({ panes: updatedPanes });
      logger.debug("FE/store/panes", "Swapped panes", { paneId1, paneId2 });
    },

    moveSessionToPane: (sessionId, targetPaneId) => {
      const { panes } = get();
      const updatedPanes = moveSessionToPaneUtil(panes, sessionId, targetPaneId);
      set({ panes: updatedPanes });
      logger.debug("FE/store/panes", "Moved session to pane", { sessionId, targetPaneId });
    },

    focusPane: (paneId) => {
      const { panes, focusedPaneId } = get();
      const newFocusId = focusPaneUtil(panes, paneId, focusedPaneId);
      set({ focusedPaneId: newFocusId });
      
      // 同步更新 tabs store 的 focusSessionId，使 TabBar 的蓝色指示线跟随焦点 pane
      const focusedPane = panes.find((p) => p.id === newFocusId);
      if (focusedPane?.sessionId) {
        useTabsStore.getState().setFocusSession(focusedPane.sessionId);
        logger.debug("FE/store/panes", "Focused pane and synced focusSession", { paneId, sessionId: focusedPane.sessionId });
      } else {
        logger.debug("FE/store/panes", "Focused pane (no session)", { paneId });
      }
    },

    setPaneSize: (paneId, size) => {
      const { panes } = get();
      const updatedPanes = setPaneSizeUtil(panes, paneId, size);
      set({ panes: updatedPanes });
    },

    resetPaneSizes: () => {
      const { panes } = get();
      const updatedPanes = resetPaneSizes(panes);
      set({ panes: updatedPanes });
      logger.debug("FE/store/panes", "Reset pane sizes");
    },

    clearPanes: () => {
      const defaultPanes = clearPanesUtil();
      set({
        panes: defaultPanes,
        focusedPaneId: defaultPanes[0]?.id || null,
      });
    },

    // ========== 查询方法 ==========

    getPaneById: (paneId) => {
      return findPaneById(get().panes, paneId);
    },

    getPaneBySession: (sessionId) => {
      return findPaneBySession(get().panes, sessionId);
    },

    getFocusedPane: () => {
      const { panes, focusedPaneId } = get();
      return panes.find((p) => p.id === focusedPaneId);
    },

    getPaneIdBySession: (sessionId) => {
      const pane = findPaneBySession(get().panes, sessionId);
      return pane?.id;
    },

    canAddPane: () => {
      return canAddPane(get().panes);
    },

    canRemovePane: () => {
      return canRemovePane(get().panes);
    },

    canSplit: () => {
      return canAddPane(get().panes);
    },

    getPaneCount: () => {
      return get().panes.length;
    },
  })
);

/**
 * 辅助 Hook：获取指定 Pane 的会话信息
 */
export function usePaneSession(paneId: string) {
  return usePanesStore((state) => state.getPaneById(paneId)?.sessionId || null);
}

/**
 * 辅助 Hook：获取焦点 Pane 的会话信息
 */
export function useFocusedPaneSession() {
  return usePanesStore((state) => state.getFocusedPane()?.sessionId || null);
}

/**
 * 辅助 Hook：获取 Pane 数量
 */
export function usePaneCount() {
  return usePanesStore((state) => state.getPaneCount());
}
