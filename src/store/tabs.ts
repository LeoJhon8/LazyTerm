import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ITerminalConnector, SessionConnector } from "@/types/terminal";
import { logger } from "@/lib/logger";
import { createConnector, type SessionCreationData } from "@/connectors/ConnectorFactory";
import {
  getConnectionErrorPresentation,
  getOpenFailureLogLabel,
  getSessionTargetLabel,
  type SessionConnectionError,
} from "@/services/connectionErrorService";
import { useSettingsStore } from "@/store/settings";

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
  type: "local" | "ssh" | "rdp" | "vnc";
  /** 连接器实例（仅存在于内存中，不持久化） */
  connector?: SessionConnector;
  cwd?: string;
  host?: string;
  config?: SessionConfig;
}

// SessionConnectionError 类型从 connectionErrorService 导入
export type { SessionConnectionError };

function getNextFocusSessionId(sessions: TerminalSession[], removedId: string): string | null {
  const remainingSessions = sessions.filter((session) => session.id !== removedId);
  return remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1].id : null;
}

function closeSessionsByIds(
  sessions: TerminalSession[],
  idsToClose: Set<string>,
  focusSessionId: string | null,
  activeSessionIds: string[],
  fallbackActiveId: string | null
) {
  if (idsToClose.size === 0) {
    return {
      sessions,
      focusSessionId,
      activeSessionIds,
    };
  }

  sessions.forEach((session) => {
    if (idsToClose.has(session.id)) {
      session.connector?.close();
    }
  });

  // 通知生命周期回调（由 TabBar 处理 pane 移除）
  if (sessionLifecycleCallbacks) {
    idsToClose.forEach(id => {
      sessionLifecycleCallbacks!.onSessionRemoved(id);
    });
  }

  const remainingSessions = sessions.filter((session) => !idsToClose.has(session.id));
  
  // 计算下一个焦点会话
  const nextFocusId = focusSessionId && !idsToClose.has(focusSessionId)
    ? focusSessionId
    : (fallbackActiveId && remainingSessions.some((session) => session.id === fallbackActiveId)
        ? fallbackActiveId
        : (remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1].id : null));

  // 从 activeSessionIds 中移除已关闭的会话
  const nextActiveIds = activeSessionIds.filter(id => !idsToClose.has(id) && remainingSessions.some(s => s.id === id));

  return {
    sessions: remainingSessions,
    focusSessionId: nextFocusId,
    activeSessionIds: nextActiveIds,
  };
}

function shouldReconnectLocalSession(session: TerminalSession | undefined): boolean {
  return !!session && session.type === "local";
}

/**
 * 状态机接口定义
 */
