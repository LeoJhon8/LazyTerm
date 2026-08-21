export type TerminalTextInsertionSource = "ai";

export interface TerminalTextInsertionDetail {
  text: string;
  source: TerminalTextInsertionSource;
  handled: boolean;
}

function getTerminalTextInsertionEventName(sessionId: string): string {
  return `lazy-term-text-insertion-${sessionId}`;
}

export function requestTerminalTextInsertion(
  sessionId: string,
  text: string,
  source: TerminalTextInsertionSource,
): boolean {
  if (!sessionId || !text) return false;

  const detail: TerminalTextInsertionDetail = {
    text,
    source,
    handled: false,
  };

  window.dispatchEvent(new CustomEvent<TerminalTextInsertionDetail>(
    getTerminalTextInsertionEventName(sessionId),
    { detail },
  ));

  return detail.handled;
}

export function onTerminalTextInsertionRequested(
  sessionId: string,
  listener: (detail: TerminalTextInsertionDetail) => boolean,
): () => void {
  const eventName = getTerminalTextInsertionEventName(sessionId);
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<TerminalTextInsertionDetail>).detail;
    if (!detail?.text) return;
    detail.handled = listener(detail) || detail.handled;
  };

  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
