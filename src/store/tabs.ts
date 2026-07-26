import { create } from "zustand";
import type { ConnectionStateEvent, ITerminalConnector, SessionConnectionStatus, SessionConnector } from "@/types/terminal";
import { logger } from "@/lib/logger";
import { createConnector, type SessionCreationData } from "@/connectors/ConnectorFactory";
import {
  getConnectionErrorPresentation,
  getOpenFailureLogLabel,
  getSessionTargetLabel,
  type SessionConnectionError,
} from "@/services/connectionErrorService";

/**
 * Session 生命周期回调接口
 * 由 TabBar 实现并注册，用于集中管理 pane 生命周期
 */
export interface SessionLifecycleCallbacks {
  /** 当新 session 被创建时调用 */
  onSessionCreated: (sessionId: string) => void;
  /** 当 session 被移除时调用 */
  onSessionRemoved: (sessionId: string) => void;
  /** 当焦点 session 变化时调用（关闭会话后切换到其他会话） */
  onFocusSessionChanged: (sessionId: string) => void;
  /** 当最后一个 session 被关闭时调用 */
  onAllSessionsClosed: () => void;
}

// 全局回调引用（由 TabBar 设置）
let sessionLifecycleCallbacks: SessionLifecycleCallbacks | null = null;

/**
 * 注册 session 生命周期回调
 * 由 TabBar 在挂载时调用
 */
export function registerSessionLifecycleCallbacks(callbacks: SessionLifecycleCallbacks) {
  sessionLifecycleCallbacks = callbacks;
  logger.debug("FE/store/tabs", "Session lifecycle callbacks registered");
}

/**
 * 注销 session 生命周期回调
 * 由 TabBar 在卸载时调用
 */
export function unregisterSessionLifecycleCallbacks() {
  sessionLifecycleCallbacks = null;
  logger.debug("FE/store/tabs", "Session lifecycle callbacks unregistered");
}

/**
 * 终端会话配置接口
 * 从 ConnectorFactory 复用 SessionCreationData
 */
export type SessionConfig = NonNullable<SessionCreationData["config"]>;

/**
 * 终端会话对象定义
 */
export interface TerminalSession {
  id: string;
  title: string;
  type: "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli";
  /** 连接器实例（仅存在于内存中，不持久化） */
  connector?: SessionConnector;
  cwd?: string;
  host?: string;
  config?: SessionConfig;
  connectionStatus: SessionConnectionStatus;
}

// SessionConnectionError 类型从 connectionErrorService 导入
export type { SessionConnectionError };

export interface TabWorkspace {
  id: string;
  title: string;
}

export interface AddSessionOptions {
  /** 跳过默认的窗格生命周期处理，由调用方一次性恢复完整布局。 */
  notifyLifecycle?: boolean;
}

export interface RemoveSessionOptions {
  /** 跳过默认的窗格生命周期处理，用于回滚尚未挂载的批量会话。 */
  notifyLifecycle?: boolean;
}

function getNextTabId(tabs: TabWorkspace[], removedId: string): string | null {
  const remainingTabs = tabs.filter((tab) => tab.id !== removedId);
  return remainingTabs.length > 0 ? remainingTabs[remainingTabs.length - 1].id : null;
}

/**
 * 状态机接口定义
 */
interface TabsState {
  // --- Workspace Tabs ---
  tabs: TabWorkspace[];
  activeTabId: string | null;
  addTab: (tabData: { id?: string; title?: string }) => string;
  removeTab: (id: string) => void;
  setActiveTabId: (id: string | null) => void;
  updateTab: (id: string, updates: Partial<Omit<TabWorkspace, "id">>) => void;
  reorderTabs: (orderedIds: string[]) => void;
  closeOtherTabs: (id: string) => void;
  closeLeftTabs: (id: string) => void;
  closeRightTabs: (id: string) => void;
  closeAllTabs: () => void;

  // --- Sessions ---
  sessions: TerminalSession[];
  /** 
   * 操作权（焦点）：决定快捷命令栏和历史命令栏的发送目标
   */
  focusSessionId: string | null;
  connectionError: SessionConnectionError | null;

  /** 主动创建新会话（带连接器） */
  addSession: (
    sessionData: Omit<TerminalSession, "id" | "connector" | "connectionStatus">,
    options?: AddSessionOptions,
  ) => string;
  removeSession: (id: string, options?: RemoveSessionOptions) => void;
  setFocusSession: (id: string | null) => void;
  updateSession: (id: string, updates: Partial<Omit<TerminalSession, "id" | "connector">>) => void;
  
  /** 获取所有会话的连接器 */
  getAllConnectors: () => ITerminalConnector[];
  /** 在当前标签内重新建立连接 */
  reconnectSession: (sessionId: string) => void;
  /** 清除最近一次连接失败提示 */
  clearConnectionError: () => void;
}

