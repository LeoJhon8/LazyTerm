// Theme Configuration for Lazy Terminal
// 支持多种配色方案的主题配置

export interface TerminalTheme {
  name: string;
  id: string;
  // Xterm terminal colors
  terminalTheme: {
    background: string;
    foreground: string;
    cursor: string;
    selectionBackground: string;
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
  };
  // UI colors
  uiTheme: {
    backgroundColor: string;
    sidebarBackground: string;
    headerBackground: string;
    borderColor: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accentColor: string;
    dangerColor: string;
  };
}

// Dark Theme (Default) - 经典暗色主题
export const darkTheme: TerminalTheme = {
  name: 'Dark',
  id: 'dark',
  terminalTheme: {
    background: '#1e1e1e',
    foreground: '#f0f0f0',
    cursor: '#f0f0f0',
    selectionBackground: '#333333',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  },
  uiTheme: {
    backgroundColor: '#1e1e1e',
    sidebarBackground: '#1a1a1a',
    headerBackground: '#1e1e1e',
    borderColor: '#2d2d2d',
    textPrimary: '#d4d4d4',
    textSecondary: '#a0a0a0',
    textMuted: '#6a6a6a',
    accentColor: '#0dbc79',
    dangerColor: '#ff5f56',
  },
};

// Light Theme - 清爽亮色主题
export const lightTheme: TerminalTheme = {
  name: 'Light',
  id: 'light',
  terminalTheme: {
    background: '#ffffff',
    foreground: '#24292e',
    cursor: '#24292e',
    selectionBackground: '#c8e1ff',
    black: '#24292e',
    red: '#d73a49',
    green: '#28a745',
    yellow: '#dbab09',
    blue: '#0366d6',
    magenta: '#6f42c1',
    cyan: '#008cc8',
    white: '#e1e4e8',
    brightBlack: '#959da5',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  },
  uiTheme: {
    backgroundColor: '#f6f8fa',
    sidebarBackground: '#ffffff',
    headerBackground: '#ffffff',
    borderColor: '#e1e4e8',
    textPrimary: '#24292e',
    textSecondary: '#586069',
    textMuted: '#959da5',
    accentColor: '#0366d6',
    dangerColor: '#d73a49',
  },
};

// Solarized Dark - Solarized暗色主题
export const solarizedDarkTheme: TerminalTheme = {
  name: 'Solarized Dark',
  id: 'solarized-dark',
  terminalTheme: {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  uiTheme: {
    backgroundColor: '#002b36',
    sidebarBackground: '#073642',
    headerBackground: '#002b36',
    borderColor: '#586e75',
    textPrimary: '#839496',
    textSecondary: '#657b83',
    textMuted: '#586e75',
    accentColor: '#2aa198',
    dangerColor: '#dc322f',
  },
};

// Dracula Theme - Dracula暗色主题
export const draculaTheme: TerminalTheme = {
  name: 'Dracula',
  id: 'dracula',
  terminalTheme: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#000000',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#bfbfbf',
    brightBlack: '#282a36',
    brightRed: '#ff6e67',
    brightGreen: '#5af78e',
    brightYellow: '#f4f99d',
    brightBlue: '#caa9fa',
    brightMagenta: '#ff92d0',
    brightCyan: '#9aedfe',
    brightWhite: '#e6e6e6',
  },
  uiTheme: {
    backgroundColor: '#282a36',
    sidebarBackground: '#1e1f29',
    headerBackground: '#282a36',
    borderColor: '#44475a',
    textPrimary: '#f8f8f2',
    textSecondary: '#bd93f9',
    textMuted: '#6272a4',
    accentColor: '#bd93f9',
    dangerColor: '#ff5555',
  },
};

// Monokai Theme - Monokai主题
export const monokaiTheme: TerminalTheme = {
  name: 'Monokai',
  id: 'monokai',
  terminalTheme: {
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#3e3d32',
    black: '#000000',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#cfcfc2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#e6db74',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
  uiTheme: {
    backgroundColor: '#272822',
    sidebarBackground: '#1e1f1c',
    headerBackground: '#272822',
    borderColor: '#3e3d32',
    textPrimary: '#f8f8f2',
    textSecondary: '#cfcfc2',
    textMuted: '#75715e',
    accentColor: '#a6e22e',
    dangerColor: '#f92672',
  },
};

// Ocean Theme - 海洋主题
export const oceanTheme: TerminalTheme = {
  name: 'Ocean',
  id: 'ocean',
  terminalTheme: {
    background: '#0f0f14',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    selectionBackground: '#2a2e3a',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  },
  uiTheme: {
    backgroundColor: '#0f0f14',
    sidebarBackground: '#15161e',
    headerBackground: '#0f0f14',
    borderColor: '#2a2e3a',
    textPrimary: '#c0caf5',
    textSecondary: '#9aa5ce',
    textMuted: '#414868',
    accentColor: '#7aa2f7',
    dangerColor: '#f7768e',
  },
};

// Theme Registry
export const THEMES: TerminalTheme[] = [
  darkTheme,
  lightTheme,
  solarizedDarkTheme,
  draculaTheme,
  monokaiTheme,
  oceanTheme,
];

// Default theme
export const DEFAULT_THEME_ID = 'dark';

// Helper function to get theme by ID
export function getThemeById(id: string): TerminalTheme {
  return THEMES.find(theme => theme.id === id) || darkTheme;
}

// Helper function to save theme preference
export function saveThemePreference(themeId: string): void {
  localStorage.setItem('terminalTheme', themeId);
}

// Helper function to load theme preference
export function loadThemePreference(): string {
  const saved = localStorage.getItem('terminalTheme');
  if (saved && THEMES.some(theme => theme.id === saved)) {
    return saved;
  }
  return DEFAULT_THEME_ID;
}
