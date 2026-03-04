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

/**
 * 状态机接口定义
 */
interface TabsState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
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
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,

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
              shell: sessionData.config?.shell
            });
            break;
          case "ssh":
            // 使用 SSH 连接器
            if (!sessionData.config?.sshConfig) {
              throw new Error("SSH 配置不能为空");
            }
            connector = new SshConnector(sessionData.config.sshConfig);
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
        }));

        // 异步打开 Tauri 侧的 PTY 进程
        connector.open().catch((error: unknown) => {
          console.error("[Tauri] 终端进程创建失败:", error);
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
