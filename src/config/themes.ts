export interface TerminalColorScheme {
  name: string;
  label: string;
  isDark: boolean;
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

export interface TerminalThemeEcosystem {
  name: string;
  label: string;
  darkThemeName: string;
  lightThemeName: string;
}

const APP_DARK_TERMINAL_THEME: TerminalColorScheme = {
  name: "app-dark",
  label: "跟随外观深色",
  isDark: true,
  background: "#171b24",
  foreground: "#e8ecf2",
  cursor: "#62c7d8",
  cursorAccent: "#171b24",
  selectionBackground: "#245a66",
  selectionForeground: "#ffffff",
  black: "#11141a",
  red: "#f26d78",
  green: "#7dd88f",
  yellow: "#eacb72",
  blue: "#78b7ff",
  magenta: "#c99af2",
  cyan: "#63d2dc",
  white: "#d5dbe5",
  brightBlack: "#667080",
  brightRed: "#ff8a94",
  brightGreen: "#96e7a6",
  brightYellow: "#f2dc8a",
  brightBlue: "#99caff",
  brightMagenta: "#ddb6ff",
  brightCyan: "#84e3ea",
  brightWhite: "#ffffff",
};

const APP_LIGHT_TERMINAL_THEME: TerminalColorScheme = {
  name: "app-light",
  label: "跟随外观浅色",
  isDark: false,
  background: "#f7f7f8",
  foreground: "#262d35",
  cursor: "#0f8ea1",
  cursorAccent: "#f7f7f8",
  selectionBackground: "#c8e5ea",
  selectionForeground: "#19232b",
  black: "#242b33",
  red: "#b94d55",
  green: "#2f8b62",
  yellow: "#8b7026",
  blue: "#2b6f9a",
  magenta: "#7f63aa",
  cyan: "#168995",
  white: "#d9dcdf",
  brightBlack: "#737b84",
  brightRed: "#cf6269",
  brightGreen: "#419b72",
  brightYellow: "#9d8336",
  brightBlue: "#347fae",
  brightMagenta: "#9175bc",
  brightCyan: "#25a0aa",
  brightWhite: "#ffffff",
};

function getSystemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveAppIsDark(appBackgroundColor?: "system" | "light" | "dark"): boolean {
  return appBackgroundColor === "dark" || (appBackgroundColor !== "light" && getSystemPrefersDark());
}

export const DEFAULT_DARK_THEME: Omit<TerminalColorScheme, "name" | "label"> = {
  isDark: true,
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#528bff",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
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
};

export const TERMINAL_THEMES: TerminalColorScheme[] = [
  {
    name: "system-auto",
    label: "跟随外观主题 (自动)",
    isDark: true,
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
    name: "vscode-dark",
    label: "VS Code 风格深色",
    isDark: true,
    background: "#1e1e1e",
    foreground: "#cccccc",
    cursor: "#528bff",
    cursorAccent: "#1e1e1e",
    selectionBackground: "#264f78",
    selectionForeground: "#ffffff",
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
    name: "vscode-light",
    label: "VS Code 风格浅色",
    isDark: false,
    background: "#ffffff",
    foreground: "#333333",
    cursor: "#007acc",
    cursorAccent: "#ffffff",
    selectionBackground: "#add6ff",
    selectionForeground: "#000000",
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
    name: "github-dark",
    label: "GitHub 风格深色",
    isDark: true,
    background: "#0d1117",
    foreground: "#c9d1d9",
    cursor: "#58a6ff",
    cursorAccent: "#0d1117",
    selectionBackground: "#1f6feb55",
    selectionForeground: "#ffffff",
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#f0f6fc",
  },
  {
    name: "github-light",
    label: "GitHub 风格浅色",
    isDark: false,
    background: "#ffffff",
    foreground: "#24292f",
    cursor: "#0969da",
    cursorAccent: "#ffffff",
    selectionBackground: "#0969da33",
    selectionForeground: "#24292f",
    black: "#24292f",
    red: "#cf222e",
    green: "#116329",
    yellow: "#4d2d00",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#d0d7de",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#1a7f37",
    brightYellow: "#9a6700",
    brightBlue: "#218bff",
    brightMagenta: "#a475f9",
    brightCyan: "#3192aa",
    brightWhite: "#f6f8fa",
  },
  {
    name: "google-dark",
    label: "Google 风格深色",
    isDark: true,
    background: "#202124",
    foreground: "#e8eaed",
    cursor: "#8ab4f8",
    cursorAccent: "#202124",
    selectionBackground: "#3c4043",
    selectionForeground: "#ffffff",
    black: "#202124",
    red: "#f28b82",
    green: "#81c995",
    yellow: "#fdd663",
    blue: "#8ab4f8",
    magenta: "#c58af9",
    cyan: "#78d9ec",
    white: "#e8eaed",
    brightBlack: "#5f6368",
    brightRed: "#f6aea9",
    brightGreen: "#a8dab5",
    brightYellow: "#fde293",
    brightBlue: "#aecbfa",
    brightMagenta: "#d7aefb",
    brightCyan: "#cbf0f8",
    brightWhite: "#ffffff",
  },
  {
    name: "google-light",
    label: "Google 风格浅色",
    isDark: false,
    background: "#ffffff",
    foreground: "#202124",
    cursor: "#1a73e8",
    cursorAccent: "#ffffff",
    selectionBackground: "#d2e3fc",
    selectionForeground: "#202124",
    black: "#202124",
    red: "#d93025",
    green: "#188038",
    yellow: "#b06000",
    blue: "#1a73e8",
    magenta: "#a142f4",
    cyan: "#007b83",
    white: "#dadce0",
    brightBlack: "#5f6368",
    brightRed: "#ea4335",
    brightGreen: "#34a853",
    brightYellow: "#fbbc04",
    brightBlue: "#4285f4",
    brightMagenta: "#c58af9",
    brightCyan: "#12a4af",
    brightWhite: "#f8fafd",
  },
  {
    name: "apple-dark",
    label: "Apple 风格深色",
    isDark: true,
    background: "#1c1c1e",
    foreground: "#f2f2f7",
    cursor: "#0a84ff",
    cursorAccent: "#1c1c1e",
    selectionBackground: "#0a84ff55",
    selectionForeground: "#ffffff",
    black: "#1c1c1e",
    red: "#ff453a",
    green: "#30d158",
    yellow: "#ffd60a",
    blue: "#0a84ff",
    magenta: "#bf5af2",
    cyan: "#64d2ff",
    white: "#f2f2f7",
    brightBlack: "#636366",
    brightRed: "#ff6961",
    brightGreen: "#32d74b",
    brightYellow: "#ffdf4d",
    brightBlue: "#409cff",
    brightMagenta: "#da8fff",
    brightCyan: "#80dfff",
    brightWhite: "#ffffff",
  },
  {
    name: "apple-light",
    label: "Apple 风格浅色",
    isDark: false,
    background: "#f5f5f7",
    foreground: "#1d1d1f",
    cursor: "#007aff",
    cursorAccent: "#f5f5f7",
    selectionBackground: "#007aff33",
    selectionForeground: "#1d1d1f",
    black: "#1d1d1f",
    red: "#ff3b30",
    green: "#34c759",
    yellow: "#a15c00",
    blue: "#007aff",
    magenta: "#af52de",
    cyan: "#32ade6",
    white: "#d1d1d6",
    brightBlack: "#6e6e73",
    brightRed: "#d70015",
    brightGreen: "#248a3d",
    brightYellow: "#ffcc00",
    brightBlue: "#0a84ff",
    brightMagenta: "#bf5af2",
    brightCyan: "#64d2ff",
    brightWhite: "#ffffff",
  },
  {
    name: "jetbrains-dark",
    label: "JetBrains 风格深色",
    isDark: true,
    background: "#1e1f22",
    foreground: "#bcbec4",
    cursor: "#c6c8d0",
    cursorAccent: "#1e1f22",
    selectionBackground: "#2f65ca66",
    selectionForeground: "#ffffff",
    black: "#1e1f22",
    red: "#f75464",
    green: "#6aab73",
    yellow: "#caa24d",
    blue: "#548af7",
    magenta: "#c77dbb",
    cyan: "#2aacb8",
    white: "#bcbec4",
    brightBlack: "#6c707e",
    brightRed: "#ff6470",
    brightGreen: "#7bc47f",
    brightYellow: "#e5bd5d",
    brightBlue: "#6da0ff",
    brightMagenta: "#d991cd",
    brightCyan: "#37c7d4",
    brightWhite: "#ffffff",
  },
  {
    name: "jetbrains-light",
    label: "JetBrains 风格浅色",
    isDark: false,
    background: "#ffffff",
    foreground: "#19191c",
    cursor: "#005fb8",
    cursorAccent: "#ffffff",
    selectionBackground: "#d4e4ff",
    selectionForeground: "#19191c",
    black: "#19191c",
    red: "#cf232e",
    green: "#067d17",
    yellow: "#8c6c00",
    blue: "#005fb8",
    magenta: "#7a3e9d",
    cyan: "#007c7c",
    white: "#dfe1e5",
    brightBlack: "#6c707e",
    brightRed: "#d9343f",
    brightGreen: "#128a26",
    brightYellow: "#a67f00",
    brightBlue: "#167dff",
    brightMagenta: "#8e4ec6",
    brightCyan: "#0097a7",
    brightWhite: "#ffffff",
  },
];

export const TERMINAL_THEME_ECOSYSTEMS: TerminalThemeEcosystem[] = [
  {
    name: "system-auto",
    label: "跟随外观主题 (自动)",
    darkThemeName: "app-dark",
    lightThemeName: "app-light",
  },
  {
    name: "vscode",
    label: "VS Code 风格",
    darkThemeName: "vscode-dark",
    lightThemeName: "vscode-light",
  },
  {
    name: "github",
    label: "GitHub 风格",
    darkThemeName: "github-dark",
    lightThemeName: "github-light",
  },
  {
    name: "google",
    label: "Google 风格",
    darkThemeName: "google-dark",
    lightThemeName: "google-light",
  },
  {
    name: "apple",
    label: "Apple 风格",
    darkThemeName: "apple-dark",
    lightThemeName: "apple-light",
  },
  {
    name: "jetbrains",
    label: "JetBrains 风格",
    darkThemeName: "jetbrains-dark",
    lightThemeName: "jetbrains-light",
  },
];

const THEME_ECOSYSTEM_BY_NAME = new Map(
  TERMINAL_THEME_ECOSYSTEMS.map((theme) => [theme.name, theme])
);

const THEME_ECOSYSTEM_BY_VARIANT_NAME = new Map(
  TERMINAL_THEME_ECOSYSTEMS.flatMap((theme) => [
    [theme.darkThemeName, theme.name],
    [theme.lightThemeName, theme.name],
  ])
);

const LEGACY_THEME_NAME_ALIASES: Record<string, string> = {
  "default-dark": "vscode",
  "default-light": "vscode",
  "one-dark": "vscode",
  "one-light": "vscode",
  nord: "apple",
  "solarized-dark": "github",
  "solarized-light": "github",
  "catppuccin-mocha": "jetbrains",
  "catppuccin-latte": "jetbrains",
  dracula: "jetbrains",
  "gruvbox-light": "github",
  monokai: "jetbrains",
};

export function normalizeTerminalThemeName(schemeName: string): string {
  return (
    LEGACY_THEME_NAME_ALIASES[schemeName] ??
    THEME_ECOSYSTEM_BY_VARIANT_NAME.get(schemeName) ??
    schemeName
  );
}

export function getTerminalTheme(
  schemeName: string,
  customThemes?: TerminalColorScheme[],
  appBackgroundColor?: "system" | "light" | "dark"
): TerminalColorScheme {
  if (customThemes && customThemes.length > 0) {
    const found = customThemes.find((t) => t.name === schemeName);
    if (found) return found;
  }

  const resolvedSchemeName = normalizeTerminalThemeName(schemeName);

  if (resolvedSchemeName === "custom") {
    return TERMINAL_THEMES[1];
  }

  if (resolvedSchemeName === "system-auto") {
    return resolveAppIsDark(appBackgroundColor)
      ? APP_DARK_TERMINAL_THEME
      : APP_LIGHT_TERMINAL_THEME;
  }

  const ecosystem = THEME_ECOSYSTEM_BY_NAME.get(resolvedSchemeName);
  if (ecosystem) {
    const themeName = resolveAppIsDark(appBackgroundColor)
      ? ecosystem.darkThemeName
      : ecosystem.lightThemeName;

    return (
      TERMINAL_THEMES.find((t) => t.name === themeName) ||
      TERMINAL_THEMES[1]
    );
  }

  return (
    TERMINAL_THEMES.find((t) => t.name === resolvedSchemeName) ||
    TERMINAL_THEMES[1]
  );
}

export function toXtermTheme(scheme: TerminalColorScheme, opacityPercent: number = 100) {
  const bg = scheme.background;
  const backgroundWithOpacity =
    opacityPercent <= 0
      ? "rgba(0,0,0,0)"
      : opacityPercent < 100
        ? (bg === "transparent" ? "transparent" : hexToRgba(bg, opacityPercent / 100))
        : bg;

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
