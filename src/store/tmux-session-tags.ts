import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { appStorage } from "@/services/appStorage";
import { useTabsStore, type TerminalSession } from "@/store/tabs";
import type { SessionConnector, SSHConfig, SshTmuxSessionInfo } from "@/types/terminal";

export interface TmuxSessionTagTarget {
  key: string;
  name: string;
}

export function getTmuxSessionTagsKey(
  ssh: Pick<SSHConfig, "host" | "port" | "username">,
  session: Pick<SshTmuxSessionInfo, "name" | "createdAt">,
): string {
  return JSON.stringify([ssh.host.trim().toLowerCase(), ssh.port, ssh.username, session.name, session.createdAt]);
}

export function isConnectedTmuxSession(session: TerminalSession): boolean {
  return session.type === "ssh"
    && session.sshTmuxPersistenceActive === true
    && session.connectionStatus.phase === "connected";
}

export function getConnectedTmuxTagTarget(session: TerminalSession): TmuxSessionTagTarget | null {
  const { sshTmuxSessionName: name, sshTmuxSessionCreatedAt: createdAt } = session;
  const sshConfig = session.config?.sshConfig;
  if (!isConnectedTmuxSession(session) || !sshConfig || !name || createdAt === undefined) return null;

  return { name, key: getTmuxSessionTagsKey(sshConfig, { name, createdAt }) };
}

const pendingLookups = new WeakMap<SessionConnector, Promise<void>>();

export async function loadConnectedTmuxTagTarget(sessionId: string): Promise<void> {
  const findSession = () => useTabsStore.getState().sessions.find((session) => session.id === sessionId);
  const session = findSession();
  if (!session || !isConnectedTmuxSession(session) || session.sshTmuxSessionCreatedAt !== undefined) return;

  const { connector, sshTmuxSessionName: name } = session;
  if (!name || !session.config?.sshConfig || !connector?.isConnected || !connector.checkTmuxCapability) return;

  const pending = pendingLookups.get(connector);
  if (pending) return pending;

  const lookup = connector.checkTmuxCapability().then(({ sessions }) => {
    const tmux = sessions.find((candidate) => candidate.name === name);
    const latest = findSession();
    if (!tmux || !latest || latest.connector !== connector || latest.sshTmuxSessionName !== name || !isConnectedTmuxSession(latest)) {
      return;
    }

    useTabsStore.getState().updateSession(sessionId, { sshTmuxSessionCreatedAt: tmux.createdAt });
  }).catch(() => {
    // 查询失败时保留原提示，下一次悬停或打开编辑器时可重试。
  }).finally(() => pendingLookups.delete(connector));
  pendingLookups.set(connector, lookup);
  return lookup;
}

interface TmuxSessionTagsState {
  tagsBySession: Record<string, string[]>;
  setTags: (key: string, tags: string[]) => void;
}

export const useTmuxSessionTagsStore = create<TmuxSessionTagsState>()(
  persist(
    (set) => ({
      tagsBySession: {},
      setTags: (key, tags) => set((state) => {
        const tagsBySession = { ...state.tagsBySession };
        if (tags.length > 0) {
          tagsBySession[key] = tags;
        } else {
          delete tagsBySession[key];
        }
        return { tagsBySession };
      }),
    }),
    {
      name: "lazy-term-tmux-session-tags",
      storage: createJSONStorage(() => appStorage),
      partialize: ({ tagsBySession }) => ({ tagsBySession }),
    },
  ),
);
