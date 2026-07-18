import type { TerminalBackgroundMode, TerminalColorScheme } from "@/config/themes";
import type { TranslationKey } from "@/i18n";
import type { AppBackgroundColor, TerminalCursorStyle } from "@/store/settings";

// 可选字体列表
export const FONT_OPTIONS = [
  { value: "'Geist Mono', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace", label: "Geist Mono" },
  { value: "Cascadia Code, Menlo, monospace", label: "Cascadia Code" },
  { value: "JetBrains Mono, Menlo, monospace", label: "JetBrains Mono" },
  { value: "Fira Code, Menlo, monospace", label: "Fira Code" },
  { value: "Source Code Pro, Menlo, monospace", label: "Source Code Pro" },
  { value: "Consolas, Menlo, monospace", label: "Consolas" },
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Menlo" },
  { value: "Monaco, Menlo, monospace", label: "Monaco" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "monospace", label: "系统等宽字体" },
] as const;

// 全局背景色选项
export const APP_BACKGROUND_OPTIONS: Array<{
  value: AppBackgroundColor;
  labelKey: TranslationKey;
}> = [
  { value: "system", labelKey: "跟随系统" },
  { value: "light", labelKey: "浅色" },
  { value: "dark", labelKey: "深色" },
  { value: "custom", labelKey: "自定义颜色" },
];

export const TERMINAL_BACKGROUND_OPTIONS: Array<{
  value: TerminalBackgroundMode;
  labelKey: TranslationKey;
}> = [
  { value: "auto", labelKey: "自动" },
  { value: "light", labelKey: "浅色" },
  { value: "dark", labelKey: "深色" },
  { value: "custom", labelKey: "自定义颜色" },
];

export const TERMINAL_CURSOR_STYLE_OPTIONS: Array<{
  value: TerminalCursorStyle;
  labelKey: TranslationKey;
}> = [
  { value: "bar", labelKey: "Cursor style bar" },
  { value: "block", labelKey: "Cursor style block" },
  { value: "underline", labelKey: "Cursor style underline" },
];

// 可编辑的主题颜色项
export type EditableThemeColorKey = keyof Pick<
  TerminalColorScheme,
  | "foreground"
  | "cursor"
  | "selectionBackground"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
>;

export const EDITABLE_THEME_COLOR_ITEMS: Array<{ key: EditableThemeColorKey; labelKey: TranslationKey }> = [
  { key: "foreground", labelKey: "前景色" },
  { key: "cursor", labelKey: "光标颜色" },
  { key: "selectionBackground", labelKey: "选区背景" },
  { key: "black", labelKey: "黑色" },
  { key: "red", labelKey: "红色" },
  { key: "green", labelKey: "绿色" },
  { key: "yellow", labelKey: "黄色" },
  { key: "blue", labelKey: "蓝色" },
  { key: "magenta", labelKey: "洋红" },
  { key: "cyan", labelKey: "青色" },
  { key: "white", labelKey: "白色" },
];
