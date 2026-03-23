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

function getNextActiveSessionId(sessions: TerminalSession[], removedId: string): string | null {
  const remainingSessions = sessions.filter((session) => session.id !== removedId);
  return remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1].id : null;
}

function closeSessionsByIds(
  sessions: TerminalSession[],
  idsToClose: Set<string>,
  activeSessionId: string | null,
  fallbackActiveId: string | null
) {
  if (idsToClose.size === 0) {
    return {
      sessions,
      activeSessionId,
    };
  }

  sessions.forEach((session) => {
    if (idsToClose.has(session.id)) {
      session.connector?.close();
    }
  });

  const remainingSessions = sessions.filter((session) => !idsToClose.has(session.id));
  const nextActiveId = activeSessionId && !idsToClose.has(activeSessionId)
    ? activeSessionId
    : (fallbackActiveId && remainingSessions.some((session) => session.id === fallbackActiveId)
        ? fallbackActiveId
        : (remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1].id : null));

  return {
    sessions: remainingSessions,
    activeSessionId: nextActiveId,
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
  activeSessionId: string | null;
  connectionError: SessionConnectionError | null;
  /** 添加新会话 */
  addSession: (sessionData: Omit<TerminalSession, "id" | "connector">) => void;
  /** 移除会话 */
  removeSession: (id: string) => void;
  /** 设置当前激活的会话 */
  setActiveSession: (id: string) => void;
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
          activeSessionId: id,
          connectionError: null,
        }));

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
              sessions: state.sessions.filter((session) => session.id !== id),
              activeSessionId: state.activeSessionId === id
                ? getNextActiveSessionId(state.sessions, id)
                : state.activeSessionId,
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
      },

      removeSession: (id) => {
        const targetSession = get().sessions.find(s => s.id === id);
        
        // 1. 先触发连接器的资源回收逻辑（通知 Rust 关闭进程）
        if (targetSession?.connector) {
          targetSession.connector.close();
        }

        // 2. 更新状态
        set((state) => {
          const newSessions = state.sessions.filter(s => s.id !== id);
          let nextActiveId = state.activeSessionId;

          // 处理激活状态切换逻辑
          if (state.activeSessionId === id) {
            nextActiveId = newSessions.length > 0 
              ? newSessions[newSessions.length - 1].id 
              : null;
          }

          return {
            sessions: newSessions,
            activeSessionId: nextActiveId,
          };
        });
      },

      setActiveSession: (id) => {
        set({ activeSessionId: id });
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

          return closeSessionsByIds(state.sessions, idsToClose, state.activeSessionId, id);
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

          return closeSessionsByIds(state.sessions, idsToClose, state.activeSessionId, id);
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

          return closeSessionsByIds(state.sessions, idsToClose, state.activeSessionId, id);
        });
      },

      closeAllSessions: () => {
        // 关闭所有连接
        get().sessions.forEach(session => {
          session.connector?.close();
        });

        set({
          sessions: [],
          activeSessionId: null,
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

          const nextSession: Omit<TerminalSession, "id" | "connector"> = {
            ...oldSession,
            type: newType,
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
            connector: newConnector,
          };

          logger.info("FE/store/tabs/switch", `Switched session ${sessionId} from ${oldSession.type} to ${newType}`);

          // 异步打开新连接
          newConnector.open().catch((error: unknown) => {
            logger.error("FE/store/tabs/switch", "Failed to open new connector", {error});
          });

          // 强制触发终端重新初始化：通过修改 session 对象触发 React 重新渲染
          // 不直接操作 activeSessionId，而是通过更改 connector 引用来触发 TerminalView 重建
          // TerminalView 的 useEffect 依赖 activeSession，当 connector 变化时会重新初始化

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
        activeSessionId: state.activeSessionId,
      }),
    }
  )
);
