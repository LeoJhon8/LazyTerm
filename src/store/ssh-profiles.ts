import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { RDPConfig, SSHConfig, VNCConfig, SerialConfig, TelnetConfig, AiCliConfig, LocalConfig } from "@/types/terminal";
import { getSystemLanguage, resolveAppLocale, type AppLocale } from "@/i18n/config";
import { useSettingsStore } from "@/store/settings";
import { gitAwareStorage } from "@/store/git-aware-storage";
import { getClosestRdpResolutionPreset } from "@/lib/rdp-resolution";
import type { WorkspaceTemplateDefinition } from "@/types/workspace-template";

export type NodeType = "folder" | "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli" | "workspace-template";

export interface SessionNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  config?: LocalConfig | SSHConfig | RDPConfig | VNCConfig | SerialConfig | TelnetConfig | AiCliConfig | WorkspaceTemplateDefinition;
  isExpanded?: boolean;
  isRoot?: boolean;
  order: number;
}

function normalizeRdpConfig(config: RDPConfig): RDPConfig {
  const normalizedConfig = { ...config } as RDPConfig & { autoResize?: boolean };
  delete normalizedConfig.autoResize;
  const resolution = getClosestRdpResolutionPreset(config.width, config.height);

  return {
    ...normalizedConfig,
    width: resolution.width,
    height: resolution.height,
  };
}

function sanitizeWorkspaceTemplate(
  template: WorkspaceTemplateDefinition,
): WorkspaceTemplateDefinition {
  const sessions = Array.isArray(template.sessions) ? template.sessions : [];
  return {
    ...template,
    sessions: sessions.map((session) => {
      if (session.type === "ssh" && session.config?.sshConfig) {
        return {
          ...session,
          config: {
            host: session.config.host,
            port: session.config.port,
            sshConfig: {
              ...session.config.sshConfig,
              password: undefined,
              privateKey: undefined,
              privateKeyPassphrase: undefined,
            },
          },
        };
      }
      if (session.type === "rdp" && session.config?.rdpConfig) {
        return {
          ...session,
          config: {
            host: session.config.host,
            port: session.config.port,
            rdpConfig: {
              ...session.config.rdpConfig,
              password: undefined,
            },
          },
        };
      }
      if (session.type === "vnc" && session.config?.vncConfig) {
        return {
          ...session,
          config: {
            host: session.config.host,
            port: session.config.port,
            vncConfig: {
              ...session.config.vncConfig,
              password: undefined,
            },
          },
        };
      }
      return session;
    }),
  };
}

function normalizeNode(node: SessionNode): SessionNode {
  if (node.type === "workspace-template" && node.config) {
    return {
      ...node,
      config: sanitizeWorkspaceTemplate(node.config as WorkspaceTemplateDefinition),
    };
  }

  if (node.type !== "rdp" || !node.config) {
    return node;
  }

  return {
    ...node,
    config: normalizeRdpConfig(node.config as RDPConfig),
  };
}

function normalizeNodes(nodes: SessionNode[]): SessionNode[] {
  return nodes.map(normalizeNode);
}

interface SSHProfilesState {
  nodes: SessionNode[];
  ensureRoot: () => void;
  syncRootFolderName: () => void;
  addFolder: (name: string, parentId: string) => void;
  addProfile: (type: "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli", cfg: LocalConfig | SSHConfig | RDPConfig | VNCConfig | SerialConfig | TelnetConfig | AiCliConfig, parentId: string) => void;
  addWorkspaceTemplate: (name: string, template: WorkspaceTemplateDefinition, parentId: string) => void;
  duplicateProfile: (id: string, name: string, configOverride?: SessionNode["config"]) => void;
  updateNode: (id: string, updates: Partial<SessionNode>) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  toggleFolder: (id: string) => void;
  moveNode: (activeId: string, overId: string, position: 'before' | 'after' | 'inside') => void;
  importProfiles: (profiles: SessionNode[]) => void;
  exportProfiles: () => SessionNode[];
}

const isDescendant = (nodes: SessionNode[], parentId: string, targetId: string): boolean => {
  const children = nodes.filter(n => n.parentId === parentId);
  if (children.some(c => c.id === targetId)) return true;
  for (const child of children) {
    if (isDescendant(nodes, child.id, targetId)) return true;
  }
  return false;
};

const DEFAULT_ROOT_FOLDER_NAMES: Record<AppLocale, string> = {
  "zh-CN": "我的会话",
  "en-US": "My sessions",
};

const DEFAULT_ROOT_FOLDER_NAME_ALIASES = new Set(Object.values(DEFAULT_ROOT_FOLDER_NAMES));

function getDefaultRootFolderName(locale?: AppLocale): string {
  const resolvedLocale = locale
    ?? resolveAppLocale(useSettingsStore.getState().language, getSystemLanguage());

  return DEFAULT_ROOT_FOLDER_NAMES[resolvedLocale];
}