interface TabsState {
  sessions: TerminalSession[];
  /** 
   * 【兼容字段】原有 activeSessionId，现已拆分为 focusSessionId 和 activeSessionIds
   * 该字段现为 getter，映射到 focusSessionId
   * @deprecated 请使用 focusSessionId 或 activeSessionIds
   */
  activeSessionId: string | null;
  /** 
   * 操作权（焦点）：决定快捷命令栏和历史命令栏的发送目标
   * 无论屏幕上显示多少个会话，用户输入的指令只发送给 focusSessionId 指向的会话
   */
  focusSessionId: string | null;
  /** 
   * 显示权（列表）：管理屏幕上同时可见的会话集合
   * 当前仅支持单会话显示，未来可扩展为多会话分屏
   */
  activeSessionIds: string[];
  connectionError: SessionConnectionError | null;
  /** 
   * 添加新会话
   * @returns 新创建的会话 ID
   */
  addSession: (sessionData: Omit<TerminalSession, "id" | "connector">) => string;
  /** 移除会话 */
  removeSession: (id: string) => void;
  /**
   * 【兼容方法】设置当前激活的会话
   * @deprecated 请使用 setFocusSession 或 updateActiveSessions
   */
  setActiveSession: (id: string) => void;
  /** 
   * 设置焦点会话（操作权）
   * 决定快捷命令和历史命令的发送目标
   */
  setFocusSession: (id: string | null) => void;
  /** 
   * 设置显示会话列表（显示权）
   * 决定屏幕上哪些会话可见
   */
  setActiveSessionIds: (ids: string[]) => void;
  /** 
   * 更新活跃会话列表（添加/移除）
   */
  toggleActiveSession: (id: string) => void;
  /** 更新会话基础信息（如标题） */
  updateSession: (id: string, updates: Partial<Omit<TerminalSession, "id" | "connector">>) => void;
  /** 调整会话顺序 */
  reorderSessions: (orderedIds: string[]) => void;
  /** 关闭除指定 ID 外的其他会话 */
  closeOtherSessions: (id: string) => void;
  /** 关闭指定标签左侧的所有会话 */
  closeLeftSessions: (id: string) => void;
  /** 关闭指定标签右侧的所有会话 */
  closeRightSessions: (id: string) => void;
  /** 关闭所有会话 */
  closeAllSessions: () => void;
  /** 获取所有会话的连接器 */
  getAllConnectors: () => ITerminalConnector[];
  /** 切换会话的连接器（用于 SSH 超时后切换到本地） */
  switchConnector: (sessionId: string, newType: "local" | "ssh") => void;
  /** 在当前标签内重新建立连接 */
  reconnectSession: (sessionId: string) => void;
  /** 清除最近一次连接失败提示 */
  clearConnectionError: () => void;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => {
      const handleLocalDisconnect = (targetSessionId: string) => {
        const targetSession = get().sessions.find((session) => session.id === targetSessionId);
        if (!shouldReconnectLocalSession(targetSession)) {
          return;
        }

        logger.info("FE/store/tabs/local-reconnect", `Local session ${targetSessionId} disconnected, recreating`);
        get().switchConnector(targetSessionId, "local");
      };

      const handleSshDisconnect = (targetSessionId: string) => {
        logger.info("FE/store/tabs/ssh-fallback", `SSH disconnected for session ${targetSessionId}, switching to local`);
        get().switchConnector(targetSessionId, "local");
      };

      return {
        sessions: [],
        activeSessionId: null,
        focusSessionId: null,
        activeSessionIds: [],
        connectionError: null,

        addSession: (sessionData) => {
          // 生成随机 ID
          const id = Math.random().toString(36).substring(2, 11);

          const connector = createConnector(
            sessionData as SessionCreationData,
            id,
            sessionData.type === "local" ? handleLocalDisconnect : handleSshDisconnect,
          );

          const newSession: TerminalSession = {
            ...sessionData,
            id,
            connector,
          };

          // 更新状态机
          set((state) => ({
            sessions: [...state.sessions, newSession],
            focusSessionId: id,
            activeSessionIds: [id],
            connectionError: null,
          }));

          // 通知生命周期回调（由 TabBar 处理 pane 创建）
          if (sessionLifecycleCallbacks) {
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

              const newSessions = state.sessions.filter((session) => session.id !== id);
              const wasFocus = state.focusSessionId === id;
              const wasInActive = state.activeSessionIds.includes(id);

              // 通知生命周期回调（由 TabBar 处理 pane 移除）
              if (sessionLifecycleCallbacks) {
                sessionLifecycleCallbacks.onSessionRemoved(id);
              }

              return {
                sessions: newSessions,
                focusSessionId: wasFocus ? getNextFocusSessionId(state.sessions, id) : state.focusSessionId,
                activeSessionIds: wasInActive 
                  ? state.activeSessionIds.filter(sid => sid !== id)
                  : state.activeSessionIds,
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

        removeSession: (id) => {
          const targetSession = get().sessions.find(s => s.id === id);
          const remainingCount = get().sessions.length - 1;
          
          // 1. 先触发连接器的资源回收逻辑（通知 Rust 关闭进程）
          if (targetSession?.connector) {
            targetSession.connector.close();
          }

          // 2. 先更新状态，计算新的焦点会话
          let nextFocusId: string | null = null;
          
          set((state) => {
            const newSessions = state.sessions.filter(s => s.id !== id);
            let newFocusId = state.focusSessionId;
            let nextActiveIds = state.activeSessionIds.filter(sid => sid !== id);

            // 处理焦点状态切换逻辑
            if (state.focusSessionId === id) {
              newFocusId = newSessions.length > 0 
                ? newSessions[newSessions.length - 1].id 
                : null;
            }

            // 确保 activeSessionIds 中移除已关闭的会话
            nextActiveIds = nextActiveIds.filter(sid => newSessions.some(s => s.id === sid));

            // 如果没有活跃会话了，但有焦点会话，将焦点会话加入活跃列表
            if (nextActiveIds.length === 0 && newFocusId) {
              nextActiveIds = [newFocusId];
            }

            // 保存新的焦点 ID 用于后续回调
            nextFocusId = newFocusId;

            return {
              sessions: newSessions,
              focusSessionId: newFocusId,
              activeSessionIds: nextActiveIds,
            };
          });

          // 3. 通知生命周期回调（状态更新后触发，确保 TabBar 能获取最新状态）
          if (sessionLifecycleCallbacks) {
            sessionLifecycleCallbacks.onSessionRemoved(id);
            
            if (remainingCount === 0) {
              sessionLifecycleCallbacks.onAllSessionsClosed();
            } else if (nextFocusId) {
              // 焦点会话变化，通知 TabBar 重新绑定 pane
              sessionLifecycleCallbacks.onFocusSessionChanged(nextFocusId);
            }
          }
        },

        // 兼容方法：映射到 setFocusSession
        setActiveSession: (id) => {
          set({ 
            focusSessionId: id,
            activeSessionIds: [id],
          });
        },

        setFocusSession: (id) => {
          set({ focusSessionId: id });
        },

        setActiveSessionIds: (ids) => {
          set({ activeSessionIds: ids });
        },

        toggleActiveSession: (id) => {
          set((state) => {
            const isActive = state.activeSessionIds.includes(id);
            let nextActiveIds: string[];
            
            if (isActive) {
              // 移除该会话
              nextActiveIds = state.activeSessionIds.filter(sid => sid !== id);
              // 如果移除后为空，但有焦点会话，则保留焦点会话
              if (nextActiveIds.length === 0 && state.focusSessionId) {
                nextActiveIds = [state.focusSessionId];
              }
            } else {
              // 添加该会话
              nextActiveIds = [...state.activeSessionIds, id];
            }
            
            return { activeSessionIds: nextActiveIds };
          });
        },

        updateSession: (id, updates) => {
          set((state) => ({
            sessions: state.sessions.map(session =>
              session.id === id ? { ...session, ...updates } : session
            ),
          }));
        },

        reorderSessions: (orderedIds) => {
          set((state) => {
            if (orderedIds.length !== state.sessions.length) {
              return state;
            }

            const sessionMap = new Map(state.sessions.map((session) => [session.id, session]));
            const reorderedSessions = orderedIds
              .map((id) => sessionMap.get(id))
              .filter((session): session is TerminalSession => session !== undefined);

            if (reorderedSessions.length !== state.sessions.length) {
              return state;
            }

            return {
              sessions: reorderedSessions,
            };
          });
        },

        closeOtherSessions: (id) => {
          set((state) => {
            const idsToClose = new Set(
              state.sessions
                .filter((session) => session.id !== id)
                .map((session) => session.id)
            );

            return closeSessionsByIds(state.sessions, idsToClose, state.focusSessionId, state.activeSessionIds, id);
          });
        },

        closeLeftSessions: (id) => {
          set((state) => {
            const targetIndex = state.sessions.findIndex((session) => session.id === id);
            if (targetIndex <= 0) {
              return state;
            }

            const idsToClose = new Set(
              state.sessions.slice(0, targetIndex).map((session) => session.id)
            );

            return closeSessionsByIds(state.sessions, idsToClose, state.focusSessionId, state.activeSessionIds, id);
          });
        },

        closeRightSessions: (id) => {
          set((state) => {
            const targetIndex = state.sessions.findIndex((session) => session.id === id);
            if (targetIndex === -1 || targetIndex >= state.sessions.length - 1) {
              return state;
            }

            const idsToClose = new Set(
              state.sessions.slice(targetIndex + 1).map((session) => session.id)
            );

            return closeSessionsByIds(state.sessions, idsToClose, state.focusSessionId, state.activeSessionIds, id);
          });
        },

        closeAllSessions: () => {
          // 关闭所有连接
          get().sessions.forEach(session => {
            session.connector?.close();
          });

          // 通知生命周期回调（由 TabBar 处理 pane 清理）
          if (sessionLifecycleCallbacks) {
            sessionLifecycleCallbacks.onAllSessionsClosed();
          }

          set({
            sessions: [],
            focusSessionId: null,
            activeSessionIds: [],
          });
        },

        getAllConnectors: () => {
          return get().sessions
            .map(session => session.connector)
            .filter((connector): connector is ITerminalConnector => connector !== undefined && connector.protocol !== "rdp" && connector.protocol !== "vnc");
        },

        switchConnector: (sessionId, newType) => {
          set((state) => {
            const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
            if (sessionIndex === -1) {
              logger.error("FE/store/tabs/switch", `Session ${sessionId} not found`);
              return state;
            }

            const oldSession = state.sessions[sessionIndex];
            
            // 关闭旧的连接器（释放后端资源）
            if (oldSession.connector) {
              logger.debug("FE/store/tabs/switch", `Closing old connector for session ${sessionId}`);
              oldSession.connector.close();
            }

            // 降级到本地终端时，使用用户设置的默认 shell
            const { defaultShell } = useSettingsStore.getState();
            const nextConfig = newType === "local" 
              ? { ...oldSession.config, shell: defaultShell }
              : oldSession.config;

            const nextSession: Omit<TerminalSession, "id" | "connector"> = {
              ...oldSession,
              type: newType,
              config: nextConfig,
            };
            const nextConnector = createConnector(
              nextSession as SessionCreationData,
              sessionId,
              nextSession.type === "local" ? handleLocalDisconnect : handleSshDisconnect,
            );
            if (nextConnector.protocol === "rdp" || nextConnector.protocol === "vnc") {
              throw new Error(`不支持的连接类型：${newType}`);
            }
            const newConnector: ITerminalConnector = nextConnector;

            // 更新会话
            const newSessions = [...state.sessions];
            newSessions[sessionIndex] = {
              ...oldSession,
              type: newType,
              config: nextConfig,
              connector: newConnector,
            };

            logger.info("FE/store/tabs/switch", `Switched session ${sessionId} from ${oldSession.type} to ${newType}`);

            // 异步打开新连接
            newConnector.open().catch((error: unknown) => {
              logger.error("FE/store/tabs/switch", "Failed to open new connector", {error});
            });

            return {
              sessions: newSessions,
            };
          });
        },

        reconnectSession: (sessionId) => {
          set((state) => {
            const sessionIndex = state.sessions.findIndex((session) => session.id === sessionId);
            if (sessionIndex === -1) {
              logger.error("FE/store/tabs/reconnect", `Session ${sessionId} not found`);
              return state;
            }

            const currentSession = state.sessions[sessionIndex];
            currentSession.connector?.close();

            const newConnector = createConnector(
              currentSession as SessionCreationData,
              sessionId,
              currentSession.type === "local" ? handleLocalDisconnect : handleSshDisconnect,
            );
            const newSessions = [...state.sessions];
            newSessions[sessionIndex] = {
              ...currentSession,
              connector: newConnector,
            };

            newConnector.open().catch((error: unknown) => {
              logger.error("FE/store/tabs/reconnect", "Failed to reconnect session", {error});
            });

            return {
              sessions: newSessions,
              connectionError: null,
            };
          });
        },

        clearConnectionError: () => {
          set({ connectionError: null });
        },
      };
    },
    {
      name: "lazy-terminal-sessions",
      storage: createJSONStorage(() => localStorage),
      // 持久化白名单处理
      partialize: (state) => ({
        sessions: state.sessions.map((s) => {
          // 排除不可序列化的 connector 实例
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { connector, ...persistentData } = s;
          return {
            ...persistentData,
            // 记录配置以便下次手动或自动重连
            config: s.config || { cwd: s.cwd }
          };
        }),
        focusSessionId: state.focusSessionId,
        activeSessionIds: state.activeSessionIds,
      }),
    }
  )
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
