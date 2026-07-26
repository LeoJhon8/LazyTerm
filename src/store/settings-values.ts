export const DEFAULT_QUICK_COMMAND_FONT_SIZE = 12;
export const MIN_QUICK_COMMAND_FONT_SIZE = 10;
export const MAX_QUICK_COMMAND_FONT_SIZE = 20;
export const DEFAULT_LONG_COMMAND_THRESHOLD_MINUTES = 3;
export const MIN_LONG_COMMAND_THRESHOLD_MINUTES = 1;
export const MAX_LONG_COMMAND_THRESHOLD_MINUTES = 120;

export function normalizeQuickCommandFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_QUICK_COMMAND_FONT_SIZE;
  }

  return Math.min(
    MAX_QUICK_COMMAND_FONT_SIZE,
    Math.max(MIN_QUICK_COMMAND_FONT_SIZE, Math.round(value))
  );
}

export function normalizeLongCommandThresholdMinutes(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_LONG_COMMAND_THRESHOLD_MINUTES;
  }

  return Math.min(
    MAX_LONG_COMMAND_THRESHOLD_MINUTES,
    Math.max(MIN_LONG_COMMAND_THRESHOLD_MINUTES, Math.round(value))
  );
}
