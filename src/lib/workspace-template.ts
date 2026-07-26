import {
  createLeaf,
  createSplit,
  getAllLeaves,
  type PaneNode,
} from "@/lib/pane-utils";
import type { NewTerminalSession } from "@/lib/session-launch";
import {
  secureConnectionConfig,
  useCredentialsStore,
} from "@/store/credentials";
import { usePanesStore } from "@/store/panes";
import {
  useTabsStore,
  type SessionConfig,
  type TerminalSession,
} from "@/store/tabs";
import type {
  RDPConfig,
  SSHConfig,
  VNCConfig,
} from "@/types/terminal";
import type {
  WorkspaceTemplateDefinition,
  WorkspaceTemplatePaneNode,
  WorkspaceTemplateSession,
} from "@/types/workspace-template";

export interface CaptureWorkspaceTemplateOptions {
  includeStartupCommands?: boolean;
}

export interface LaunchWorkspaceTemplateResult {
  tabId: string;
  missingCredentialSessionTitles: string[];
}

type WorkspaceTemplateErrorCode =
  | "workspace-not-found"
  | "workspace-not-split"
  | "session-not-found"
  | "credential-vault-unavailable"
  | "invalid-template";

export class WorkspaceTemplateError extends Error {
  readonly code: WorkspaceTemplateErrorCode;

