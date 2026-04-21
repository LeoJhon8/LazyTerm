import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AVAILABLE_MODULES, LOCKED_MODULES } from "@/config/default-slot-config";
import type { SlotConfig } from "@/config/default-slot-config";
import { useSlotConfigStore } from "@/store/slot-config";
import { useSettingsStore } from "@/store/settings";
import { useSshProfilesStore } from "@/store/ssh-profiles";
import { useQuickCommandsStore } from "@/store/quick-commands";
import { useTabsStore } from "@/store/tabs";
import { useGitSyncStore } from "@/store/git-sync";
import { checkGitRepo, commitAndPushGitRepo, pullGitRepo } from "@/services/gitService";
import type { TerminalColorScheme } from "@/config/themes";
import { TERMINAL_THEMES } from "@/config/themes";
import { FileJson, Upload, Trash2, ImagePlus, X, Palette, LayoutPanelLeft, Database, Terminal, Plus, Info, CloudDownload, RefreshCw, GitBranch, Send, Download } from "lucide-react";
import { useEffect as useMountedEffect } from "react";
import { APP_LANGUAGE_OPTIONS, getModuleDisplayName, getTerminalThemeDisplayName, useI18n, type TranslationKey } from "@/i18n";

// 引入 Tauri 原生 API
import { save, open as openDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';

// --- 类型定义 ---
interface SlotConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}



// 可选字体列表
const FONT_OPTIONS = [
  { value: "Cascadia Code, Menlo, monospace", label: "Cascadia Code" },
  { value: "JetBrains Mono, Menlo, monospace", label: "JetBrains Mono" },
  { value: "Fira Code, Menlo, monospace", label: "Fira Code" },
  { value: "Source Code Pro, Menlo, monospace", label: "Source Code Pro" },
  { value: "Consolas, Menlo, monospace", label: "Consolas" },
  { value: "Menlo, Monaco, 'Courier New', monospace", label: "Menlo" },
  { value: "Monaco, Menlo, monospace", label: "Monaco" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "monospace", label: "系统等宽字体" },
];

const APP_BACKGROUND_OPTIONS: Array<{
  value: "system" | "light" | "dark";
  label: string;
}> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

type EditableThemeColorKey = keyof Pick<
  TerminalColorScheme,
  | "background"
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

const EDITABLE_THEME_COLOR_ITEMS: Array<{ key: EditableThemeColorKey; label: TranslationKey }> = [
  { key: "background", label: "背景色" },
  { key: "foreground", label: "前景色" },
  { key: "cursor", label: "光标颜色" },
  { key: "selectionBackground", label: "选区背景" },
  { key: "black", label: "黑色" },
  { key: "red", label: "红色" },
  { key: "green", label: "绿色" },
  { key: "yellow", label: "黄色" },
  { key: "blue", label: "蓝色" },
  { key: "magenta", label: "洋红" },
  { key: "cyan", label: "青色" },
  { key: "white", label: "白色" },
];

interface SlotSettingsProps {
  currentConfig: SlotConfig;
  onToggle: (side: "left" | "right", moduleId: string) => void;
  onActiveChange: (side: "left" | "right", moduleId: string) => void;
  resetToDefault: () => void;
}

import type { ShellInfo } from "@/types/shell";
import { getAvailableShells } from "@/services/shellService";

