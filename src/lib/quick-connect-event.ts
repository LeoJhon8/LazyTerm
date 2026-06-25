/**
 * Cross-component events for connection entry actions.
 */

export type QuickConnectType = "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli";

export const QUICK_CONNECT_EVENT = "lazy-term-quick-connect";
export const NEW_CONNECTION_EVENT = "lazy-term-new-connection";

let quickConnectListenerCount = 0;
let newConnectionListenerCount = 0;
let pendingQuickConnect: { type: QuickConnectType | null } | null = null;
let pendingNewConnection = false;

export function emitQuickConnect(type?: QuickConnectType) {
  const detail = type ?? null;
  if (quickConnectListenerCount === 0) {
    pendingQuickConnect = { type: detail };
  }

  window.dispatchEvent(
    new CustomEvent<QuickConnectType | null>(QUICK_CONNECT_EVENT, { detail }),
  );
}

export function emitNewConnection() {
  if (newConnectionListenerCount === 0) {
    pendingNewConnection = true;
  }

  window.dispatchEvent(new CustomEvent(NEW_CONNECTION_EVENT));
}

export type QuickConnectListener = (type: QuickConnectType | null) => void;

export function onQuickConnect(listener: QuickConnectListener) {
  quickConnectListenerCount += 1;

  const handler = (event: Event) => {
    listener((event as CustomEvent<QuickConnectType | null>).detail ?? null);
  };
  window.addEventListener(QUICK_CONNECT_EVENT, handler);

  if (pendingQuickConnect) {
    const pending = pendingQuickConnect;
    pendingQuickConnect = null;
    queueMicrotask(() => listener(pending.type));
  }

  return () => {
    quickConnectListenerCount = Math.max(0, quickConnectListenerCount - 1);
    window.removeEventListener(QUICK_CONNECT_EVENT, handler);
  };
}

export type NewConnectionListener = () => void;

export function onNewConnection(listener: NewConnectionListener) {
  newConnectionListenerCount += 1;

  const handler = () => listener();
  window.addEventListener(NEW_CONNECTION_EVENT, handler);

  if (pendingNewConnection) {
    pendingNewConnection = false;
    queueMicrotask(listener);
  }

  return () => {
    newConnectionListenerCount = Math.max(0, newConnectionListenerCount - 1);
    window.removeEventListener(NEW_CONNECTION_EVENT, handler);
  };
}
