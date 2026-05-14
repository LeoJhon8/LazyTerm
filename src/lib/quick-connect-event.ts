/**
 * Cross-component events from WelcomePage to SessionModule.
 */

export type QuickConnectType = "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli";

export const QUICK_CONNECT_EVENT = "lazy-term-quick-connect";
export const NEW_CONNECTION_EVENT = "lazy-term-new-connection";

export function emitQuickConnect(type?: QuickConnectType) {
  window.dispatchEvent(
    new CustomEvent<QuickConnectType | null>(QUICK_CONNECT_EVENT, { detail: type ?? null }),
  );
}

export function emitNewConnection() {
  window.dispatchEvent(new CustomEvent(NEW_CONNECTION_EVENT));
}

export type QuickConnectListener = (type: QuickConnectType | null) => void;

export function onQuickConnect(listener: QuickConnectListener) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<QuickConnectType | null>).detail ?? null);
  };
  window.addEventListener(QUICK_CONNECT_EVENT, handler);
  return () => window.removeEventListener(QUICK_CONNECT_EVENT, handler);
}

export type NewConnectionListener = () => void;

export function onNewConnection(listener: NewConnectionListener) {
  const handler = () => listener();
  window.addEventListener(NEW_CONNECTION_EVENT, handler);
  return () => window.removeEventListener(NEW_CONNECTION_EVENT, handler);
}