export const useTabsStore = create<TabsState>()(
  (set, get) => {
      const stateUnsubscribers = new Map<string, () => void>();
      const reconnectingSessions = new Set<string>();

      const attachConnectionState = (sessionId: string, connector: SessionConnector) => {
        stateUnsubscribers.get(sessionId)?.();
        const unsubscribe = connector.onConnectionState((event: ConnectionStateEvent) => {
          if (event.phase === "idle" && reconnectingSessions.has(sessionId)) {
            return;
          }
          const now = Date.now();
          let shouldReconnectLocal = false;
          set((state) => ({
            sessions: state.sessions.map((session) => {
              if (session.id !== sessionId) return session;
              const isReconnectTransition = reconnectingSessions.has(sessionId)
                && (event.phase === "connecting" || event.phase === "authenticating");
              const phase = isReconnectTransition ? "reconnecting" : event.phase;
              const attempt = event.phase === "connecting"
                ? session.connectionStatus.attempt + 1
                : session.connectionStatus.attempt;
              if (event.phase === "connected" || event.phase === "failed" || event.phase === "disconnected") {
                reconnectingSessions.delete(sessionId);
              }
              shouldReconnectLocal = session.type === "local" && event.phase === "disconnected";
              return {
                ...session,
                connectionStatus: {
                  phase,
                  reason: event.reason,
                  technicalDetails: event.technicalDetails,
                  changedAt: now,
                  connectedAt: event.phase === "connected"
                    ? (session.connectionStatus.connectedAt ?? now)
                    : session.connectionStatus.connectedAt,
                  attempt,
                },
              };
            }),
          }));

          if (shouldReconnectLocal) {
            logger.info("FE/store/tabs/local-reconnect", `Local session ${sessionId} disconnected, recreating`);
            window.setTimeout(() => get().reconnectSession(sessionId), 0);
          }
        });
        stateUnsubscribers.set(sessionId, unsubscribe);
      };

      return {
        tabs: [],
        activeTabId: null,
        
        sessions: [],
        focusSessionId: null,
        connectionError: null,

        addSession: (sessionData, options) => {
          // 生成随机 ID
          const id = Math.random().toString(36).substring(2, 11);

          const connector = createConnector(sessionData as SessionCreationData, id);

          const newSession: TerminalSession = {
            ...sessionData,
            id,
            connector,
            connectionStatus: {
              phase: "idle",
              changedAt: Date.now(),
              attempt: 0,
            },
          };

          // 更新状态机
          set((state) => ({
            sessions: [...state.sessions, newSession],
            focusSessionId: id,
            connectionError: null,
          }));
          attachConnectionState(id, connector);

          // 通知生命周期回调（由 TabBar 处理 pane 创建）
          if (options?.notifyLifecycle !== false && sessionLifecycleCallbacks) {
            sessionLifecycleCallbacks.onSessionCreated(id);
          }

          // 异步打开 Tauri 侧的 PTY 进程
          connector.open().catch((error: unknown) => {
            logger.error("FE/store/tabs/open-error", getOpenFailureLogLabel(sessionData.type), {error});

            const errorPresentation = getConnectionErrorPresentation(sessionData.type, error);

            set((state) => {
              const sessionExists = state.sessions.some((session) => session.id === id);
              if (!sessionExists) {
                return state;
              }

              return {
                sessions: state.sessions.map((session) => session.id === id ? {
                  ...session,
                  connectionStatus: {
                    ...session.connectionStatus,
                    phase: "failed",
                    reason: errorPresentation.summary,
                    technicalDetails: errorPresentation.technicalDetails,
                    changedAt: Date.now(),
                  },
                } : session),
                connectionError: {
                  sessionId: id,
                  sessionTitle: sessionData.title,
                  sessionType: sessionData.type,
                  sessionTarget: getSessionTargetLabel(sessionData),
                  summary: errorPresentation.summary,
                  guidance: errorPresentation.guidance,
                  technicalDetails: errorPresentation.technicalDetails,
                },
              };
            });
          });

          // 返回新创建的会话 ID
          return id;
        },

        removeSession: (id, options) => {
          const targetSession = get().sessions.find(s => s.id === id);
          const remainingCount = get().sessions.length - 1;
          stateUnsubscribers.get(id)?.();
          stateUnsubscribers.delete(id);
          reconnectingSessions.delete(id);
          
          // 1. 先触发连接器的资源回收逻辑（通知 Rust 关闭进程）
          if (targetSession?.connector) {
            targetSession.connector.close();
          }

          // 2. 先更新状态，计算新的焦点会话
          let nextFocusId: string | null = null;
          
          set((state) => {
            const newSessions = state.sessions.filter(s => s.id !== id);
            let newFocusId = state.focusSessionId;

            // 处理焦点状态切换逻辑
            if (state.focusSessionId === id) {
              newFocusId = newSessions.length > 0 
                ? newSessions[newSessions.length - 1].id 
                : null;
            }

            // 保存新的焦点 ID 用于后续回调
            nextFocusId = newFocusId;

            return {
              sessions: newSessions,
              focusSessionId: newFocusId,
            };
          });

          // 3. 通知生命周期回调（状态更新后触发，确保 TabBar 能获取最新状态）
          if (options?.notifyLifecycle !== false && sessionLifecycleCallbacks) {
            sessionLifecycleCallbacks.onSessionRemoved(id);
            
            if (remainingCount === 0) {
              sessionLifecycleCallbacks.onAllSessionsClosed();
            } else if (nextFocusId) {
              // 焦点会话变化，通知 TabBar 重新绑定 pane
              sessionLifecycleCallbacks.onFocusSessionChanged(nextFocusId);
            }
          }
        },

        addTab: (tabData) => {
          const id = tabData.id || Math.random().toString(36).substring(2, 11);
          const title = tabData.title || "Terminal";
          
          set((state) => ({
            tabs: [...state.tabs, { id, title }],
            activeTabId: id,
          }));
          return id;
        },

        removeTab: (id) => {
          set((state) => {
            const newTabs = state.tabs.filter(t => t.id !== id);
            let newActiveId = state.activeTabId;
            if (state.activeTabId === id) {
              newActiveId = getNextTabId(state.tabs, id);
            }
            return {
              tabs: newTabs,
              activeTabId: newActiveId,
            };
          });
        },

        setActiveTabId: (id) => {
          set({ activeTabId: id });
        },

        updateTab: (id, updates) => {
          set((state) => ({
            tabs: state.tabs.map((tab) =>
              tab.id === id ? { ...tab, ...updates } : tab
            ),
          }));
        },

        reorderTabs: (orderedIds) => {
          set((state) => {
            const tabMap = new Map(state.tabs.map(t => [t.id, t]));
            const reordered = orderedIds.map(id => tabMap.get(id)).filter((t): t is TabWorkspace => t !== undefined);
            if (reordered.length !== state.tabs.length) return state;
            return { tabs: reordered };
          });
        },

        closeOtherTabs: (id) => {
          set((state) => {
            const newTabs = state.tabs.filter(t => t.id === id);
            return {
              tabs: newTabs,
              activeTabId: id,
            };
          });
        },

        closeLeftTabs: (id) => {
          set((state) => {
            const index = state.tabs.findIndex(t => t.id === id);
            if (index <= 0) return state;
            const newTabs = state.tabs.slice(index);
            return {
              tabs: newTabs,
              activeTabId: state.activeTabId && newTabs.some(t => t.id === state.activeTabId) ? state.activeTabId : id,
            };
          });
        },

        closeRightTabs: (id) => {
          set((state) => {
            const index = state.tabs.findIndex(t => t.id === id);
            if (index === -1 || index === state.tabs.length - 1) return state;
            const newTabs = state.tabs.slice(0, index + 1);
            return {
              tabs: newTabs,
              activeTabId: state.activeTabId && newTabs.some(t => t.id === state.activeTabId) ? state.activeTabId : id,
            };
          });
        },

        closeAllTabs: () => {
          set({ tabs: [], activeTabId: null });
        },

        setFocusSession: (id) => {
          set({ focusSessionId: id });
        },

        updateSession: (id, updates) => {
          set((state) => ({
            sessions: state.sessions.map(session =>
              session.id === id ? { ...session, ...updates } : session
            ),
          }));
        },

        getAllConnectors: () => {
          return get().sessions
            .map(session => session.connector)
            .filter((connector): connector is ITerminalConnector => connector !== undefined && connector.protocol !== "rdp" && connector.protocol !== "vnc");
        },

        reconnectSession: (sessionId) => {
          const currentSession = get().sessions.find((session) => session.id === sessionId);
          if (!currentSession) {
            logger.error("FE/store/tabs/reconnect", `Session ${sessionId} not found`);
            return;
          }

          stateUnsubscribers.get(sessionId)?.();
          currentSession.connector?.close();
          reconnectingSessions.add(sessionId);
          const newConnector = createConnector(currentSession as SessionCreationData, sessionId);
          set((state) => ({
            sessions: state.sessions.map((session) => session.id === sessionId ? {
              ...session,
              connector: newConnector,
              connectionStatus: {
                ...session.connectionStatus,
                phase: "reconnecting",
                reason: undefined,
                technicalDetails: undefined,
                changedAt: Date.now(),
              },
            } : session),
            connectionError: null,
          }));
          attachConnectionState(sessionId, newConnector);
          newConnector.open().catch((error: unknown) => {
            logger.error("FE/store/tabs/reconnect", "Failed to reconnect session", { error });
          });
        },

        clearConnectionError: () => {
          set({ connectionError: null });
        },

      };
    }
);

// 为兼容旧代码，添加 getter 拦截
Object.defineProperty(useTabsStore.getState(), 'activeSessionId', {
  get() {
    return this.focusSessionId;
  },
  set(value: string | null) {
    this.focusSessionId = value;
  },
  configurable: true,
});
