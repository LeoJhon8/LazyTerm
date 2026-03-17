type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function formatTime(): string {
  const now = new Date();
  // 转换为北京时间 (UTC+8)
  const beijingTime = new Date(now.getTime() + (8 - now.getTimezoneOffset() / 60) * 3600 * 1000);
  
  const yyyy = String(beijingTime.getUTCFullYear()).padStart(4, "0");
  const mm = String(beijingTime.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(beijingTime.getUTCDate()).padStart(2, "0");
  const h = String(beijingTime.getUTCHours()).padStart(2, "0");
  const m = String(beijingTime.getUTCMinutes()).padStart(2, "0");
  const s = String(beijingTime.getUTCSeconds()).padStart(2, "0");
  const ms = String(beijingTime.getUTCMilliseconds()).padStart(3, "0");
  return `${yyyy}-${mm}-${dd} ${h}:${m}:${s}.${ms}`;
}

function toText(message: unknown): string {
  if (typeof message === "string") return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

function emit(level: LogLevel, scope: string, message: unknown, extra?: unknown): void {
  const base = `[${formatTime()}][${level}][${scope}] ${toText(message)}`;
  const line = extra === undefined ? base : `${base} ${toText(extra)}`;

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  if (level === "DEBUG") {
    console.debug(line);
    return;
  }

  console.log(line);
}

export const logger = {
  debug(scope: string, message: unknown, extra?: unknown) {
    emit("DEBUG", scope, message, extra);
  },
  info(scope: string, message: unknown, extra?: unknown) {
    emit("INFO", scope, message, extra);
  },
  warn(scope: string, message: unknown, extra?: unknown) {
    emit("WARN", scope, message, extra);
  },
  error(scope: string, message: unknown, extra?: unknown) {
    emit("ERROR", scope, message, extra);
  },
};
