import { appStorage } from '@/services/appStorage';
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const AI_MODULE_ID = "AiModule";

export interface AiConfiguration {
  baseUrl: string;
  model: string;
  credentialId: string;
}

export interface AiProfile extends AiConfiguration {
  id: string;
  name: string;
}

interface AiConfigState extends AiConfiguration {
  profiles: AiProfile[];
  activeProfileId: string;
  saveConfiguration: (configuration: AiConfiguration & { name: string; id?: string }) => string;
  removeConfiguration: (id: string) => void;
  selectConfiguration: (id: string) => void;
}

const EMPTY_AI_CONFIGURATION: AiConfiguration = {
  baseUrl: "",
  model: "",
  credentialId: "",
};

export function isAiConfigured(configuration: AiConfiguration): boolean {
  return Boolean(
    configuration.baseUrl.trim()
    && configuration.model.trim()
    && configuration.credentialId,
  );
}

export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set) => ({
      ...EMPTY_AI_CONFIGURATION,
      profiles: [],
      activeProfileId: "",
      saveConfiguration: (configuration) => {
        const profile: AiProfile = {
          id: configuration.id ?? crypto.randomUUID(),
          name: configuration.name.trim(),
          baseUrl: configuration.baseUrl.trim().replace(/\/+$/, ""),
          model: configuration.model.trim(),
          credentialId: configuration.credentialId,
        };
        set((state) => {
          const profiles = state.profiles.some(({ id }) => id === profile.id)
            ? state.profiles.map((item) => item.id === profile.id ? profile : item)
            : [...state.profiles, profile];
          const activeProfileId = state.activeProfileId || profile.id;
          const active = profiles.find(({ id }) => id === activeProfileId)!;
          return { profiles, activeProfileId, baseUrl: active.baseUrl, model: active.model, credentialId: active.credentialId };
        });
        return profile.id;
      },
      removeConfiguration: (id) => set((state) => {
        const profiles = state.profiles.filter((profile) => profile.id !== id);
        const active = profiles.find((profile) => profile.id === state.activeProfileId) ?? profiles[0];
        return {
          profiles,
          activeProfileId: active?.id ?? "",
          baseUrl: active?.baseUrl ?? "",
          model: active?.model ?? "",
          credentialId: active?.credentialId ?? "",
        };
      }),
      selectConfiguration: (id) => set((state) => {
        const active = state.profiles.find((profile) => profile.id === id);
        return active ? { activeProfileId: id, baseUrl: active.baseUrl, model: active.model, credentialId: active.credentialId } : {};
      }),
    }),
    {
      name: "lazy-term-ai-config",
      storage: createJSONStorage(() => appStorage),
      partialize: ({ profiles, activeProfileId }) => ({ profiles, activeProfileId }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AiConfigState> | undefined;
        const profiles = saved?.profiles ?? (saved?.baseUrl && saved.model && saved.credentialId
          ? [{ id: "legacy", name: saved.model, baseUrl: saved.baseUrl, model: saved.model, credentialId: saved.credentialId }]
          : []);
        const active = profiles.find(({ id }) => id === saved?.activeProfileId) ?? profiles[0];
        return {
          ...current,
          profiles,
          activeProfileId: active?.id ?? "",
          baseUrl: active?.baseUrl ?? "",
          model: active?.model ?? "",
          credentialId: active?.credentialId ?? "",
        };
      },
    },
  ),
);

export type AiMessageRole = "user" | "assistant";
export type AiMessageStatus = "complete" | "streaming" | "interrupted" | "failed";

export interface AiMessage {
  id: string;
  topicId: string;
  role: AiMessageRole;
  content: string;
  status: AiMessageStatus;
  createdAt: number;
}

interface AiConversationState {
  messages: AiMessage[];
  currentTopicId: string;
  contextLinked: boolean;
  addMessage: (message: AiMessage) => void;
  updateMessage: (id: string, updates: Partial<Pick<AiMessage, "content" | "status">>) => void;
  removeMessage: (id: string) => void;
  setCurrentTopicId: (topicId: string) => void;
  setContextLinked: (linked: boolean) => void;
  clearConversation: () => void;
}

export function createAiEntityId(prefix: "topic" | "message"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useAiConversationStore = create<AiConversationState>()(
  persist(
    (set) => ({
      messages: [],
      currentTopicId: "",
      contextLinked: false,
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      updateMessage: (id, updates) => set((state) => ({
        messages: state.messages.map((message) => (
          message.id === id ? { ...message, ...updates } : message
        )),
      })),
      removeMessage: (id) => set((state) => ({
        messages: state.messages.filter((message) => message.id !== id),
      })),
      setCurrentTopicId: (topicId) => set({ currentTopicId: topicId }),
      setContextLinked: (contextLinked) => set({ contextLinked }),
      clearConversation: () => set({ messages: [], currentTopicId: "", contextLinked: false }),
    }),
    {
      name: "lazy-term-ai-conversation",
      storage: createJSONStorage(() => appStorage),
      partialize: ({ messages, currentTopicId }) => ({ messages, currentTopicId }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AiConversationState>;
        return {
          ...current,
          messages: (saved.messages ?? []).map((message) => ({
            ...message,
            status: message.status === "streaming" ? "interrupted" : message.status,
          })),
          currentTopicId: saved.currentTopicId ?? "",
          contextLinked: false,
        };
      },
    },
  ),
);
