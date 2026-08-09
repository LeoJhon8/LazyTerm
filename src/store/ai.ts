import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const AI_MODULE_ID = "AiModule";

export interface AiConfiguration {
  baseUrl: string;
  model: string;
  credentialId: string;
}

interface AiConfigState extends AiConfiguration {
  saveConfiguration: (configuration: AiConfiguration) => void;
  clearConfiguration: () => void;
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
      saveConfiguration: (configuration) => set({
        baseUrl: configuration.baseUrl.trim().replace(/\/+$/, ""),
        model: configuration.model.trim(),
        credentialId: configuration.credentialId,
      }),
      clearConfiguration: () => set(EMPTY_AI_CONFIGURATION),
    }),
    {
      name: "lazy-term-ai-config",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ baseUrl, model, credentialId }) => ({ baseUrl, model, credentialId }),
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
      storage: createJSONStorage(() => localStorage),
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
