export interface ParsedTerminalCommandLine {
  rawLine: string;
  command: string;
  commandStartX: number;
  cursorCommandOffset: number;
  isCursorAtEnd: boolean;
}

function resolveCommandStart(text: string) {
  if (!text) {
    return 0;
  }

  if (text.startsWith("PS ")) {
    const idx = text.indexOf("> ");
    if (idx !== -1) {
      return idx + 2;
    }
  }

  if (/^[A-Za-z]:[\\/]/.test(text)) {
    const idx = text.indexOf("> ");
    if (idx !== -1) {
      return idx + 2;
    }
  }

  const unixMatch = text.match(/^[^@\s]+@[^:\s\\]+[:\s][^#$%]*?[#$%]\s+/);
  if (unixMatch) {
    return unixMatch[0].length;
  }

  const minimalMatch = text.match(/^([a-zA-Z0-9_\-/.~]+\s?)?[#$%鉂灉]\s+/);
  if (minimalMatch) {
    return minimalMatch[0].length;
  }

  const arrowMatch = text.match(/^[>]{1,3}\s+/);
  if (arrowMatch) {
    return arrowMatch[0].length;
  }

  if (/[>$%#]$/.test(text)) {
    return text.length;
  }

  return 0;
}

export function parseTerminalCommandLine(
  lineText: string,
  cursorX?: number
): ParsedTerminalCommandLine {
  const rawLine = lineText.replace(/\u00a0/g, " ").replace(/\s+$/, "");
  const commandStart = resolveCommandStart(rawLine);
  const commandSegment = rawLine.substring(commandStart);
  const leadingWhitespaceLength = commandSegment.length - commandSegment.trimStart().length;
  const normalizedCommandStart = commandStart + leadingWhitespaceLength;
  const command = commandSegment.trimStart();
  const resolvedCursorX =
    cursorX === undefined
      ? rawLine.length
      : Math.max(0, Math.min(cursorX, rawLine.length));
  const cursorCommandOffset = Math.max(
    0,
    Math.min(command.length, resolvedCursorX - normalizedCommandStart)
  );

  return {
    rawLine,
    command,
    commandStartX: normalizedCommandStart,
    cursorCommandOffset,
    isCursorAtEnd: cursorCommandOffset >= command.length,
  };
}

export function extractTerminalCommand(lineText: string) {
  return parseTerminalCommandLine(lineText).command;
}