// --- 子组件 1：主题与外观设置 ---
function ThemeSettings() {
  const { language, locale, setLanguage, t } = useI18n();
  const appBackgroundColor = useSettingsStore((state) => state.appBackgroundColor);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const customThemeColors = useSettingsStore((state) => state.customThemeColors);
  const terminalOpacity = useSettingsStore((state) => state.terminalOpacity);
  const backgroundImageEnabled = useSettingsStore((state) => state.backgroundImageEnabled);
  const backgroundImage = useSettingsStore((state) => state.backgroundImage);
  const backgroundImagePath = useSettingsStore((state) => state.backgroundImagePath);
  const backgroundImageUiMode = useSettingsStore((state) => state.backgroundImageUiMode);
  const backgroundBlur = useSettingsStore((state) => state.backgroundBlur);
  const backgroundOpacity = useSettingsStore((state) => state.backgroundOpacity);
  const uiOpacity = useSettingsStore((state) => state.uiOpacity);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const handlePickBackgroundImage = async () => {
    try {
      const selected = await openDialog({
        title: t("选择背景图片"),
        multiple: false,
        filters: [
          { name: t("图片"), extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] },
        ],
      });
      if (selected) {
        const assetUrl = convertFileSrc(selected as string);
        setSettings({ backgroundImage: assetUrl, backgroundImagePath: selected as string });
      }
    } catch (e) {
      logger.error("FE/dialog/slot-config", "Failed to select background image", {e});
    }
  };

  const isDarkApp = appBackgroundColor === 'system'
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : appBackgroundColor === 'dark';

  const filteredThemes = TERMINAL_THEMES.filter(t =>
    t.name === 'custom' || t.name === 'system-auto' || t.isDark === isDarkApp
  );

  const resolvePreviewColor = (color: string, fallback: string) => {
    return color === 'auto' ? fallback : color;
  };

  return (
    <div className="flex flex-col h-full relative">

      <div className="space-y-8 pb-10 px-1">

        {/* ======================= */}
        {/* 0. 语言 */}
        {/* ======================= */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">{t("界面语言")}</Label>
          <Select value={language} onValueChange={(value) => setLanguage(value as typeof language)}>
            <SelectTrigger className="h-9 bg-background focus:ring-primary/50 transition-shadow">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("初步提供中文和英文界面，默认跟随系统语言。")}
          </p>
        </div>

        <Separator className="bg-muted/60" />

        {/* ======================= */}
        {/* 1. 配色方案 */}
        {/* ======================= */}
        <div className="flex flex-col gap-3.5">
          <Label className="text-base font-semibold">{t("整体配色方案")}</Label>
          <div className="flex flex-wrap gap-3 items-center">
            {APP_BACKGROUND_OPTIONS.map(opt => (
              <Button
                key={opt.value}
                variant="outline"
                size="sm"
                className={cn(
                  "px-6 rounded-full transition-all duration-200 border",
                  appBackgroundColor === opt.value 
                    ? "border-primary/50 bg-primary/10 text-primary shadow-sm font-semibold ring-1 ring-primary/20"
                    : "border-border/60 hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                )}
                onClick={() => {
                  const newAppBg = opt.value as "system" | "light" | "dark";
                  const willBeDark = newAppBg === 'system'
                    ? window.matchMedia("(prefers-color-scheme: dark)").matches
                    : newAppBg === 'dark';
                  
                  const updates: any = { appBackgroundColor: newAppBg };
                  
                  if (isDarkApp !== willBeDark || newAppBg === 'system') {
                    if (newAppBg === 'system') {
                      updates.terminalColorScheme = 'system-auto';
                    } else if (willBeDark) {
                      updates.terminalColorScheme = 'default-dark';
                    } else {
                      updates.terminalColorScheme = 'default-light';
                    }
                  }
                  
                  setSettings(updates);
                }}
              >{opt.value === "system" ? t("跟随系统") : opt.value === "light" ? t("浅色") : t("深色")}</Button>
            ))}
          </div>
        </div>

        <Separator className="bg-muted/60" />

        {/* ======================= */}
        {/* 2. 字体设置 */}
        {/* ======================= */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">{t("字体设置")}</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">{t("字体族")}</Label>
              <Select value={fontFamily} onValueChange={(v) => setSettings({ fontFamily: v })}>
                <SelectTrigger className="h-9 bg-background focus:ring-primary/50 transition-shadow">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="cursor-pointer">
                      <span style={{ fontFamily: f.value }}>
                        {f.value === "monospace" ? t("系统等宽字体") : f.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">{t("字体大小")}</Label>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono font-medium">{fontSize}px</span>
              </div>
              <input type="range" min="10" max="24" step="1" value={fontSize} onChange={(e) => setSettings({ fontSize: parseInt(e.target.value) })} className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary" />
            </div>
          </div>
        </div>

        <Separator className="bg-muted/60" />

        {/* ======================= */}
        {/* 1.6. 终端主题 (联动配色方案) */}
        {/* ======================= */}
        <div className="space-y-5">
          <div className="flex justify-between items-center">
            <Label className="text-base font-semibold">{t("终端主题")}</Label>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              {t("已根据{mode}模式自动过滤", { mode: isDarkApp ? t("深色") : t("浅色") })}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {filteredThemes.map((scheme) => (
              <button
                key={scheme.name}
                onClick={() => setSettings({ terminalColorScheme: scheme.name })}
                className={cn(
                  "p-3 rounded-xl border-2 transition-all duration-300 text-left min-w-0 overflow-hidden relative group",
                  terminalColorScheme === scheme.name 
                    ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/20 transform scale-[1.02]" 
                    : "border-border/50 hover:border-primary/40 hover:shadow-md bg-card/40"
                )}
                style={{
                  backgroundColor: resolvePreviewColor(scheme.background, 'var(--background)'),
                  color: resolvePreviewColor(scheme.foreground, 'var(--foreground)'),
                }}
              >
                <div className="text-sm font-medium mb-1 truncate">{getTerminalThemeDisplayName(scheme.name, scheme.label, locale)}</div>
                <div className="text-[11px] opacity-80 mb-2 truncate">{t("Aa 文本预览")}</div>
                <div
                  className="rounded p-1.5 flex flex-wrap items-center gap-1 border"
                  style={{
                    backgroundColor: resolvePreviewColor(scheme.background, 'var(--background)'),
                    borderColor: resolvePreviewColor(scheme.brightBlack, 'var(--border)'),
                  }}
                >
                  {[scheme.red, scheme.green, scheme.yellow, scheme.blue, scheme.foreground].map((c, i) => (
                    <div
                      key={i}
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{
                        backgroundColor: c === 'auto'
                          ? (i === 0
                            ? '#ef4444'
                            : i === 1
                              ? '#22c55e'
                              : i === 2
                                ? '#eab308'
                                : i === 3
                                  ? '#3b82f6'
                                  : 'var(--foreground)')
                          : c,
                      }}
                    />
                  ))}
                </div>
              </button>
            ))}
          </div>

          {/* 自定义颜色配置区域 */}
          {terminalColorScheme === "custom" && (
            <div className="p-4 bg-muted/20 border rounded-lg space-y-4">
              <Label className="text-sm font-semibold">{t("自定义配色详情")}</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {EDITABLE_THEME_COLOR_ITEMS.map((item) => (
                  <div key={item.key} className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">{t(item.label)}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={customThemeColors[item.key] || "#000000"}
                        onChange={(e) => {
                          const newColors: TerminalColorScheme = {
                            ...customThemeColors,
                            [item.key]: e.target.value,
                          };
                          setSettings({ customThemeColors: newColors });
                        }}
                        className="w-6 h-6 p-0 border-0 rounded cursor-pointer"
                      />
                      <span className="text-xs font-mono">{customThemeColors[item.key]}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">{t("终端背景不透明度")}</Label>
                <span className="text-xs font-mono text-muted-foreground">{terminalOpacity}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" value={terminalOpacity} onChange={(e) => setSettings({ terminalOpacity: parseInt(e.target.value) })} className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">{t("UI 侧栏不透明度")}</Label>
                <span className="text-xs font-mono text-muted-foreground">{uiOpacity}%</span>
              </div>
              <input type="range" min="30" max="100" step="5" value={uiOpacity} onChange={(e) => setSettings({ uiOpacity: parseInt(e.target.value) })} className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary" />
            </div>
          </div>
        </div>

        <Separator className="bg-muted/60" />

        {/* ======================= */}
        {/* 2. 背景图片 */}
        {/* ======================= */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">{t("背景图片")}</Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="enable-bg-img"
                checked={backgroundImageEnabled}
                onCheckedChange={(c) => setSettings({ backgroundImageEnabled: !!c })}
              />
              <Label htmlFor="enable-bg-img" className="text-sm font-medium cursor-pointer">{t("开启图片背景")}</Label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handlePickBackgroundImage} disabled={!backgroundImageEnabled}>
              <ImagePlus className="h-4 w-4 mr-2" />{t("选择")}
            </Button>
            {backgroundImageEnabled && backgroundImage && (
              <Button variant="ghost" size="sm" onClick={() => setSettings({ backgroundImage: "", backgroundImagePath: "" })}>
                <X className="h-4 w-4 mr-1" />{t("清除")}
              </Button>
            )}
            <span 
              className="text-xs text-muted-foreground truncate flex-1 min-w-0"
              title={backgroundImageEnabled ? (backgroundImagePath || backgroundImage || t("未选择图片")) : t("图片背景未开启")}
            >
              {!backgroundImageEnabled ? t("图片背景未开启") : (backgroundImagePath || backgroundImage || t("未选择图片"))}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-2">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-sm text-muted-foreground">{t("界面呈现 / UI Mode")}</Label>
              <Select
                value={backgroundImageUiMode}
                onValueChange={(value) => setSettings({ backgroundImageUiMode: value as "frosted" | "clear" })}
                disabled={!backgroundImageEnabled}
              >
                <SelectTrigger className="h-9 bg-background" aria-label={t("选择图片背景模式")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="frosted">{t("保留面板毛玻璃")}</SelectItem>
                  <SelectItem value="clear">{t("完全清晰")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("保留面板毛玻璃会继续使用侧栏和终端的毛玻璃层；完全清晰会关闭这些额外模糊。")}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">{t("模糊度 / Blur")}</Label>
                <span className="text-xs font-mono text-muted-foreground">{backgroundBlur}px</span>
              </div>
              <input type="range" min="0" max="20" step="1" value={backgroundBlur} disabled={!backgroundImageEnabled} onChange={(e) => setSettings({ backgroundBlur: parseInt(e.target.value) })} className={`w-full h-2 bg-secondary rounded-lg appearance-none accent-primary ${!backgroundImageEnabled ? 'opacity-50' : 'cursor-pointer'}`} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">{t("不透明度 / Opacity")}</Label>
                <span className="text-xs font-mono text-muted-foreground">{backgroundOpacity}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" value={backgroundOpacity} disabled={!backgroundImageEnabled} onChange={(e) => setSettings({ backgroundOpacity: parseInt(e.target.value) })} className={`w-full h-2 bg-secondary rounded-lg appearance-none accent-primary ${!backgroundImageEnabled ? 'opacity-50' : 'cursor-pointer'}`} />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// --- 子组件 2：布局设置 ---
function SlotSettings({ currentConfig, onToggle, onActiveChange, resetToDefault }: SlotSettingsProps) {
  const { locale, t } = useI18n();
  const displayModules = AVAILABLE_MODULES.filter(mod =>
    !LOCKED_MODULES.includes(mod.id) &&
    mod.id !== "SettingsModule" &&
    mod.id !== "settings"
  );

  return (
    <div className="space-y-6 py-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {(["left", "right"] as const).map((side) => (
          <div key={side} className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <Label className="text-sm font-bold uppercase">
                {side === "left" ? t("← 左侧栏模块") : t("右侧栏模块 →")}
              </Label>
            </div>

            <div className="grid gap-2 p-2 border rounded-2xl bg-muted/5 shadow-inner">
              {displayModules.map((mod) => {
                const isChecked = currentConfig[side].modules.includes(mod.id);
                return (
                  <div
                    key={mod.id}
                    className={cn(
                      "flex items-center space-x-3 p-3 rounded-xl transition-all cursor-pointer border border-transparent",
                      isChecked ? 'bg-background shadow-sm border-border' : 'hover:bg-muted/50'
                    )}
                    onClick={() => onToggle(side, mod.id)}
                  >
                    <Checkbox
                      id={`${side}-${mod.id}`}
                      checked={isChecked}
                      className="pointer-events-none"
                    />
                    <span className="text-sm font-medium">{getModuleDisplayName(mod.id, locale)}</span>
                  </div>
                );
              })}
            </div>

            {currentConfig[side].modules.filter((id: string) => id !== "SettingsModule" && id !== "settings").length > 0 && (
              <div className="space-y-2 pt-2">
                <Label className="text-[11px] text-muted-foreground ml-1">{t("默认展示模块")}</Label>
                <Select
                  value={currentConfig[side].activeModule === "SettingsModule" || currentConfig[side].activeModule === "settings" ? "" : currentConfig[side].activeModule}
                  onValueChange={(v) => onActiveChange(side, v)}
                >
                  <SelectTrigger className="h-9 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentConfig[side].modules
                      .filter((id: string) => id !== "SettingsModule" && id !== "settings")
                      .map((id: string) => (
                        <SelectItem key={id} value={id}>
                          {getModuleDisplayName(id, locale)}
                        </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        ))}
      </div>

      <Separator className="bg-muted" />

      {/* 恢复默认按钮作为列表一栏 */}
      <div className="flex items-center justify-between p-6 border rounded-2xl bg-muted/5 space-x-4">
        <div>
          <Label className="text-base font-bold">{t("恢复默认布局")}</Label>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{t("如果您对当前的布局不满意，可以一键将左右侧栏的所有面板及状态恢复至初始默认设置。")}</p>
        </div>
        <Button variant="outline" size="default" className="shrink-0 font-medium px-6" onClick={() => resetToDefault()}>
          {t("恢复默认")}
        </Button>
      </div>
    </div>
  );
}

// --- 子组件 4：终端设置 ---
function TerminalSettings() {
  const { t } = useI18n();
  const { defaultShell, confirmCloseNonDefaultTabs, terminalAutocomplete, quickCmdBarEnabled, setSettings } = useSettingsStore();
  const [shells, setShells] = useState<ShellInfo[]>([]);

  useMountedEffect(() => {
    getAvailableShells()
      .then(setShells)
      .catch((err) => logger.error("FE/dialog/slot-config", "Failed to get available shells", {err}));
  }, []);

  return (
    <div className="space-y-8 py-4 px-1">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-primary" />
          <Label className="text-lg font-bold">{t("终端行为")}</Label>
        </div>

        <div className="space-y-4 p-6 border rounded-2xl bg-muted/5">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">{t("默认新建终端类型 / Default Shell")}</Label>
            <p className="text-xs text-muted-foreground mb-3">{t("点击标签栏 \"+\" 号时默认创建的终端类型")}</p>
            <div className="grid grid-cols-1 gap-2">
              {shells.map((s) => (
                <button
                  key={s.path}
                  onClick={() => setSettings({ defaultShell: s.path })}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-xl border transition-all text-left min-w-0 overflow-hidden",
                    defaultShell === s.path
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-2 rounded-lg bg-background border",
                      defaultShell === s.path ? "border-primary/30" : ""
                    )}>
                      <Terminal className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="text-sm font-bold">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{s.path}</div>
                    </div>
                  </div>
                  {defaultShell === s.path && (
                    <div className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/60 px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="confirm-close-non-default-tabs" className="text-sm font-semibold cursor-pointer">
                {t("关闭非默认连接标签页前二次确认")}
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("开启后，关闭 SSH、自定义 Shell、管理员终端等非默认连接时会先弹出确认框；通过 \"+\" 创建的默认终端不受影响。")}
              </p>
            </div>
            <Checkbox
              id="confirm-close-non-default-tabs"
              checked={confirmCloseNonDefaultTabs}
              onCheckedChange={(checked) => setSettings({ confirmCloseNonDefaultTabs: !!checked })}
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/60 px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="terminal-autocomplete" className="text-sm font-semibold cursor-pointer">
                {t("终端智能自动补全")}
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("开启后，终端输入时会智能提示历史命令与快捷命令组合，并支持 Tab / Enter 快速补全。")}
              </p>
            </div>
            <Checkbox
              id="terminal-autocomplete"
              checked={terminalAutocomplete}
              onCheckedChange={(checked) => setSettings({ terminalAutocomplete: !!checked })}
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-background/60 px-4 py-3">
            <div className="space-y-1">
              <Label htmlFor="quick-cmd-bar-enabled" className="text-sm font-semibold cursor-pointer">
                {t("显示快捷命令栏")}
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("开启后，终端下方会显示快捷命令栏，可以快速执行预设命令。")}
              </p>
            </div>
            <Checkbox
              id="quick-cmd-bar-enabled"
              checked={quickCmdBarEnabled}
              onCheckedChange={(checked) => setSettings({ quickCmdBarEnabled: !!checked })}
            />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <LayoutPanelLeft className="h-5 w-5 text-primary" />
          <Label className="text-lg font-bold">{t("标签页预览")}</Label>
        </div>
        <div className="p-6 border rounded-2xl bg-muted/5 flex items-center justify-center">
          <div className="flex items-center gap-1 bg-background p-2 rounded-xl border shadow-sm w-full max-w-md">
            <div className="h-8 px-4 bg-secondary text-secondary-foreground rounded-lg flex items-center text-xs font-bold">
              {shells.find(s => s.path === defaultShell)?.name || t("终端")}
            </div>
            <div className="h-8 px-4 text-muted-foreground flex items-center text-xs">
              {t("另一标签页")}
            </div>
            <div className="h-8 w-8 flex items-center justify-center border border-dashed rounded-lg ml-auto">
              <Plus className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// --- 子组件 3：数据导入导出 ---
function DataImportExport() {
  const { t } = useI18n();
  const { importProfiles, exportProfiles } = useSshProfilesStore();
  const { commands } = useQuickCommandsStore();
  const { sessions } = useTabsStore();

  const [selectedImportFile, setSelectedImportFile] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  
  const { gitRepoPath, setGitRepoPath, lastSyncTime, setLastSyncTime } = useGitSyncStore();
  const [isSyncing, setIsSyncing] = useState(false);

  // 恢复确认弹窗状态
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [pendingRestoreData, setPendingRestoreData] = useState<any>(null);

  // 清空确认弹窗状态
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  };

  // 统一的完整导出，使用 Tauri 原生弹窗
  const handleExportAll = async () => {
    try {
      const exportData = {
        version: "1.0",
        exportDate: new Date().toISOString(),
        sshProfiles: exportProfiles(),
        quickCommands: commands,
        sessions: sessions.map(s => ({
          title: s.title,
          type: s.type,
          cwd: s.cwd,
          host: s.host,
          config: s.config
        }))
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      const defaultFileName = `lazy-term-backup-${new Date().toISOString().split('T')[0]}.json`;

      // 1. 唤起系统原生的保存文件对话框
      const filePath = await save({
        title: t("保存备份文件"),
        defaultPath: defaultFileName,
        filters: [
          { name: t("JSON 配置文件"), extensions: ["json"] },
          { name: t("所有文件"), extensions: ["*"] }
        ]
      });

      // 如果用户点击了“取消”，则 filePath 为 null
      if (!filePath) {
        return;
      }

      // 2. 将数据写入用户选择的本地文件路径
      await writeTextFile(filePath, jsonString);

      setImportMessage(t("备份成功！文件已保存至：{path}", { path: filePath }));
      setMessageType('success');
    } catch (error: unknown) {
      logger.error("FE/dialog/slot-config", "Failed to export backup", {error});
      setImportMessage(t("备份失败：{error}", { error: getErrorMessage(error) }));
      setMessageType('error');
    }
  };

  const restoreFromBackup = (rawJson: string) => {
    try {
      const data = JSON.parse(rawJson);

      if (!data.version) {
        throw new Error(t("无效的导入文件格式"));
      }

      // 保存解析后的数据，弹出确认弹窗
      setPendingRestoreData(data);
      setRestoreConfirmOpen(true);
    } catch (error: unknown) {
      setImportMessage(t("恢复失败：{error}", { error: getErrorMessage(error) }));
      setMessageType('error');
    }
  };

  // 确认恢复后执行
  const handleConfirmRestore = () => {
    const data = pendingRestoreData;
    if (!data) return;

    let importedCount = 0;

    // 导入 SSH 配置 (全量替换)
    if (data.sshProfiles && Array.isArray(data.sshProfiles)) {
      importProfiles(data.sshProfiles);
      importedCount += data.sshProfiles.length;
    }

    // 导入快捷命令 (全量替换)
    if (data.quickCommands && Array.isArray(data.quickCommands)) {
      useQuickCommandsStore.setState({ commands: data.quickCommands });
      importedCount += data.quickCommands.length;
    }

    setImportMessage(t("成功恢复 {count} 条配置数据！", { count: importedCount }));
    setMessageType('success');
    setPendingRestoreData(null);
    setRestoreConfirmOpen(false);
  };

  const handleImportFromFile = async () => {
    try {
      const selected = await openDialog({
        title: t("选择备份文件"),
        multiple: false,
        filters: [
          { name: t("JSON 配置文件"), extensions: ["json"] },
          { name: t("所有文件"), extensions: ["*"] },
        ],
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setSelectedImportFile(selected);
      const rawJson = await readTextFile(selected);
      restoreFromBackup(rawJson);
    } catch (error: unknown) {
      setImportMessage(t("读取备份文件失败：{error}", { error: getErrorMessage(error) }));
      setMessageType('error');
    }
  };

  // 清空所有数据
  const handleClearAll = () => {
    setClearConfirmOpen(true);
  };

  const handleConfirmClear = () => {
    useSshProfilesStore.setState({
      nodes: [{ id: "root-folder", type: "folder", name: t("我的会话"), parentId: null, isExpanded: true, isRoot: true, order: 0 }]
    });
    useQuickCommandsStore.setState({ commands: [] });
    setSelectedImportFile(null);
    setImportMessage(t("所有配置数据已清空！"));
    setMessageType('success');
    setClearConfirmOpen(false);
  };

  const selectedFileName = selectedImportFile?.split(/[\\/]/).pop() ?? null;

  return (
    <div className="space-y-3 py-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="rounded-lg border border-border bg-muted/30 p-2 text-foreground/80">
              <Database className="h-4.5 w-4.5" />
            </div>
            <Label className="text-sm font-semibold">{t("备份数据")}</Label>
          </div>

          <Button
            onClick={handleExportAll}
            variant="outline"
            className="group h-auto w-full justify-start rounded-lg border border-border bg-background px-3 py-3 text-left shadow-none hover:bg-muted/40"
          >
            <div className="flex w-full items-center gap-3 text-left">
              <div className="rounded-md border border-border bg-muted/40 p-2 text-foreground/80">
                <FileJson className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{t("导出 JSON 备份")}</div>
              </div>
            </div>
          </Button>
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded-lg border border-border bg-muted/30 p-2 text-foreground/80">
                <Upload className="h-4.5 w-4.5" />
              </div>
              <Label className="text-sm font-semibold">{t("恢复数据")}</Label>
            </div>

            <Button onClick={handleClearAll} variant="outline" size="sm" className="h-7 rounded-md border-border px-2.5 text-[11px] text-muted-foreground hover:text-destructive">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("清空所有数据")}
            </Button>
          </div>

          <Button
            onClick={handleImportFromFile}
            variant="outline"
            className="group h-auto w-full justify-start rounded-lg border border-dashed border-border bg-background px-3 py-3 text-left shadow-none hover:bg-muted/40"
          >
            <div className="flex w-full items-center gap-3 text-left">
              <div className="rounded-md border border-border bg-muted/40 p-2 text-foreground/80">
                <Upload className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{t("选择 JSON 文件恢复")}</div>
              </div>
            </div>
          </Button>

          <div className="mt-2 rounded-lg border border-border bg-muted/15 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {selectedFileName ?? t("尚未选择文件")}
                </div>
                {selectedImportFile && <div className="truncate text-[11px] text-muted-foreground">{selectedImportFile}</div>}
              </div>
              <div className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
                JSON
              </div>
            </div>
          </div>
        </section>
      </div>

      <Separator className="bg-border/70" />

      {importMessage && (
        <div className={cn(
          "rounded-xl border px-4 py-3 text-sm break-all",
          messageType === 'success'
            ? "border-border bg-muted/20 text-foreground"
            : "border-red-500/20 bg-red-500/8 text-red-700 dark:text-red-300"
        )}>
          {importMessage}
        </div>
      )}

      {/* --- Git Sync Section --- */}
      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <div className="rounded-lg border border-border bg-muted/30 p-2 text-foreground/80">
            <GitBranch className="h-4.5 w-4.5" />
          </div>
          <Label className="text-sm font-semibold">{"Git 云端同步"}</Label>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <Button
            onClick={async () => {
              try {
                const selected = await openDialog({
                  title: "选择本地 Git 仓库文件夹",
                  directory: true,
                  multiple: false,
                });
                if (selected && typeof selected === "string") {
                  const isRepo = await checkGitRepo(selected);
                  if (!isRepo) {
                    setImportMessage("警告：该文件夹似乎不是一个有效的 Git 仓库，请先在此初始化 git。");
                    setMessageType("error");
                  } else {
                    setImportMessage("成功设置 Git 同步目录！");
                    setMessageType("success");
                  }
                  setGitRepoPath(selected);
                }
              } catch (e) {
                setImportMessage(String(e));
                setMessageType("error");
              }
            }}
            variant="outline"
            className="shrink-0"
          >
            {"设置本地仓库目录"}
          </Button>
          <div className="flex-1 min-w-0 rounded-lg border border-border bg-muted/15 px-3 py-2 text-sm text-muted-foreground truncate">
            {gitRepoPath || "尚未选择目录"}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={async () => {
              if (!gitRepoPath) return;
              setIsSyncing(true);
              setImportMessage("正在推送配置...");
              setMessageType("success");
              try {
                const exportData = {
                  version: "1.0",
                  exportDate: new Date().toISOString(),
                  sshProfiles: exportProfiles(),
                  quickCommands: commands,
                  sessions: sessions.map(s => ({
                    title: s.title,
                    type: s.type,
                    cwd: s.cwd,
                    host: s.host,
                    config: s.config
                  }))
                };
                const jsonString = JSON.stringify(exportData, null, 2);
                const targetFile = `${gitRepoPath}/lazy-term-sync.json`;
                await writeTextFile(targetFile, jsonString);
                
                await commitAndPushGitRepo(gitRepoPath, "Auto sync config " + new Date().toISOString());
                setLastSyncTime(Date.now());
                setImportMessage("同步推送成功！");
                setMessageType("success");
              } catch (e) {
                setImportMessage("推送失败：" + String(e));
                setMessageType("error");
              } finally {
                setIsSyncing(false);
              }
            }}
            disabled={!gitRepoPath || isSyncing}
            className="flex-1 gap-2"
          >
            <Send className="h-4 w-4" />
            {"推送至远端 (Push)"}
          </Button>
          <Button
            onClick={async () => {
              if (!gitRepoPath) return;
              setIsSyncing(true);
              setImportMessage("正在拉取配置...");
              setMessageType("success");
              try {
                await pullGitRepo(gitRepoPath);
                const targetFile = `${gitRepoPath}/lazy-term-sync.json`;
                const rawJson = await readTextFile(targetFile);
                restoreFromBackup(rawJson);
                setLastSyncTime(Date.now());
                setImportMessage("同步拉取并恢复成功！");
                setMessageType("success");
              } catch (e) {
                setImportMessage("拉取失败：" + String(e));
                setMessageType("error");
              } finally {
                setIsSyncing(false);
              }
            }}
            disabled={!gitRepoPath || isSyncing}
            variant="secondary"
            className="flex-1 gap-2 border"
          >
            <Download className="h-4 w-4" />
            {"拉取到本地 (Pull)"}
          </Button>
        </div>
        {lastSyncTime && (
          <div className="mt-3 text-xs text-muted-foreground">
            {"最后成功同步时间："} {new Date(lastSyncTime).toLocaleString()}
          </div>
        )}
      </div>

      {/* 恢复数据确认弹窗 */}
      <AlertDialog open={restoreConfirmOpen} onOpenChange={(open) => { if (!open) { setRestoreConfirmOpen(false); setPendingRestoreData(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("恢复数据")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("恢复将覆盖当前的 SSH 配置与快捷命令，确定要继续吗？")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setRestoreConfirmOpen(false); setPendingRestoreData(null); }}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRestore}>{t("确认恢复")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 清空数据确认弹窗 */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={(open) => { if (!open) setClearConfirmOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("清空所有数据")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("确定要清空所有会话配置和快捷命令吗？此操作不可恢复！")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClearConfirmOpen(false)}>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onClick={handleConfirmClear}>{t("确认清空")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- 子组件 4：关于与更新 ---
function AboutSettings() {
  const { t } = useI18n();
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [isChecking, setIsChecking] = useState(false);

  const [latestUpdateUrl, setLatestUpdateUrl] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useMountedEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null));
    
    // 监听进度事件
    const unlisten = listen("update-progress", (event: any) => {
      setDownloadProgress(event.payload.progress);
    });
    
    return () => {
      unlisten.then(f => f());
    };
  }, []);

  const displayedVersion = version === undefined ? t("加载中...") : (version ?? t("未知"));
  const currentVersion = version ?? "0.0.0";

  const checkUpdate = async () => {
    setIsChecking(true);
    setUpdateStatus(t("正在连接 172.50.0.243 检查更新..."));
    setLatestUpdateUrl(null);
    setDownloadProgress(null);
    try {
      // 访问 nginx 服务器主页，通过解析挂载的文件名来判断（使用 Tauri原生 fetch 以绕过 CORS）
      const res = await tauriFetch("http://172.50.0.243/", {
        method: "GET",
      });
      if (!res.ok) {
        throw new Error(t("HTTP 错误 {status}", { status: res.status }));
      }
      
      const htmlText = await res.text();
      
      // 匹配 nginx autoindex 中的 href，提取包名和版本号
      // 例如 <a href="LazyTerm_26.408.1620_x64-setup.exe">...
      const regex = /href="([^"]*LazyTerm[_-]?v?(\d+\.\d+\.\d+)[^"]*\.(?:exe|msi|zip|dmg|AppImage))"/gi;
      let match;
      let maxVersion = "0.0.0";
      let latestDownloadPath = "";

      const compareVersions = (v1: string, v2: string) => {
        const p1 = v1.split('.').map(Number);
        const p2 = v2.split('.').map(Number);
        for(let i=0; i<Math.max(p1.length, p2.length); i++) {
            const num1 = p1[i] || 0;
            const num2 = p2[i] || 0;
            if(num1 > num2) return 1;
            if(num1 < num2) return -1;
        }
        return 0;
      };

      while ((match = regex.exec(htmlText)) !== null) {
        const fullHref = match[1];
        const parsedVersion = match[2];
        if (compareVersions(parsedVersion, maxVersion) > 0) {
          maxVersion = parsedVersion;
          latestDownloadPath = fullHref;
        }
      }

      if (maxVersion === "0.0.0") {
        throw new Error(t("未能在 172.50.0.243 上找到任何有效的 LazyTerm 安装包"));
      }
      
      // 如果我们发现的最大版本比当前版本大
      if (compareVersions(maxVersion, currentVersion) > 0) {
        setUpdateStatus(t("发现新版本：{version}！", { version: maxVersion }));
        setLatestUpdateUrl(`http://172.50.0.243/${latestDownloadPath}`);
      } else {
        setUpdateStatus(t("当前已是最新版本 ({version})", { version: displayedVersion }));
      }
    } catch (err: any) {
      setUpdateStatus(t("检查更新失败：{error}", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="space-y-6 py-4 px-1">
      <div className="flex items-center gap-2">
        <Info className="h-5 w-5 text-primary" />
        <Label className="text-lg font-bold">{t("关于 LazyTerm")}</Label>
      </div>

      <div className="p-6 border rounded-2xl bg-muted/5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold">LazyTerm</div>
            <div className="text-sm text-muted-foreground mt-1">{t("当前版本：{version}", { version: displayedVersion })}</div>
          </div>
          <Button onClick={checkUpdate} disabled={isChecking || downloadProgress !== null} variant="secondary">
            {isChecking ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-2 h-4 w-4" />}
            {t("检查更新")}
          </Button>
        </div>

        {updateStatus && (
          <div className="p-4 mt-4 rounded-xl bg-primary/10 text-primary text-sm font-medium border border-primary/20 flex flex-col gap-4 shadow-sm">
            <div className="leading-relaxed">{updateStatus}</div>
            
            {latestUpdateUrl && downloadProgress === null && (
              <Button 
                onClick={() => {
                  setDownloadProgress(0);
                  invoke("download_and_install_update", { url: latestUpdateUrl })
                    .catch(err => {
                      setUpdateStatus(t("下载或安装失败：{error}", { error: String(err) }));
                      setDownloadProgress(null);
                    });
                }}
                className="w-full sm:w-auto self-start"
              >
                {t("立即更新")}
              </Button>
            )}

            {downloadProgress !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="animate-pulse">{t("正在下载更新包...")}</span>
                  <span className="font-mono">{downloadProgress.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-background/50 h-2.5 rounded-full overflow-hidden shadow-inner flex">
                  <div 
                    className="bg-primary h-full transition-all duration-300 ease-out" 
                    style={{ width: `${downloadProgress}%` }} 
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- 主组件 ---
export function SlotConfigDialog({ open, onOpenChange }: SlotConfigDialogProps) {
  const { t } = useI18n();
  const { currentConfig, resetToDefault } = useSlotConfigStore();
  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      window.dispatchEvent(new Event("lazy-term-focus"));
    }
  };

  const toggleModule = useCallback((side: "left" | "right", moduleId: string) => {
    const next = JSON.parse(JSON.stringify(useSlotConfigStore.getState().currentConfig));
    const isAlreadyInThisSide = next[side].modules.includes(moduleId);

    if (isAlreadyInThisSide) {
      next[side].modules = next[side].modules.filter((id: string) => id !== moduleId);
      if (next[side].activeModule === moduleId) {
        const validModules = next[side].modules.filter((id: string) => id !== "SettingsModule" && id !== "settings");
        next[side].activeModule = validModules[0] || "";
      }
    } else {
      const otherSide = side === "left" ? "right" : "left";
      next[otherSide].modules = next[otherSide].modules.filter((id: string) => id !== moduleId);
      if (next[otherSide].activeModule === moduleId) {
        const validModules = next[otherSide].modules.filter((id: string) => id !== "SettingsModule" && id !== "settings");
        next[otherSide].activeModule = validModules[0] || "";
      }

      // 如果目标侧原本为空，添加模块时自动展开
      if (next[side].modules.length === 0) {
        next[side].collapsed = false;
      }

      next[side].modules.push(moduleId);
      if (!next[side].activeModule) next[side].activeModule = moduleId;
    }
    useSlotConfigStore.getState().updateSlotConfig(next);
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-[1000px] w-[95vw] h-[85vh] md:h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle>{t("系统设置")}</DialogTitle>
          <DialogDescription className="hidden">{t("系统设置")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="theme" className="flex-1 flex overflow-hidden flex-col md:flex-row">
          <TabsList className="w-full md:w-48 flex flex-row md:flex-col h-auto md:h-full bg-muted/10 md:rounded-none border-b md:border-b-0 md:border-r p-3 gap-2 justify-start overflow-x-auto justify-start shrink-0">
            <TabsTrigger
              value="theme"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <Palette className="h-4 w-4" />
              <span className="font-medium">{t("主题设置")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="slots"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <LayoutPanelLeft className="h-4 w-4" />
              <span className="font-medium">{t("布局管理")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="terminal"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <Terminal className="h-4 w-4" />
              <span className="font-medium">{t("终端设置")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="data"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <Database className="h-4 w-4" />
              <span className="font-medium">{t("数据备份")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="about"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <Info className="h-4 w-4" />
              <span className="font-medium">{t("关于与更新")}</span>
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1">
            <div className="p-8">
              <TabsContent value="theme" className="m-0 focus-visible:outline-none">
                <ThemeSettings />
              </TabsContent>
              <TabsContent value="slots" className="m-0 focus-visible:outline-none">
                <SlotSettings
                  currentConfig={currentConfig}
                  onToggle={toggleModule}
                  onActiveChange={(side: "left" | "right", val: string) => {
                    const next = JSON.parse(JSON.stringify(useSlotConfigStore.getState().currentConfig));
                    next[side].activeModule = val;
                    useSlotConfigStore.getState().updateSlotConfig(next);
                  }}
                  resetToDefault={resetToDefault}
                />
              </TabsContent>
              <TabsContent value="terminal" className="m-0 focus-visible:outline-none">
                <TerminalSettings />
              </TabsContent>
              <TabsContent value="data" className="m-0 focus-visible:outline-none">
                <DataImportExport />
              </TabsContent>
              <TabsContent value="about" className="m-0 focus-visible:outline-none">
                <AboutSettings />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
