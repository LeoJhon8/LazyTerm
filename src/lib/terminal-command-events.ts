export interface TerminalCommandSubmittedDetail {
  sessionId: string;
  command: string;
  submittedAt: number;
}

const TERMINAL_COMMAND_SUBMITTED_EVENT = "lazy-term-command-submitted";

export function emitTerminalCommandSubmitted(sessionId: string, command: string) {
  if (!sessionId || !command.trim()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<TerminalCommandSubmittedDetail>(TERMINAL_COMMAND_SUBMITTED_EVENT, {
      detail: {
        sessionId,
        command,
        submittedAt: Date.now(),
      },
    })
  );
}

export function onTerminalCommandSubmitted(
  sessionId: string,
  listener: (detail: TerminalCommandSubmittedDetail) => void
) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<TerminalCommandSubmittedDetail>).detail;
    if (detail?.sessionId === sessionId) {
      listener(detail);
    }
  };

  window.addEventListener(TERMINAL_COMMAND_SUBMITTED_EVENT, handler);
  return () => window.removeEventListener(TERMINAL_COMMAND_SUBMITTED_EVENT, handler);
}
