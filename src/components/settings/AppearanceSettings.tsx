import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useSettingsStore } from "@/store/settings";
import {
  DEFAULT_DARK_THEME,
  TERMINAL_THEME_ECOSYSTEMS,
  getTerminalTheme,
  normalizeTerminalThemeName,
} from "@/config/themes";
import type { TerminalColorScheme } from "@/config/themes";
import { FONT_OPTIONS, APP_BACKGROUND_OPTIONS, EDITABLE_THEME_COLOR_ITEMS } from "./constants";
import { getTerminalThemeDisplayName, useI18n } from "@/i18n";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ImagePlus, X, Plus, Trash2 } from "lucide-react";

/** 生成唯一自定义方案 ID */
function generateCustomThemeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 外观设置：配色方案 + 字体 + 终端主题 + 背景图片 + 透明度 */
export function AppearanceSettings() {
  const { locale, t } = useI18n();
  const appBackgroundColor = useSettingsStore((s) => s.appBackgroundColor);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const terminalColorScheme = useSettingsStore((s) => s.terminalColorScheme);
  const customThemes = useSettingsStore((s) => s.customThemes);
  const terminalOpacity = useSettingsStore((s) => s.terminalOpacity);
  const backgroundImageEnabled = useSettingsStore((s) => s.backgroundImageEnabled);
  const backgroundImage = useSettingsStore((s) => s.backgroundImage);
  const backgroundImagePath = useSettingsStore((s) => s.backgroundImagePath);
  const backgroundImageUiMode = useSettingsStore((s) => s.backgroundImageUiMode);
  const backgroundBlur = useSettingsStore((s) => s.backgroundBlur);
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity);
  const uiOpacity = useSettingsStore((s) => s.uiOpacity);
  const setSettings = useSettingsStore((s) => s.setSettings);

  const [editingName, setEditingName] = useState("");

  const isDarkApp = appBackgroundColor === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : appBackgroundColor === "dark";

  // 合并预设 + 自定义方案，按配色模式排序
  const activeCustomTheme = customThemes.find((c) => c.name === terminalColorScheme);
  const isCustomSelected = !!activeCustomTheme;
  const selectedTerminalColorScheme = activeCustomTheme
    ? terminalColorScheme
    : normalizeTerminalThemeName(terminalColorScheme);
  const ecosystemThemeOptions: TerminalColorScheme[] = TERMINAL_THEME_ECOSYSTEMS.map((theme) => ({
    ...getTerminalTheme(theme.name, customThemes, appBackgroundColor),
    name: theme.name,
    label: theme.label,
    isDark: isDarkApp,
  }));
  const allThemes: TerminalColorScheme[] = [...ecosystemThemeOptions, ...customThemes];

  const handleAddCustomTheme = () => {
    const id = generateCustomThemeId();
    const newTheme: TerminalColorScheme = {
      ...DEFAULT_DARK_THEME,
      name: id,
      label: t("自定义方案"),
      isDark: true,
    };
    setSettings({
      customThemes: [...customThemes, newTheme],
      terminalColorScheme: id,
    });
    setEditingName("");
  };

  const handleDeleteCustomTheme = (themeName: string) => {
    const remaining = customThemes.filter((c) => c.name !== themeName);
    const updates: Record<string, unknown> = { customThemes: remaining };
    if (terminalColorScheme === themeName) {
      updates.terminalColorScheme = "system-auto";
    }
    setSettings(updates);
  };

  const handleUpdateCustomColor = (themeName: string, key: string, value: string) => {
    const updated = customThemes.map((c) =>
      c.name === themeName ? { ...c, [key]: value } : c
    );
    setSettings({ customThemes: updated });
  };

  const handleUpdateCustomLabel = (themeName: string, label: string) => {
    const updated = customThemes.map((c) =>
      c.name === themeName ? { ...c, label } : c
    );
    setSettings({ customThemes: updated });
  };

  const resolveColor = (color: string, fallback: string) => color === "auto" ? fallback : color;

  const renderThemePreview = (scheme: TerminalColorScheme) => {
    const bg = resolveColor(scheme.background, "var(--background)");
    const fg = resolveColor(scheme.foreground, "var(--foreground)");
    const colors = [scheme.red, scheme.green, scheme.yellow, scheme.blue, scheme.magenta, scheme.cyan];

    return (
      <div className="flex items-center gap-2">
        <div
          className="w-5 h-5 rounded border shrink-0"
          style={{ backgroundColor: bg, borderColor: resolveColor(scheme.brightBlack, "var(--border)") }}
        >
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-[8px] leading-none font-bold" style={{ color: fg }}>Aa</span>
          </div>
        </div>
        <div className="flex gap-0.5">
          {colors.map((c, i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: c === "auto" ? ["#ef4444", "#22c55e", "#eab308", "#3b82f6", "#d946ef", "#06b6d4"][i] : c }}
            />
          ))}
        </div>
      </div>
    );
  };

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
        const path = selected as string;
        const assetUrl = convertFileSrc(path);
        logger.info("FE/settings/appearance", "选择背景图片", { path, assetUrl });
        setSettings({ backgroundImage: assetUrl, backgroundImagePath: path, backgroundImageEnabled: true });
      }
    } catch (e) {
      logger.error("FE/settings/appearance", "Failed to select background image", { e });
    }
  };

  // 当前终端主题的显示名（用于 tooltip）
  const currentThemeLabel = (() => {
    const theme = allThemes.find((th) => th.name === selectedTerminalColorScheme);
    return theme ? getTerminalThemeDisplayName(theme.name, theme.label, locale) : selectedTerminalColorScheme;
  })();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-full relative">
        <div className="flex flex-col gap-6 pb-10 px-1">

          {/* 整体配色方案 */}
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("整体配色方案")}</Label>
            <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden px-3 py-3">
              <div className="flex flex-wrap gap-2">
                {APP_BACKGROUND_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-sm transition-all duration-200",
                      appBackgroundColor === opt.value
                        ? "bg-primary text-primary-foreground shadow-sm font-medium"
                        : "bg-background/80 text-muted-foreground hover:text-foreground hover:bg-background"
                    )}
                    onClick={() => setSettings({ appBackgroundColor: opt.value as "system" | "light" | "dark" })}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 字体设置 */}
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("字体设置")}</Label>
            <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label className="text-sm">{t("字体族")}</Label>
                <Select value={fontFamily} onValueChange={(v) => setSettings({ fontFamily: v })}>
                  <SelectTrigger className="h-8 w-48 bg-background/80 border-0 shadow-none focus:ring-1 focus:ring-primary/30 text-sm">
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
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label className="text-sm">{t("字体大小")}</Label>
                <div className="flex items-center gap-3">
                  <Slider
                    min={10} max={24} step={1}
                    value={[fontSize]}
                    onValueChange={([v]) => setSettings({ fontSize: v })}
                    className="w-24"
                  />
                  <span className="text-xs font-mono text-muted-foreground w-10 text-right">{fontSize}px</span>
                </div>
              </div>
            </div>
          </div>

          {/* 终端主题 */}
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("终端主题")}</Label>
            <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label className="text-sm">{t("配色方案")}</Label>
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Select value={selectedTerminalColorScheme} onValueChange={(value) => setSettings({ terminalColorScheme: value })}>
                          <SelectTrigger className="h-8 w-auto min-w-[160px] max-w-[280px] bg-background/80 border-0 shadow-none focus:ring-1 focus:ring-primary/30 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {allThemes.map((scheme) => {
                              const displayName = getTerminalThemeDisplayName(scheme.name, scheme.label, locale);
                              return (
                                <SelectItem key={scheme.name} value={scheme.name} className="py-2">
                                  <div className="flex items-center gap-2.5">
                                    {renderThemePreview(scheme)}
                                    <span>{displayName}</span>
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>{currentThemeLabel}</p>
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={handleAddCustomTheme}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* 自定义方案编辑区 */}
              {isCustomSelected && activeCustomTheme && (
                <div className="border-t border-border/30 px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Label className="text-xs font-medium text-muted-foreground shrink-0">{t("方案名称")}</Label>
                      <input
                        type="text"
                        value={editingName !== "" ? editingName : activeCustomTheme.label}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => {
                          if (editingName.trim()) {
                            handleUpdateCustomLabel(activeCustomTheme.name, editingName.trim());
                          }
                          setEditingName("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="h-7 px-2 text-sm bg-background/80 border rounded-md focus:ring-1 focus:ring-primary/50 outline-none flex-1 min-w-0 max-w-48"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0 ml-2"
                      onClick={() => handleDeleteCustomTheme(activeCustomTheme.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {EDITABLE_THEME_COLOR_ITEMS.map((item) => (
                      <div key={item.key} className="flex items-center gap-1.5">
                        <input
                          type="color"
                          value={activeCustomTheme[item.key] || "#000000"}
                          onChange={(e) => handleUpdateCustomColor(activeCustomTheme.name, item.key, e.target.value)}
                          className="w-5 h-5 p-0 border-0 rounded cursor-pointer shrink-0"
                        />
                        <span className="text-xs text-muted-foreground truncate">{t(item.labelKey)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-border/30 divide-y divide-border/30">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <Label className="text-sm">{t("终端背景不透明度")}</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      min={0} max={100} step={5}
                      value={[terminalOpacity]}
                      onValueChange={([v]) => setSettings({ terminalOpacity: v })}
                      className="w-24"
                    />
                    <span className="text-xs font-mono text-muted-foreground w-10 text-right">{terminalOpacity}%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <Label className="text-sm">{t("UI 侧栏不透明度")}</Label>
                  <div className="flex items-center gap-3">
                    <Slider
                      min={30} max={100} step={5}
                      value={[uiOpacity]}
                      onValueChange={([v]) => setSettings({ uiOpacity: v })}
                      className="w-24"
                    />
                    <span className="text-xs font-mono text-muted-foreground w-10 text-right">{uiOpacity}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 背景图片 */}
          <div className="flex flex-col gap-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("背景图片")}</Label>
            <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label htmlFor="enable-bg-img" className="text-sm cursor-pointer">{t("开启图片背景")}</Label>
                <Switch
                  id="enable-bg-img"
                  checked={backgroundImageEnabled}
                  onCheckedChange={(checked) => setSettings({ backgroundImageEnabled: !!checked })}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label className="text-sm">{t("背景图片")}</Label>
                <div className="flex items-center gap-2">
                  {backgroundImageEnabled && backgroundImage && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => setSettings({ backgroundImage: "", backgroundImagePath: "" })}>
                      <X className="h-3.5 w-3.5 mr-1" />{t("清除")}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 px-2" onClick={handlePickBackgroundImage} disabled={!backgroundImageEnabled}>
                    <ImagePlus className="h-3.5 w-3.5 mr-1" />{backgroundImageEnabled && backgroundImage ? t("更换") : t("选择")}
                  </Button>
                </div>
              </div>
              {backgroundImageEnabled && backgroundImage && (
                <div className="px-4 py-2">
                  <div className="w-full h-20 rounded-lg overflow-hidden border border-border/30">
                    <img
                      src={backgroundImage}
                      alt={t("背景图片")}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        logger.warn("FE/settings/appearance", "背景图片加载失败", { src: backgroundImage });
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 truncate" title={backgroundImagePath}>
                    {backgroundImagePath}
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label className="text-sm">{t("界面呈现模式")}</Label>
                <Select
                  value={backgroundImageUiMode}
                  onValueChange={(value) => setSettings({ backgroundImageUiMode: value as "frosted" | "clear" })}
                  disabled={!backgroundImageEnabled}
                >
                  <SelectTrigger className="h-8 w-36 bg-background/80 border-0 shadow-none focus:ring-1 focus:ring-primary/30 text-sm" aria-label={t("选择图片背景模式")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="frosted">{t("保留面板毛玻璃")}</SelectItem>
                    <SelectItem value="clear">{t("完全清晰")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label className="text-sm">{t("模糊度")}</Label>
                <div className="flex items-center gap-3">
                  <Slider
                    min={0} max={20} step={1}
                    value={[backgroundBlur]}
                    onValueChange={([v]) => setSettings({ backgroundBlur: v })}
                    className="w-24"
                    disabled={!backgroundImageEnabled}
                  />
                  <span className="text-xs font-mono text-muted-foreground w-10 text-right">{backgroundBlur}px</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label className="text-sm">{t("不透明度")}</Label>
                <div className="flex items-center gap-3">
                  <Slider
                    min={0} max={100} step={5}
                    value={[backgroundOpacity]}
                    onValueChange={([v]) => setSettings({ backgroundOpacity: v })}
                    className="w-24"
                    disabled={!backgroundImageEnabled}
                  />
                  <span className="text-xs font-mono text-muted-foreground w-10 text-right">{backgroundOpacity}%</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </TooltipProvider>
  );
}
