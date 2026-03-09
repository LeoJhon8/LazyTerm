// 终端配色方案预设
// 每个方案包含 xterm ITheme 兼容的完整 ANSI 16 色

export interface TerminalColorScheme {
  name: string;
  label: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_THEMES: TerminalColorScheme[] = [
  {
    name: "default-dark",
    label: "默认深色",
    background: "#1e1e1e",
    foreground: "#cccccc",
    cursor: "#528bff",
    cursorAccent: "#1e1e1e",
    selectionBackground: "rgba(82,139,255,0.4)",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  },
  {
    name: "default-light",
    label: "默认浅色",
    background: "#ffffff",
    foreground: "#333333",
    cursor: "#007acc",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0,122,204,0.3)",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc00",
    yellow: "#949800",
    blue: "#0451a5",
    magenta: "#bc05bc",
    cyan: "#0598bc",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#cd3131",
    brightGreen: "#14ce14",
    brightYellow: "#b5ba00",
    brightBlue: "#0451a5",
    brightMagenta: "#bc05bc",
    brightCyan: "#0598bc",
    brightWhite: "#a5a5a5",
  },
  {
    name: "dracula",
    label: "Dracula",
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "rgba(68,71,90,0.7)",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  {
    name: "one-dark",
    label: "One Dark",
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    cursorAccent: "#282c34",
    selectionBackground: "rgba(82,139,255,0.3)",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#be5046",
    brightGreen: "#98c379",
    brightYellow: "#d19a66",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  {
    name: "nord",
    label: "Nord",
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "rgba(136,192,208,0.3)",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  },
  {
    name: "solarized-dark",
    label: "Solarized Dark",
    background: "#002b36",
    foreground: "#839496",
    cursor: "#839496",
    cursorAccent: "#002b36",
    selectionBackground: "rgba(7,54,66,0.8)",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  {
    name: "solarized-light",
    label: "Solarized Light",
    background: "#fdf6e3",
    foreground: "#657b83",
    cursor: "#657b83",
    cursorAccent: "#fdf6e3",
    selectionBackground: "rgba(238,232,213,0.8)",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
  {
    name: "monokai",
    label: "Monokai",
    background: "#272822",
    foreground: "#f8f8f2",
    cursor: "#f8f8f0",
    cursorAccent: "#272822",
    selectionBackground: "rgba(73,72,62,0.7)",
    black: "#272822",
    red: "#f92672",
    green: "#a6e22e",
    yellow: "#f4bf75",
    blue: "#66d9ef",
    magenta: "#ae81ff",
    cyan: "#a1efe4",
    white: "#f8f8f2",
    brightBlack: "#75715e",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#f4bf75",
    brightBlue: "#66d9ef",
    brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4",
    brightWhite: "#f9f8f5",
  },
  {
    name: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
    cursorAccent: "#1e1e2e",
    selectionBackground: "rgba(88,91,112,0.5)",
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
  {
    name: "system-auto",
    label: "跟随外观主题 (自动)",
    background: "auto",
    foreground: "auto",
    cursor: "auto",
    cursorAccent: "auto",
    selectionBackground: "auto",
    black: "auto",
    red: "auto",
    green: "auto",
    yellow: "auto",
    blue: "auto",
    magenta: "auto",
    cyan: "auto",
    white: "auto",
    brightBlack: "auto",
    brightRed: "auto",
    brightGreen: "auto",
    brightYellow: "auto",
    brightBlue: "auto",
    brightMagenta: "auto",
    brightCyan: "auto",
    brightWhite: "auto",
  },
  {
    name: "custom",
    label: "自定义",
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#ffffff",
    cursorAccent: "#000000",
    selectionBackground: "rgba(255,255,255,0.3)",
    black: "#000000",
    red: "#ff0000",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#0000ff",
    magenta: "#ff00ff",
    cyan: "#00ffff",
    white: "#ffffff",
    brightBlack: "#808080",
    brightRed: "#ff0000",
    brightGreen: "#00ff00",
    brightYellow: "#ffff00",
    brightBlue: "#0000ff",
    brightMagenta: "#ff00ff",
    brightCyan: "#00ffff",
    brightWhite: "#ffffff",
  }
];

/**
 * 根据配色方案名称获取对应的 xterm ITheme 对象
 */
export function getTerminalTheme(schemeName: string, customThemeConfig?: TerminalColorScheme): TerminalColorScheme {
  if (schemeName === "custom" && customThemeConfig) {
    return customThemeConfig;
  }

  if (schemeName === "system-auto") {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return getTerminalTheme(isDark ? "default-dark" : "default-light", customThemeConfig);
  }

  return (
    TERMINAL_THEMES.find((t) => t.name === schemeName) ||
    TERMINAL_THEMES[0] // fallback to default-dark
  );
}

/**
 * 将 TerminalColorScheme 转换为 xterm ITheme 格式
 */
export function toXtermTheme(scheme: TerminalColorScheme, opacityPercent: number = 100) {
  const bg = scheme.background;
  // 如果需要半透明背景，将 hex 转为 rgba
  const backgroundWithOpacity =
    opacityPercent < 100 ? (bg === "transparent" ? "transparent" : hexToRgba(bg, opacityPercent / 100)) : bg;

  return {
    background: backgroundWithOpacity,
    foreground: scheme.foreground,
    cursor: scheme.cursor,
    cursorAccent: scheme.cursorAccent,
    selectionBackground: scheme.selectionBackground,
    selectionForeground: scheme.selectionForeground,
    black: scheme.black,
    red: scheme.red,
    green: scheme.green,
    yellow: scheme.yellow,
    blue: scheme.blue,
    magenta: scheme.magenta,
    cyan: scheme.cyan,
    white: scheme.white,
    brightBlack: scheme.brightBlack,
    brightRed: scheme.brightRed,
    brightGreen: scheme.brightGreen,
    brightYellow: scheme.brightYellow,
    brightBlue: scheme.brightBlue,
    brightMagenta: scheme.brightMagenta,
    brightCyan: scheme.brightCyan,
    brightWhite: scheme.brightWhite,
  };
}

/**
 * 将 hex 颜色转为 rgba
 */
function hexToRgba(hex: string, alpha: number): string {
  hex = hex.replace("#", "");
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  if (hex.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