  constructor(message: string, code: WorkspaceTemplateErrorCode) {
    super(message);
    this.name = "WorkspaceTemplateError";
    this.code = code;
  }
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertSessionConfig(
  session: TerminalSession,
  key: keyof SessionConfig,
): SessionConfig {
  if (!session.config?.[key]) {
    throw new WorkspaceTemplateError(
      `Session "${session.title}" has no "${key}" configuration.`,
      "invalid-template",
    );
  }
  return session.config;
}

async function secureRemoteSessionConfig(
  session: TerminalSession,
  includeStartupCommands: boolean,
): Promise<SessionConfig> {
  try {
    if (session.type === "ssh") {
      const config = assertSessionConfig(session, "sshConfig");
      const secured = await secureConnectionConfig(
        "ssh",
        config.sshConfig as SSHConfig,
      ) as SSHConfig;
      const sanitized: SSHConfig = {
        ...secured,
        password: undefined,
        privateKey: undefined,
        privateKeyPassphrase: undefined,
        startupCommand: includeStartupCommands ? secured.startupCommand : undefined,
      };
      return {
        host: config.host ?? sanitized.host,
        port: config.port ?? sanitized.port,
        sshConfig: sanitized,
      };
    }

    if (session.type === "rdp") {
      const config = assertSessionConfig(session, "rdpConfig");
      const secured = await secureConnectionConfig(
        "rdp",
        config.rdpConfig as RDPConfig,
      ) as RDPConfig;
      return {
        host: config.host ?? secured.host,
        port: config.port ?? secured.port,
        rdpConfig: {
          ...secured,
          password: undefined,
        },
      };
    }

    const config = assertSessionConfig(session, "vncConfig");
    const secured = await secureConnectionConfig(
      "vnc",
      config.vncConfig as VNCConfig,
    ) as VNCConfig;
    return {
      host: config.host ?? secured.host,
      port: config.port ?? secured.port,
      vncConfig: {
        ...secured,
        password: undefined,
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceTemplateError) throw error;
    throw new WorkspaceTemplateError(
      error instanceof Error ? error.message : String(error),
      "credential-vault-unavailable",
    );
  }
}

async function captureSession(
  session: TerminalSession,
  key: string,
  includeStartupCommands: boolean,
): Promise<WorkspaceTemplateSession> {
  if (session.type === "local") {
    return {
      key,
      title: session.title,
      type: session.type,
      cwd: session.cwd,
      config: {
        cwd: session.config?.cwd,
        shell: session.config?.shell,
        admin: session.config?.admin,
        startupCommand: includeStartupCommands
          ? session.config?.startupCommand
          : undefined,
      },
    };
  }

  if (session.type === "ssh" || session.type === "rdp" || session.type === "vnc") {
    const config = await secureRemoteSessionConfig(session, includeStartupCommands);
    useTabsStore.getState().updateSession(session.id, { config });
    return {
      key,
      title: session.title,
      type: session.type,
      host: session.host,
      config,
    };
  }

  const requiredConfigKey = session.type === "serial"
    ? "serialConfig"
    : session.type === "telnet"
      ? "telnetConfig"
      : "aiCliConfig";
  assertSessionConfig(session, requiredConfigKey);
  return {
    key,
    title: session.title,
    type: session.type,
    cwd: session.cwd,
    host: session.host,
    config: cloneValue(session.config),
  };
}

export async function captureWorkspaceTemplate(
  tabId: string,
  options: CaptureWorkspaceTemplateOptions = {},
): Promise<WorkspaceTemplateDefinition> {
  const tabsState = useTabsStore.getState();
  const panesState = usePanesStore.getState();
  const tab = tabsState.tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    throw new WorkspaceTemplateError("Workspace not found.", "workspace-not-found");
  }

  const workspace = panesState.getWorkspace(tabId);
  const leaves = getAllLeaves(workspace.rootNode);
  if (leaves.length < 2) {
    throw new WorkspaceTemplateError(
      "Workspaces can only be created from split tabs.",
      "workspace-not-split",
    );
  }

  const sessionKeyById = new Map<string, string>();
  const sessions: WorkspaceTemplateSession[] = [];
  for (const [index, leaf] of leaves.entries()) {
    const session = tabsState.sessions.find((candidate) => candidate.id === leaf.sessionId);
    if (!session) {
      throw new WorkspaceTemplateError(
        `Session for pane "${leaf.id}" was not found.`,
        "session-not-found",
      );
    }
    const key = `session-${index + 1}`;
    sessionKeyById.set(session.id, key);
    sessions.push(await captureSession(
      session,
      key,
      options.includeStartupCommands === true,
    ));
  }

  if (!workspace.rootNode) {
    throw new WorkspaceTemplateError("Workspace layout is empty.", "invalid-template");
  }

  const captureNode = (node: PaneNode): WorkspaceTemplatePaneNode => {
    if (node.type === "leaf") {
      const sessionKey = sessionKeyById.get(node.sessionId);
      if (!sessionKey) {
        throw new WorkspaceTemplateError(
          "Template layout references an unknown session.",
          "invalid-template",
        );
      }
      return {
        type: "leaf",
        sessionKey,
        fontSize: panesState.paneFontSizeOverrides[node.id],
      };
    }

    return {
      type: "split",
      direction: node.direction,
      ratio: node.ratio,
      children: [captureNode(node.children[0]), captureNode(node.children[1])],
    };
  };

  const focusedLeaf = leaves.find((leaf) => leaf.id === workspace.focusedPaneId);
  return {
    sessions,
    rootNode: captureNode(workspace.rootNode),
    focusedSessionKey: focusedLeaf
      ? sessionKeyById.get(focusedLeaf.sessionId) ?? null
      : sessions[0]?.key ?? null,
  };
}

function toSessionData(session: WorkspaceTemplateSession): NewTerminalSession {
  return {
    title: session.title,
    type: session.type,
    cwd: session.cwd,
    host: session.host,
    config: cloneValue(session.config),
  };
}

function getCredentialId(session: WorkspaceTemplateSession): string | undefined {
  if (session.type === "ssh") return session.config?.sshConfig?.credentialId;
  if (session.type === "rdp") return session.config?.rdpConfig?.credentialId;
  if (session.type === "vnc") return session.config?.vncConfig?.credentialId;
  return undefined;
}

export function launchWorkspaceTemplate(
  name: string,
  template: WorkspaceTemplateDefinition,
): LaunchWorkspaceTemplateResult {
  const tabsStore = useTabsStore.getState();
  const panesStore = usePanesStore.getState();
  const sessionByKey = new Map(template.sessions.map((session) => [session.key, session]));
  const sessionIdByKey = new Map<string, string>();
  const createdSessionIds: string[] = [];
  const credentialsState = useCredentialsStore.getState();
  const missingCredentialSessionTitles = template.sessions
    .filter((session) => {
      const credentialId = getCredentialId(session);
      return Boolean(credentialId)
        && (
          credentialsState.status !== "unlocked"
          || !credentialsState.getCredential(credentialId)
        );
    })
    .map((session) => session.title);

  const tabId = tabsStore.addTab({ title: name });
  tabsStore.setActiveTabId(tabId);

  try {
    for (const session of template.sessions) {
      const sessionId = tabsStore.addSession(
        toSessionData(session),
        { notifyLifecycle: false },
      );
      createdSessionIds.push(sessionId);
      sessionIdByKey.set(session.key, sessionId);
    }

    const fontSizeOverrides: Record<string, number> = {};
    let focusedPaneId: string | null = null;
    const restoreNode = (node: WorkspaceTemplatePaneNode): PaneNode => {
      if (node.type === "leaf") {
        if (!sessionByKey.has(node.sessionKey)) {
          throw new WorkspaceTemplateError(
            "Template layout references an unknown session.",
            "invalid-template",
          );
        }
        const sessionId = sessionIdByKey.get(node.sessionKey);
        if (!sessionId) {
          throw new WorkspaceTemplateError(
            "Template session could not be created.",
            "invalid-template",
          );
        }
        const leaf = createLeaf(sessionId);
        if (typeof node.fontSize === "number" && Number.isFinite(node.fontSize)) {
          fontSizeOverrides[leaf.id] = node.fontSize;
        }
        if (node.sessionKey === template.focusedSessionKey) {
          focusedPaneId = leaf.id;
        }
        return leaf;
      }

      return createSplit(
        node.direction,
        restoreNode(node.children[0]),
        restoreNode(node.children[1]),
        node.ratio,
      );
    };

    const rootNode = restoreNode(template.rootNode);
    const firstLeaf = getAllLeaves(rootNode)[0];
    const resolvedFocusedPaneId = focusedPaneId ?? firstLeaf?.id ?? null;
    panesStore.setWorkspace(
      tabId,
      { rootNode, focusedPaneId: resolvedFocusedPaneId },
      fontSizeOverrides,
    );

    if (resolvedFocusedPaneId) {
      panesStore.focusPane(resolvedFocusedPaneId);
    }
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("lazy-term-focus"));
    });

    return { tabId, missingCredentialSessionTitles };
  } catch (error) {
    createdSessionIds.forEach((sessionId) => (
      tabsStore.removeSession(sessionId, { notifyLifecycle: false })
    ));
    panesStore.cleanupWorkspace(tabId);
    tabsStore.removeTab(tabId);
    throw error;
  }
}
