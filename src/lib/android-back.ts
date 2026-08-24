export type AndroidBackDisposition = "consumed" | "root";

export const ANDROID_BACK_PRIORITY = {
  panel: 100,
  dialog: 200,
  nestedPage: 250,
  transient: 300,
} as const;

type AndroidBackHandler = () => boolean;

interface AndroidBackEntry {
  handler: AndroidBackHandler;
  order: number;
  priority: number;
}

declare global {
  interface Window {
    __lazyTermHandleAndroidBack?: () => AndroidBackDisposition;
  }
}

const handlers = new Map<symbol, AndroidBackEntry>();
let nextOrder = 0;

export function registerAndroidBackHandler(
  handler: AndroidBackHandler,
  priority: number,
): () => void {
  const id = Symbol("android-back-handler");
  handlers.set(id, {
    handler,
    priority,
    order: nextOrder++,
  });

  return () => {
    handlers.delete(id);
  };
}

function dispatchAndroidBack(): AndroidBackDisposition {
  const entries = [...handlers.values()].sort((a, b) => (
    b.priority - a.priority || b.order - a.order
  ));

  for (const entry of entries) {
    try {
      if (entry.handler()) return "consumed";
    } catch (error) {
      console.error("Android back handler failed", error);
    }
  }

  return "root";
}

export function installAndroidBackDispatcher(): () => void {
  const dispatcher = () => dispatchAndroidBack();
  window.__lazyTermHandleAndroidBack = dispatcher;

  return () => {
    if (window.__lazyTermHandleAndroidBack === dispatcher) {
      delete window.__lazyTermHandleAndroidBack;
    }
  };
}
