import type { TranslationKey } from "@/i18n";

type Range = readonly [number, number];
interface ColorRange {
  hue: Range;
  saturation: Range;
  lightness: Range;
}

export type MoodId = "happy" | "calm" | "energetic" | "romantic" | "melancholy" | "natural" | "mysterious" | "relaxed";

interface MoodPalette {
  id: MoodId;
  label: TranslationKey;
  app: ColorRange;
  terminal: ColorRange;
}

// 心情决定色彩范围，每次在范围内生成新颜色，不依赖系统或应用的深浅主题。
export const MOOD_PALETTES: readonly MoodPalette[] = [
  { id: "happy", label: "开心", app: { hue: [20, 48], saturation: [0.55, 0.8], lightness: [0.8, 0.9] }, terminal: { hue: [15, 35], saturation: [0.25, 0.45], lightness: [0.14, 0.22] } },
  { id: "calm", label: "平静", app: { hue: [165, 200], saturation: [0.25, 0.45], lightness: [0.8, 0.9] }, terminal: { hue: [205, 230], saturation: [0.25, 0.5], lightness: [0.13, 0.21] } },
  { id: "energetic", label: "活力", app: { hue: [5, 25], saturation: [0.6, 0.85], lightness: [0.79, 0.85] }, terminal: { hue: [225, 255], saturation: [0.35, 0.6], lightness: [0.15, 0.24] } },
  { id: "romantic", label: "浪漫", app: { hue: [320, 350], saturation: [0.35, 0.6], lightness: [0.82, 0.91] }, terminal: { hue: [275, 310], saturation: [0.25, 0.5], lightness: [0.16, 0.24] } },
  { id: "melancholy", label: "忧郁", app: { hue: [215, 250], saturation: [0.12, 0.25], lightness: [0.23, 0.31] }, terminal: { hue: [205, 230], saturation: [0.2, 0.35], lightness: [0.1, 0.16] } },
  { id: "natural", label: "自然", app: { hue: [90, 140], saturation: [0.2, 0.4], lightness: [0.79, 0.88] }, terminal: { hue: [25, 45], saturation: [0.2, 0.4], lightness: [0.13, 0.22] } },
  { id: "mysterious", label: "神秘", app: { hue: [270, 310], saturation: [0.3, 0.55], lightness: [0.22, 0.3] }, terminal: { hue: [220, 250], saturation: [0.3, 0.5], lightness: [0.09, 0.15] } },
  { id: "relaxed", label: "慵懒", app: { hue: [28, 45], saturation: [0.25, 0.45], lightness: [0.8, 0.87] }, terminal: { hue: [18, 32], saturation: [0.12, 0.25], lightness: [0.92, 0.96] } },
];

interface MoodColors {
  mood: MoodId;
  app: string;
  terminal: string;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset: number) => {
    const position = (offset + hue / 30) % 12;
    const value = lightness - amplitude * Math.max(-1, Math.min(position - 3, 9 - position, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function randomBackground(range: ColorRange): string {
  return hslToHex(
    randomBetween(...range.hue),
    randomBetween(...range.saturation),
    randomBetween(...range.lightness),
  );
}

export function pickMoodColors(currentMood: MoodId | null): MoodColors {
  const candidates = MOOD_PALETTES.filter(({ id }) => id !== currentMood);
  const palette = candidates[Math.floor(Math.random() * candidates.length)];

  return {
    mood: palette.id,
    app: randomBackground(palette.app),
    terminal: randomBackground(palette.terminal),
  };
}
