import { Logger } from './logger';
import {
  THEMES,
  getThemeById,
  saveThemePreference,
  loadThemePreference,
  TerminalTheme,
} from './themes';
import { ThemeManager } from './themeManager';

export interface SettingsConfig {
  themeId: string;
  fontSize: number;
  fontFamily: string;
}

export class SettingsUI {
  private static instance: SettingsUI;
  private elements: {
    modal: HTMLElement | null;
    closeModalBtns: NodeListOf<HTMLElement> | null;
    themeSelect: HTMLSelectElement | null;
    themePreview: HTMLElement | null;
    fontSizeSlider: HTMLInputElement | null;
    fontSizeValue: HTMLElement | null;
    fontFamilySelect: HTMLSelectElement | null;
    saveBtn: HTMLElement | null;
  } = {
    modal: null,
    closeModalBtns: null,
    themeSelect: null,
    themePreview: null,
    fontSizeSlider: null,
    fontSizeValue: null,
    fontFamilySelect: null,
    saveBtn: null,
  };

  private config: SettingsConfig = {
    themeId: loadThemePreference(),
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
  };

  private themeManager: ThemeManager;

  constructor() {
    this.themeManager = new ThemeManager();
    this.initElements();
    this.initEventListeners();
  }

  static getInstance(): SettingsUI {
    if (!SettingsUI.instance) {
      SettingsUI.instance = new SettingsUI();
    }
    return SettingsUI.instance;
  }

  private initElements(): void {
    this.elements = {
      modal: document.getElementById('settingsModal'),
      closeModalBtns: document.querySelectorAll(
        '#settingsModal .close-btn, #settingsModal .cancel'
      ),
      themeSelect: document.getElementById('themeSelect') as HTMLSelectElement,
      themePreview: document.getElementById('themePreview'),
      fontSizeSlider: document.getElementById('fontSizeSlider') as HTMLInputElement,
      fontSizeValue: document.getElementById('fontSizeValue'),
      fontFamilySelect: document.getElementById('fontFamilySelect') as HTMLSelectElement,
      saveBtn: document.getElementById('saveSettingsBtn'),
    };

    // Populate theme options
    if (this.elements.themeSelect) {
      this.elements.themeSelect.innerHTML = '';
      THEMES.forEach(theme => {
        const option = document.createElement('option');
        option.value = theme.id;
        option.textContent = theme.name;
        if (theme.id === this.config.themeId) {
          option.selected = true;
        }
        this.elements.themeSelect.appendChild(option);
      });
    }

    // Load saved values
    this.loadSavedConfig();
  }

  private loadSavedConfig(): void {
    const savedFontSize = localStorage.getItem('terminalFontSize');
    if (savedFontSize) {
      this.config.fontSize = parseInt(savedFontSize, 10);
    }

    const savedFontFamily = localStorage.getItem('terminalFontFamily');
    if (savedFontFamily) {
      this.config.fontFamily = savedFontFamily;
    }

    // Update UI with loaded values
    if (this.elements.fontSizeSlider) {
      this.elements.fontSizeSlider.value = this.config.fontSize.toString();
    }
    if (this.elements.fontSizeValue) {
      this.elements.fontSizeValue.textContent = this.config.fontSize.toString();
    }
    if (this.elements.fontFamilySelect) {
      this.elements.fontFamilySelect.value = this.config.fontFamily;
    }

    // Update theme preview
    this.updateThemePreview();
  }

  private initEventListeners(): void {
    const { modal, closeModalBtns, themeSelect, fontSizeSlider, fontFamilySelect, saveBtn } =
      this.elements;

    // Close modal buttons
    closeModalBtns?.forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        this.close();
      });
    });

    // Click outside modal to close
    modal?.addEventListener('click', e => {
      if (e.target === modal) {
        this.close();
      }
    });

    // Theme selection
    themeSelect?.addEventListener('change', e => {
      this.config.themeId = (e.target as HTMLSelectElement).value;
      this.updateThemePreview();
    });

    // Font size slider
    fontSizeSlider?.addEventListener('input', e => {
      const value = parseInt((e.target as HTMLInputElement).value, 10);
      this.config.fontSize = value;
      if (this.elements.fontSizeValue) {
        this.elements.fontSizeValue.textContent = value.toString();
      }
    });

    // Font family selection
    fontFamilySelect?.addEventListener('change', e => {
      this.config.fontFamily = (e.target as HTMLSelectElement).value;
    });

    // Save button
    saveBtn?.addEventListener('click', e => {
      e.preventDefault();
      this.save();
    });
  }

  private updateThemePreview(): void {
    if (!this.elements.themePreview) return;

    const theme = getThemeById(this.config.themeId);
    const { terminalTheme, uiTheme } = theme;

    // Create preview content
    this.elements.themePreview.style.background = terminalTheme.background;
    this.elements.themePreview.style.color = terminalTheme.foreground;
    this.elements.themePreview.style.border = `2px solid ${uiTheme.borderColor}`;
    this.elements.themePreview.style.padding = '16px';
    this.elements.themePreview.style.borderRadius = '8px';
    this.elements.themePreview.style.fontFamily =
      'Menlo, Monaco, Consolas, "Courier New", monospace';

    this.elements.themePreview.innerHTML = `
      <div style="margin-bottom: 8px;">
        <span style="color: ${terminalTheme.green}">$</span> <span style="color: ${terminalTheme.cyan}">git</span> status
      </div>
      <div style="color: ${terminalTheme.brightBlack}; margin-bottom: 8px;">
        On branch main
      </div>
      <div style="color: ${terminalTheme.green};">
        Changes to be committed:
      </div>
      <div style="color: ${terminalTheme.brightBlack}; margin-left: 16px;">
        <span style="color: ${terminalTheme.yellow};">modified:</span> themes.ts
      </div>
      <div style="color: ${terminalTheme.red};">
        Untracked files:
      </div>
      <div style="color: ${terminalTheme.brightBlack}; margin-left: 16px;">
        <span style="color: ${terminalTheme.red};">new file:</span> settings.ts
      </div>
    `;
  }

  public open(): void {
    const { modal } = this.elements;
    if (modal) {
      (modal as HTMLDialogElement).showModal();
    }
  }

  public close(): void {
    const { modal } = this.elements;
    if (modal) {
      (modal as HTMLDialogElement).close();
    }
  }

  public save(): void {
    // Save theme preference
    saveThemePreference(this.config.themeId);

    // Apply the theme
    this.themeManager.applyTheme(this.config.themeId);

    // Save font size
    localStorage.setItem('terminalFontSize', this.config.fontSize.toString());

    // Save font family
    localStorage.setItem('terminalFontFamily', this.config.fontFamily);

    // Update existing terminals
    this.themeManager.updateAllTerminals({
      fontSize: this.config.fontSize,
      fontFamily: this.config.fontFamily,
    });

    Logger.info(
      'SettingsUI',
      `Settings saved: theme=${this.config.themeId}, fontSize=${this.config.fontSize}`
    );
    this.close();
  }

  public getConfig(): SettingsConfig {
    return { ...this.config };
  }
}

export default SettingsUI;
