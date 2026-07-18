import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { RDPConfig, SSHConfig, VNCConfig, SerialConfig, TelnetConfig, AiCliConfig } from "@/types/terminal";
import { getSystemLanguage, resolveAppLocale, type AppLocale } from "@/i18n/config";
import { useSettingsStore } from "@/store/settings";
import { gitAwareStorage } from "@/store/git-aware-storage";
import { getClosestRdpResolutionPreset } from "@/lib/rdp-resolution";

export type NodeType = "folder" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli";

export interface SessionNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  config?: SSHConfig | RDPConfig | VNCConfig | SerialConfig | TelnetConfig | AiCliConfig;
  isExpanded?: boolean;
  isRoot?: boolean;
  order: number;
}

function normalizeRdpConfig(config: RDPConfig): RDPConfig {
  if (config.backend === "msrdpax") {
    return {
      ...config,
      width: undefined,
      height: undefined,
      autoResize: true,
    };
  }

  const resolution = getClosestRdpResolutionPreset(config.width, config.height);

  return {
    ...config,
    width: resolution.width,
    height: resolution.height,
  };
}

function normalizeNode(node: SessionNode): SessionNode {
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
  addProfile: (type: "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli", cfg: SSHConfig | RDPConfig | VNCConfig | SerialConfig | TelnetConfig | AiCliConfig, parentId: string) => void;
  duplicateProfile: (id: string, name: string) => void;
  updateNode: (id: string, updates: Partial<SessionNode>) => void;
  removeNode: (id: string) => void;
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

      addProfile: (type: "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli", cfg, parentId) => set((state) => {
        const siblings = state.nodes.filter(n => n.parentId === parentId);
        const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.order)) : 0;
        const normalizedConfig = type === "rdp"
          ? normalizeRdpConfig(cfg as RDPConfig)
          : cfg;
        
        // 根据类型确定默认名称
        let defaultName = "AI CLI";
        if (type === "ssh" || type === "rdp" || type === "vnc") {
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

      duplicateProfile: (id, name) => set((state) => {
        const source = state.nodes.find((node) => node.id === id);
        if (!source || source.type === "folder" || !source.config || source.parentId === null) {
          return state;
        }

        const nodes = state.nodes.map((node) =>
          node.parentId === source.parentId && node.order > source.order
            ? { ...node, order: node.order + 1 }
            : node
        );
        const config = { ...source.config, nickname: name };

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

      removeNode: (id) => set((state) => {
        if (state.nodes.find(n => n.id === id)?.isRoot) return state;
        const getIds = (pId: string): string[] => {
          const children = state.nodes.filter(n => n.parentId === pId);
          return [...children.map(c => c.id), ...children.flatMap(c => getIds(c.id))];
        };
        const toRemove = [id, ...getIds(id)];
        return { nodes: state.nodes.filter(n => !toRemove.includes(n.id)) };
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
