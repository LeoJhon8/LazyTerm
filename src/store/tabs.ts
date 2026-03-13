import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ITerminalConnector, RDPConfig, SessionConnector, SSHConfig } from "@/types/terminal";
import { LocalConnector } from "@/connectors/LocalConnector";
import { SshConnector } from "@/connectors/SshConnector";
import { RdpConnector } from "@/connectors/RdpConnector";

/**
 * 终端会话配置接口
 */
export interface SessionConfig {
  cwd?: string;
  shell?: string;
  host?: string;
  port?: number;
  sshConfig?: SSHConfig;
  rdpConfig?: RDPConfig;
  admin?: boolean;
}

/**
 * 终端会话对象定义
 */
export interface TerminalSession {
  id: string;
  title: string;
  type: "local" | "ssh" | "telnet" | "rdp";
  /** 连接器实例（仅存在于内存中，不持久化） */
  connector?: SessionConnector;
  cwd?: string;
  host?: string;
  config?: SessionConfig;
}

export interface SessionConnectionError {
  sessionId: string;
  sessionTitle: string;
  sessionType: TerminalSession["type"];
  sessionTarget?: string;
  summary: string;
  guidance: string[];
  technicalDetails: string;
}

interface ConnectionErrorPresentation {
  summary: string;
  guidance: string[];
  technicalDetails: string;
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

  if (sessionData.type === "rdp") {
    const rdpConfig = sessionData.config?.rdpConfig;
    if (rdpConfig?.host && rdpConfig.port) {
      return `${rdpConfig.host}:${rdpConfig.port}`;
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

function buildRdpErrorPresentation(technicalDetails: string): ConnectionErrorPresentation {
  const normalized = technicalDetails.toLowerCase();

  if (normalized.includes("仅支持密码认证")) {
    return {
      summary: "当前 RDP 连接只支持密码认证。",
      guidance: [
        "请填写密码后重新连接。",
        "如果目标环境依赖其它认证方式，需要继续扩展后端认证支持。",
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("lookup addr failed") || normalized.includes("socket address not found") || normalized.includes("invalid server name")) {
    return {
      summary: "目标主机地址无法解析。",
      guidance: [
        "检查主机名或 IP 是否填写正确。",
        "如果使用域名，确认本机 DNS 可以解析该地址。",
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("tcp connect failed")) {
    if (normalized.includes("10061") || normalized.includes("actively refused")) {
      return {
        summary: "目标主机拒绝了远程桌面连接。",
        guidance: [
          "确认目标主机已启用远程桌面服务。",
          "确认端口填写正确，默认通常为 3389。",
          "检查目标主机防火墙是否允许该端口。",
        ],
        technicalDetails,
      };
    }

    return {
      summary: "无法连接到远程桌面主机。",
      guidance: [
        "确认目标主机在线且网络可达。",
        "确认端口填写正确，默认通常为 3389。",
        "检查防火墙、安全组或 NAT 转发是否放通该端口。",
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("tls handshake") || normalized.includes("begin connection failed")) {
    return {
      summary: "已连到目标端口，但远端没有完成远程桌面握手。",
      guidance: [
        "确认该端口对应的是 RDP 服务，而不是其它协议。",
        "确认 Windows 远程桌面服务已启用。",
        "如果经过代理或端口映射，确认它没有截断 TLS 或 RDP 协商。",
      ],
      technicalDetails,
    };
  }

  if (normalized.includes("credssp") || normalized.includes("logon") || normalized.includes("authentication") || normalized.includes("finalize connection failed")) {
    return {
      summary: "远程桌面握手已进入认证阶段，但认证或会话初始化没有通过。",
      guidance: [
        "检查用户名、密码和域是否正确。",
        "确认服务器允许该账号使用远程桌面登录。",
        "如果服务器策略限制了 NLA 或加密方式，需要核对目标端配置。",
      ],
      technicalDetails,
    };
  }

  return {
    summary: "远程桌面连接未能建立。",
    guidance: [
      "先确认地址、端口和账号配置正确。",
      "再检查目标主机远程桌面服务和网络连通性。",
    ],
    technicalDetails,
  };
}

function buildSshErrorPresentation(technicalDetails: string): ConnectionErrorPresentation {
  return {
    summary: "SSH 连接未能建立。",
    guidance: [
      "检查主机、端口和认证信息是否正确。",
      "确认服务器 SSH 服务已启动且网络可达。",
    ],
    technicalDetails,
  };
}

function buildLocalErrorPresentation(technicalDetails: string): ConnectionErrorPresentation {
  return {
    summary: "本地终端启动失败。",
    guidance: [
      "检查默认 Shell 路径是否存在。",
      "如果启用了管理员模式，确认当前系统允许内联提升。",
    ],
    technicalDetails,
  };
}

function getConnectionErrorPresentation(
  sessionType: TerminalSession["type"],
  error: unknown,
): ConnectionErrorPresentation {
  const technicalDetails = getConnectionErrorMessage(error);

  switch (sessionType) {
    case "rdp":
      return buildRdpErrorPresentation(technicalDetails);
    case "ssh":
      return buildSshErrorPresentation(technicalDetails);
    default:
      return buildLocalErrorPresentation(technicalDetails);
  }
}

function getOpenFailureLogLabel(sessionType: TerminalSession["type"]): string {
  switch (sessionType) {
    case "ssh":
      return "[Tauri] SSH 会话创建失败:";
    case "rdp":
      return "[Tauri] RDP 会话创建失败:";
    case "local":
      return "[Tauri] 终端进程创建失败:";
    default:
      return "[Tauri] 会话创建失败:";
  }
}

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
        
        let connector: SessionConnector;
        
        // 根据类型创建连接器代理
        switch (sessionData.type) {
          case "local":
            // 注意：在 Tauri 中，cwd 传 undefined 则 Rust 会默认使用系统用户目录
            connector = new LocalConnector({ 
              cwd: sessionData.cwd,
              shell: sessionData.config?.shell,
              admin: sessionData.config?.admin
            }, () => {
              const targetSession = get().sessions.find((session) => session.id === id);
              if (!shouldReconnectLocalSession(targetSession)) {
                return;
              }

              console.log(`[Store] Local session ${id} disconnected, recreating connector...`);
              get().switchConnector(id, "local");
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
          case "rdp":
            if (!sessionData.config?.rdpConfig) {
              throw new Error("RDP 配置不能为空");
            }
            connector = new RdpConnector(sessionData.config.rdpConfig);
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
          console.error(getOpenFailureLogLabel(sessionData.type), error);

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
          .filter((connector): connector is ITerminalConnector => connector !== undefined && connector.protocol !== "rdp");
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
            }, () => {
              const targetSession = get().sessions.find((session) => session.id === sessionId);
              if (!shouldReconnectLocalSession(targetSession)) {
                return;
              }

              console.log(`[Store] Local session ${sessionId} disconnected, recreating connector...`);
              get().switchConnector(sessionId, "local");
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
