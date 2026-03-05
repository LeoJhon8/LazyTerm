import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SSHConfig } from "@/types/terminal";

export type NodeType = "folder" | "ssh";

export interface SessionNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  config?: SSHConfig;
  isExpanded?: boolean;
  isRoot?: boolean;
  order: number;
}

interface SSHProfilesState {
  nodes: SessionNode[];
  ensureRoot: () => void;
  addFolder: (name: string, parentId: string) => void;
  addProfile: (cfg: SSHConfig, parentId: string) => void;
  updateNode: (id: string, updates: Partial<SessionNode>) => void;
  removeNode: (id: string) => void;
  toggleFolder: (id: string) => void;
  moveNode: (activeId: string, overId: string, position: 'before' | 'after' | 'inside') => void;
}

const isDescendant = (nodes: SessionNode[], parentId: string, targetId: string): boolean => {
  const children = nodes.filter(n => n.parentId === parentId);
  if (children.some(c => c.id === targetId)) return true;
  for (const child of children) {
    if (isDescendant(nodes, child.id, targetId)) return true;
  }
  return false;
};

export const useSshProfilesStore = create<SSHProfilesState>()(
  persist(
    (set, get) => ({
      nodes: [],

      ensureRoot: () => {
        const { nodes } = get();
        if (nodes.length === 0) {
          set({ nodes: [{ id: "root-folder", type: "folder", name: "我的会话", parentId: null, isExpanded: true, isRoot: true, order: 0 }] });
        }
      },

      addFolder: (name, parentId) => set((state) => {
        const siblings = state.nodes.filter(n => n.parentId === parentId);
        const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.order)) : 0;
        return {
          nodes: state.nodes.map(n => n.id === parentId ? { ...n, isExpanded: true } : n)
            .concat([{ id: `f_${Math.random().toString(36).slice(2, 9)}`, type: "folder", name, parentId, isExpanded: true, order: maxOrder + 1 }]),
        };
      }),

      addProfile: (cfg, parentId) => set((state) => {
        const siblings = state.nodes.filter(n => n.parentId === parentId);
        const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(s => s.order)) : 0;
        return {
          nodes: state.nodes.map(n => n.id === parentId ? { ...n, isExpanded: true } : n)
            .concat([{ id: `s_${Math.random().toString(36).slice(2, 9)}`, type: "ssh", name: cfg.nickname || cfg.host, parentId, config: cfg, order: maxOrder + 1 }]),
        };
      }),

      updateNode: (id, updates) => set((state) => ({
        nodes: state.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
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
        if (!activeNode || !overNode || activeId === overId) return state;
        if (activeNode.type === 'folder' && isDescendant(state.nodes, activeId, overId)) return state;

        let newParentId: string | null = overNode.parentId;
        let newOrder = overNode.order;

        // 特殊逻辑：如果目标是根节点，或者试图移到和根同级
        if (overNode.isRoot) {
          newParentId = overNode.id; // 强制移入根
          newOrder = -1;
        } else if (position === 'inside' && overNode.type === 'folder') {
          newParentId = overNode.id;
          newOrder = -1;
        } else if (position === 'after') {
          newOrder = overNode.order + 0.5;
        } else {
          newOrder = overNode.order - 0.5;
        }

        // 二次保护：绝对不允许 parentId 为空（除非是 root 本身）
        if (newParentId === null) newParentId = 'root-folder';

        const updated = state.nodes.map(n => {
          if (n.id === activeId) return { ...n, parentId: newParentId, order: newOrder };
          if (n.id === newParentId && n.type === 'folder') return { ...n, isExpanded: true };
          return n;
        });

        const finalNodes = [...updated].sort((a, b) => {
          if (a.parentId !== b.parentId) return 0;
          return a.order - b.order;
        }).map((n, i) => ({ ...n, order: i }));

        return { nodes: finalNodes };
      }),
    }),
    { name: "terminal-sessions-v10", storage: createJSONStorage(() => localStorage) }
  )
);