/**
 * 快速连接弹窗事件 — WelcomePage → SessionModule 的跨组件通信
 * 使用 CustomEvent 实现，与项目已有的 tab-drag-state 模式一致
 */

export type QuickConnectType = "local" | "ssh" | "rdp" | "vnc" | "serial" | "telnet" | "ai-cli";

export const QUICK_CONNECT_EVENT = "lazy-term-quick-connect";

/** 发射快速连接事件（由 WelcomePage 调用） */
export function emitQuickConnect(type: QuickConnectType) {
  window.dispatchEvent(new CustomEvent<QuickConnectType>(QUICK_CONNECT_EVENT, { detail: type }));
}

/** 快速连接事件监听器类型 */
export type QuickConnectListener = (type: QuickConnectType) => void;

/** 注册快速连接事件监听（由 SessionModule 调用） */
export function onQuickConnect(listener: QuickConnectListener) {
  const handler = (e: Event) => {
    listener((e as CustomEvent<QuickConnectType>).detail);
  };
  window.addEventListener(QUICK_CONNECT_EVENT, handler);
  return () => window.removeEventListener(QUICK_CONNECT_EVENT, handler);
}
