import type { ITerminalConnector } from "@/types/terminal";

interface TerminalAccess {
  connector: () => ITerminalConnector | undefined;
  read: () => string;
  isAlternateScreen: () => boolean;
}

const terminals = new Map<string, TerminalAccess>();
const listeners = new Map<string, Set<(data: string, connector: ITerminalConnector) => void>>();
const inputGuards = new Map<string, () => void | Promise<void>>();

export function registerAiTerminal(sessionId: string, access: TerminalAccess) {
  terminals.set(sessionId, access);
  return () => { if (terminals.get(sessionId) === access) terminals.delete(sessionId); };
}

export function getAiTerminal(sessionId: string) {
  return terminals.get(sessionId);
}

export function publishAiTerminalOutput(sessionId: string, connector: ITerminalConnector, data: string) {
  listeners.get(sessionId)?.forEach((listener) => listener(data, connector));
}

export function subscribeAiTerminalOutput(sessionId: string, listener: (data: string, connector: ITerminalConnector) => void) {
  const entries = listeners.get(sessionId) ?? new Set();
  entries.add(listener);
  listeners.set(sessionId, entries);
  return () => {
    entries.delete(listener);
    if (!entries.size) listeners.delete(sessionId);
  };
}

export function guardAiTerminalInput(sessionId: string, stop: () => void | Promise<void>) {
  inputGuards.set(sessionId, stop);
  return () => { if (inputGuards.get(sessionId) === stop) inputGuards.delete(sessionId); };
}

// Manual input returns control to the user before it is sent to the PTY.
export function notifyAiTerminalInput(connector: ITerminalConnector, data: string | Uint8Array) {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  if (/^\x1b(?:\[<\d+;\d+;\d+[mM]|\[M[\s\S]{3}|\[[IO])$/.test(text)) return;
  for (const [sessionId, access] of terminals) {
    if (access.connector() === connector) return inputGuards.get(sessionId)?.();
  }
}
