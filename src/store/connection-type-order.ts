import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ConnectionTypeId = "local" | "ssh" | "ai-cli" | "rdp" | "vnc" | "telnet" | "serial";

export const DEFAULT_CONNECTION_TYPE_ORDER: ConnectionTypeId[] = [
  "local",
  "ssh",
  "ai-cli",
  "rdp",
  "vnc",
  "telnet",
  "serial",
];

interface ConnectionTypeOrderState {
  connectionTypeOrder: ConnectionTypeId[];
  reorderConnectionTypes: (orderedTypes: ConnectionTypeId[]) => void;
}

function normalizeOrder(order: ConnectionTypeId[]) {
  const seen = new Set<ConnectionTypeId>();
  const normalized = order.filter((type): type is ConnectionTypeId => {
    if (!DEFAULT_CONNECTION_TYPE_ORDER.includes(type) || seen.has(type)) {
      return false;
    }
    seen.add(type);
    return true;
  });

  return [
    ...normalized,
    ...DEFAULT_CONNECTION_TYPE_ORDER.filter((type) => !seen.has(type)),
  ];
}

export const useConnectionTypeOrderStore = create<ConnectionTypeOrderState>()(
  persist(
    (set) => ({
      connectionTypeOrder: DEFAULT_CONNECTION_TYPE_ORDER,

      reorderConnectionTypes: (orderedTypes) => set({
        connectionTypeOrder: normalizeOrder(
          orderedTypes.includes("local") ? orderedTypes : ["local", ...orderedTypes],
        ),
      }),
    }),
    {
      name: "lazy-term-connection-type-order",
      storage: createJSONStorage(() => localStorage),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ConnectionTypeOrderState> | undefined;
        return {
          ...currentState,
          ...persisted,
          connectionTypeOrder: normalizeOrder(persisted?.connectionTypeOrder ?? currentState.connectionTypeOrder),
        };
      },
    },
  ),
);
