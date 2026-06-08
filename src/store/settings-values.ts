export const DEFAULT_QUICK_COMMAND_FONT_SIZE = 12;
export const MIN_QUICK_COMMAND_FONT_SIZE = 10;
export const MAX_QUICK_COMMAND_FONT_SIZE = 20;

export function normalizeQuickCommandFontSize(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_QUICK_COMMAND_FONT_SIZE;
  }

  return Math.min(
    MAX_QUICK_COMMAND_FONT_SIZE,
    Math.max(MIN_QUICK_COMMAND_FONT_SIZE, Math.round(value))
  );
}
