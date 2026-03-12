import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ITerminalConnector, SSHConfig } from "@/types/terminal";
import { LocalConnector } from "@/connectors/LocalConnector";
import { SshConnector } from "@/connectors/SshConnector";

/**
 * 终端会话配置接口
 */
export interface SessionConfig {
  cwd?: string;
  shell?: string;
  host?: string;
  port?: number;
  sshConfig?: SSHConfig;
  admin?: boolean;
}

/**
 * 终端会话对象定义
 */
export interface TerminalSession {
  id: string;
  title: string;
  type: "local" | "ssh" | "telnet";
  /** 连接器实例（仅存在于内存中，不持久化） */
  connector?: ITerminalConnector; 
  cwd?: string;
  host?: string;
  config?: SessionConfig;
}

export interface SessionConnectionError {
  sessionId: string;
  sessionTitle: string;
  sessionType: TerminalSession["type"];
  sessionTarget?: string;
  message: string;
}

function getSessionTargetLabel(sessionData: Omit<TerminalSession, "id" | "connector">): string | undefined {
  if (sessionData.type === "ssh") {
    const sshConfig = sessionData.config?.sshConfig;
    if (sshConfig?.username && sshConfig.host && sshConfig.port) {
      return `${sshConfig.username}@${sshConfig.host}:${sshConfig.port}`;
    }

    if (sessionData.host && sessionData.config?.port) {
      return `${sessionData.host}:${sessionData.config.port}`;
    }
  }

  return undefined;
}

function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (typeof error === "object" && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "未获取到后端返回的详细错误信息。";
}

function getNextActiveSessionId(sessions: TerminalSession[], removedId: string): string | null {
  const remainingSessions = sessions.filter((session) => session.id !== removedId);
  return remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1].id : null;
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
  /** 关闭除指定 ID 外的其他会话 */
  closeOtherSessions: (id: string) => void;
  /** 关闭所有会话 */
  closeAllSessions: () => void;
  /** 获取所有会话的连接器 */
  getAllConnectors: () => ITerminalConnector[];
  /** 切换会话的连接器（用于 SSH 超时后切换到本地） */
  switchConnector: (sessionId: string, newType: "local" | "ssh") => void;
  /** 清除最近一次连接失败提示 */
  clearConnectionError: () => void;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      connectionError: null,

      addSession: (sessionData) => {
        // 生成随机 ID
        const id = Math.random().toString(36).substring(2, 11);
        
        let connector: ITerminalConnector;
        
        // 根据类型创建连接器代理
        switch (sessionData.type) {
          case "local":
            // 注意：在 Tauri 中，cwd 传 undefined 则 Rust 会默认使用系统用户目录
            connector = new LocalConnector({ 
              cwd: sessionData.cwd,
              shell: sessionData.config?.shell,
              admin: sessionData.config?.admin
            });
            break;
          case "ssh":
            // 使用 SSH 连接器，注册断开连接回调
            if (!sessionData.config?.sshConfig) {
              throw new Error("SSH 配置不能为空");
            }
            connector = new SshConnector(
              sessionData.config.sshConfig,
              () => {
                // SSH 断开连接时自动切换到本地连接
                console.log(`[Store] SSH disconnected for session ${id}, switching to local...`);
                get().switchConnector(id, "local");
              }
            );
            break;
          case "telnet":
            throw new Error("Telnet 连接器目前尚未实现");
          default:
            throw new Error(`不支持的连接类型：${sessionData.type}`);
        }

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
          console.error("[Tauri] 终端进程创建失败:", error);

          const errorMessage = getConnectionErrorMessage(error);

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
                message: errorMessage,
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

      closeOtherSessions: (id) => {
        // 关闭非当前 ID 的所有连接器
        get().sessions.forEach(session => {
          if (session.id !== id && session.connector) {
            session.connector.close();
          }
        });

        set((state) => ({
          sessions: state.sessions.filter(session => session.id === id),
          activeSessionId: id,
        }));
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
          .filter((connector): connector is ITerminalConnector => connector !== undefined);
      },

      switchConnector: (sessionId, newType) => {
        set((state) => {
          const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
          if (sessionIndex === -1) {
            console.error(`Session ${sessionId} not found`);
            return state;
          }

          const oldSession = state.sessions[sessionIndex];
          const title = oldSession.title; // 保持标题不变
          
          // 关闭旧的连接器（释放后端资源）
          if (oldSession.connector) {
            console.log(`[Store] Closing old connector for session ${sessionId}...`);
            oldSession.connector.close();
          }

          // 创建新的连接器
          let newConnector: ITerminalConnector;
          if (newType === "local") {
            newConnector = new LocalConnector({ 
              cwd: oldSession.config?.cwd,
              shell: oldSession.config?.shell
            });
          } else if (newType === "ssh") {
            if (!oldSession.config?.sshConfig) {
              throw new Error("SSH 配置不能为空");
            }
            newConnector = new SshConnector(oldSession.config.sshConfig);
          } else {
            throw new Error(`不支持的连接类型：${newType}`);
          }

          // 更新会话
          const newSessions = [...state.sessions];
          newSessions[sessionIndex] = {
            ...oldSession,
            type: newType,
            connector: newConnector,
          };

          console.log(`[Store] Switched session ${sessionId} from ${oldSession.type} to ${newType}, title remains: ${title}`);

          // 异步打开新连接
          newConnector.open().catch((error: unknown) => {
            console.error("[Tauri] 切换连接器后创建失败:", error);
          });

          // 强制触发终端重新初始化：通过修改 session 对象触发 React 重新渲染
          // 不直接操作 activeSessionId，而是通过更改 connector 引用来触发 TerminalView 重建
          // TerminalView 的 useEffect 依赖 activeSession，当 connector 变化时会重新初始化

          return {
            sessions: newSessions,
          };
        });
      },

      clearConnectionError: () => {
        set({ connectionError: null });
      },
    }),
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