export const useSshProfilesStore = create<SSHProfilesState>()(
  persist(
    (set, get) => ({
      nodes: [],

      ensureRoot: () => {
        const { nodes } = get();
        if (nodes.length === 0) {
          set({ nodes: [{ id: "root-folder", type: "folder", name: getDefaultRootFolderName(), parentId: null, isExpanded: true, isRoot: true, order: 0 }] });
        }
      },

      syncRootFolderName: () => set((state) => {
        const rootNode = state.nodes.find((node) => node.isRoot || node.parentId === null);
        if (!rootNode) {
          return state;
        }

        if (!DEFAULT_ROOT_FOLDER_NAME_ALIASES.has(rootNode.name)) {
          return state;
        }

        const nextName = getDefaultRootFolderName();
        if (rootNode.name === nextName) {
          return state;
        }

        return {
          nodes: state.nodes.map((node) =>
            node.id === rootNode.id ? { ...node, name: nextName } : node
          ),
        };
      }),

      addFolder: (name, parentId) => set((state) => {
        const siblings = state.nodes.filter(n => n.parentId === parentId);
        const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.order)) : 0;
        return {
          nodes: state.nodes.map(n => n.id === parentId ? { ...n, isExpanded: true } : n)
            .concat([{ id: `f_${Math.random().toString(36).slice(2, 9)}`, type: "folder", name, parentId, isExpanded: true, order: maxOrder + 1 }]),
        };
      }),

      addProfile: (type: "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli", cfg, parentId) => set((state) => {
        const siblings = state.nodes.filter(n => n.parentId === parentId);
        const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.order)) : 0;
        const normalizedConfig = type === "rdp"
          ? normalizeRdpConfig(cfg as RDPConfig)
          : cfg;
        
        // 根据类型确定默认名称
        let defaultName = "AI CLI";
        if (type === "local") {
          const localConfig = normalizedConfig as LocalConfig;
          const shellName = localConfig.shell?.split(/[/\\]/).pop()?.replace(/\.exe$/i, "");
          defaultName = localConfig.nickname || shellName || "Local";
        } else if (type === "ssh" || type === "rdp" || type === "vnc") {
          defaultName = (normalizedConfig as any).nickname || (normalizedConfig as any).host || "";
        } else if (type === "serial") {
          defaultName = (normalizedConfig as any).nickname || (normalizedConfig as any).port || "Serial";
        } else if (type === "telnet") {
          defaultName = (normalizedConfig as any).nickname || (normalizedConfig as any).host || "Telnet";
        } else if (type === "ai-cli") {
          defaultName = (normalizedConfig as AiCliConfig).nickname || (normalizedConfig as AiCliConfig).command || "AI CLI";
        }
        
        return {
          nodes: state.nodes.map(n => n.id === parentId ? { ...n, isExpanded: true } : n)
            .concat([{ id: `s_${Math.random().toString(36).slice(2, 9)}`, type, name: defaultName, parentId, config: normalizedConfig, order: maxOrder + 1 }]),
        };
      }),

      addWorkspaceTemplate: (name, template, parentId) => set((state) => {
        const siblings = state.nodes.filter((node) => node.parentId === parentId);
        const maxOrder = siblings.length > 0
          ? Math.max(...siblings.map((sibling) => sibling.order))
          : 0;
        return {
          nodes: state.nodes
            .map((node) => node.id === parentId ? { ...node, isExpanded: true } : node)
            .concat([{
              id: `w_${Math.random().toString(36).slice(2, 9)}`,
              type: "workspace-template",
              name: name.trim(),
              parentId,
              config: sanitizeWorkspaceTemplate(template),
              order: maxOrder + 1,
            }]),
        };
      }),

      duplicateProfile: (id, name, configOverride) => set((state) => {
        const source = state.nodes.find((node) => node.id === id);
        if (!source || source.type === "folder" || !source.config || source.parentId === null) {
          return state;
        }

        const nodes = state.nodes.map((node) =>
          node.parentId === source.parentId && node.order > source.order
            ? { ...node, order: node.order + 1 }
            : node
        );
        const baseConfig = configOverride ?? source.config;
        const config = source.type === "workspace-template"
          ? structuredClone(baseConfig)
          : { ...baseConfig, nickname: name };

        return {
          nodes: nodes.concat([normalizeNode({
            id: `s_${Math.random().toString(36).slice(2, 9)}`,
            type: source.type,
            name,
            parentId: source.parentId,
            config,
            order: source.order + 1,
          })]),
        };
      }),

      updateNode: (id, updates) => set((state) => ({
        nodes: state.nodes.map((n) => {
          if (n.id !== id) {
            return n;
          }

          return normalizeNode({ ...n, ...updates });
        }),
      })),

      toggleFolder: (id) => set((state) => ({
        nodes: state.nodes.map(n => n.id === id ? { ...n, isExpanded: !n.isExpanded } : n)
      })),

      removeNode: (id) => get().removeNodes([id]),

      removeNodes: (ids) => set((state) => {
        const childrenByParentId = new Map<string, string[]>();
        state.nodes.forEach((node) => {
          if (node.parentId === null) return;
          const childIds = childrenByParentId.get(node.parentId) ?? [];
          childIds.push(node.id);
          childrenByParentId.set(node.parentId, childIds);
        });

        const nodeById = new Map(state.nodes.map((node) => [node.id, node]));
        const idsToRemove = new Set<string>();
        const collectNodeIds = (id: string) => {
          const node = nodeById.get(id);
          if (!node || node.isRoot || idsToRemove.has(id)) return;
          idsToRemove.add(id);
          childrenByParentId.get(id)?.forEach(collectNodeIds);
        };

        ids.forEach(collectNodeIds);
        if (idsToRemove.size === 0) return state;

        return { nodes: state.nodes.filter((node) => !idsToRemove.has(node.id)) };
      }),

      moveNode: (activeId, overId, position) => set((state) => {
        const activeNode = state.nodes.find(n => n.id === activeId);
        const overNode = state.nodes.find(n => n.id === overId);
        if (!activeNode || !overNode || activeNode.isRoot || activeId === overId) return state;

        let newParentId: string | null = overNode.parentId;

        if (overNode.isRoot) {
          newParentId = overNode.id;
        } else if (position === 'inside' && overNode.type === 'folder') {
          newParentId = overNode.id;
        }

        if (newParentId === null) newParentId = 'root-folder';
        if (
          activeNode.type === 'folder'
          && (newParentId === activeId || isDescendant(state.nodes, activeId, newParentId))
        ) {
          return state;
        }

        const oldParentId = activeNode.parentId;
        const destinationSiblings = state.nodes
          .filter(n => n.parentId === newParentId && n.id !== activeId)
          .sort((a, b) => a.order - b.order);

        let insertionIndex = 0;
        if (!overNode.isRoot && position !== 'inside') {
          const overIndex = destinationSiblings.findIndex(n => n.id === overId);
          if (overIndex === -1) return state;
          insertionIndex = overIndex + (position === 'after' ? 1 : 0);
        }

        const reorderedDestination = [...destinationSiblings];
        reorderedDestination.splice(insertionIndex, 0, activeNode);
        const destinationOrders = new Map(
          reorderedDestination.map((node, index) => [node.id, index])
        );
        const oldParentOrders = oldParentId !== newParentId
          ? new Map(
              state.nodes
                .filter(n => n.parentId === oldParentId && n.id !== activeId)
                .sort((a, b) => a.order - b.order)
                .map((node, index) => [node.id, index])
            )
          : null;

        return {
          nodes: state.nodes.map(n => {
            if (n.id === activeId) {
              return { ...n, parentId: newParentId, order: destinationOrders.get(n.id) ?? 0 };
            }
            if (n.id === newParentId && n.type === 'folder') {
              return { ...n, isExpanded: true };
            }

            const destinationOrder = destinationOrders.get(n.id);
            if (destinationOrder !== undefined) {
              return { ...n, order: destinationOrder };
            }

            const oldParentOrder = oldParentOrders?.get(n.id);
            return oldParentOrder === undefined ? n : { ...n, order: oldParentOrder };
          }),
        };
      }),

      importProfiles: (profiles) => set((state) => {
        if (!profiles || !Array.isArray(profiles) || profiles.length === 0) return state;

        // 【覆盖模式导入】完整恢复配置保证原有的树形结构完美存在
        const validProfiles = [...profiles];
        
        // 确保导入数据包含合法 root，如果没有容错创建一个
        let root = validProfiles.find((n) => n.isRoot || n.parentId === null);
        
        if (!root) {
          root = { 
            id: "root-folder", type: "folder", name: getDefaultRootFolderName(),
            parentId: null, isExpanded: true, isRoot: true, order: 0 
          };
          validProfiles.unshift(root);
        } else {
          root.isRoot = true;
          root.parentId = null;
        }

        // 把可能游离的节点的 parentId 指回 root.id
        validProfiles.forEach(p => {
          if (p.id !== root!.id && !p.parentId) p.parentId = root!.id;
        });

        return { nodes: normalizeNodes(validProfiles) };
      }),

      exportProfiles: () => {
        const { nodes } = get();
        // 直接返回完整的节点数组，保留所有字段维持树形结构
        return normalizeNodes(nodes);
      },
    }),
    {
      name: "terminal-sessions-v10",
      storage: createJSONStorage(() => gitAwareStorage),
      merge: (persistedState, currentState) => {
        const merged = {
          ...currentState,
          ...(persistedState as Partial<SSHProfilesState>),
        };

        return {
          ...merged,
          nodes: normalizeNodes(merged.nodes ?? []),
        };
      },
    }
  )
);
