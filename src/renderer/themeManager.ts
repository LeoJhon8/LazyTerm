import { Logger } from './logger';
import { getThemeById, TerminalTheme } from './themes';

export class ThemeManager {
  private currentThemeId: string;
  private xtermWrappers: Set<any> = new Set();

  constructor() {
    this.currentThemeId = getThemeById(localStorage.getItem('terminalTheme') || 'dark').id;
  }

  public applyTheme(themeId: string): void {
    const theme = getThemeById(themeId);
    this.currentThemeId = themeId;

    // Apply UI theme
    this.applyUITheme(theme.uiTheme);

    // Apply terminal theme to all existing xterm instances
    this.applyTerminalTheme(theme.terminalTheme);

    Logger.info('ThemeManager', `Applied theme: ${theme.name}`);
  }

  private applyUITheme(uiTheme: TerminalTheme['uiTheme']): void {
    const root = document.documentElement;

    // Apply CSS custom properties
    root.style.setProperty('--bg-color', uiTheme.backgroundColor);
    root.style.setProperty('--sidebar-bg', uiTheme.sidebarBackground);
    root.style.setProperty('--header-bg', uiTheme.headerBackground);
    root.style.setProperty('--border-color', uiTheme.borderColor);
    root.style.setProperty('--text-primary', uiTheme.textPrimary);
    root.style.setProperty('--text-secondary', uiTheme.textSecondary);
    root.style.setProperty('--text-muted', uiTheme.textMuted);
    root.style.setProperty('--accent-color', uiTheme.accentColor);
    root.style.setProperty('--danger-color', uiTheme.dangerColor);

    // Apply to main container
    const mainContainer = document.querySelector('.terminal-main');
    if (mainContainer) {
      (mainContainer as HTMLElement).style.background = uiTheme.backgroundColor;
    }

    // Apply to sidebars
    const shortcutBar = document.querySelector('.shortcut-bar');
    if (shortcutBar) {
      (shortcutBar as HTMLElement).style.background = uiTheme.sidebarBackground;
      (shortcutBar as HTMLElement).style.borderColor = uiTheme.borderColor;
    }

    const historySidebar = document.querySelector('.history-sidebar');
    if (historySidebar) {
      (historySidebar as HTMLElement).style.background = uiTheme.sidebarBackground;
      (historySidebar as HTMLElement).style.borderColor = uiTheme.borderColor;
    }

    // Apply to modals
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => {
      (modal as HTMLElement).style.background = uiTheme.backgroundColor;
      (modal as HTMLElement).style.color = uiTheme.textPrimary;
    });

    // Apply to forms and inputs
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      (input as HTMLElement).style.background = uiTheme.sidebarBackground;
      (input as HTMLElement).style.borderColor = uiTheme.borderColor;
      (input as HTMLElement).style.color = uiTheme.textPrimary;
    });

    // Apply to history items
    const historyItems = document.querySelectorAll('.history-item');
    historyItems.forEach(item => {
      (item as HTMLElement).style.background = uiTheme.sidebarBackground;
      (item as HTMLElement).style.borderColor = uiTheme.borderColor;
    });

    // Apply to tabs
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
      (tab as HTMLElement).style.background = uiTheme.sidebarBackground;
      (tab as HTMLElement).style.color = uiTheme.textSecondary;
    });

    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      (activeTab as HTMLElement).style.background = uiTheme.backgroundColor;
      (activeTab as HTMLElement).style.color = uiTheme.textPrimary;
    }
  }

  private applyTerminalTheme(terminalTheme: TerminalTheme['terminalTheme']): void {
    this.xtermWrappers.forEach(wrapper => {
      try {
        wrapper.updateTheme(terminalTheme);
      } catch (e) {
        Logger.error('ThemeManager', 'Failed to apply theme to xterm instance', e);
      }
    });
  }

  public registerXtermWrapper(wrapper: any): void {
    this.xtermWrappers.add(wrapper);

    // Apply current theme to new wrapper
    const theme = getThemeById(this.currentThemeId);
    try {
      wrapper.updateTheme(theme.terminalTheme);
    } catch (e) {
      Logger.error('ThemeManager', 'Failed to apply theme to new xterm instance', e);
    }
  }

  public unregisterXtermWrapper(wrapper: any): void {
    this.xtermWrappers.delete(wrapper);
  }

  public updateAllTerminals(options: { fontSize?: number; fontFamily?: string }): void {
    this.xtermWrappers.forEach(wrapper => {
      try {
        if (options.fontSize !== undefined) {
          wrapper.setFontSize(options.fontSize);
        }
        if (options.fontFamily !== undefined) {
          wrapper.setFontFamily(options.fontFamily);
        }
      } catch (e) {
        Logger.error('ThemeManager', 'Failed to update terminal options', e);
      }
    });

    // Update localStorage for font settings
    if (options.fontSize !== undefined) {
      localStorage.setItem('terminalFontSize', options.fontSize.toString());
    }
    if (options.fontFamily !== undefined) {
      localStorage.setItem('terminalFontFamily', options.fontFamily);
    }
  }

  public getCurrentThemeId(): string {
    return this.currentThemeId;
  }

  public getCurrentTheme(): TerminalTheme {
    return getThemeById(this.currentThemeId);
  }
}
