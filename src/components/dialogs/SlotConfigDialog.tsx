import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea";
import { AVAILABLE_MODULES, LOCKED_MODULES } from "@/config/default-slot-config";
import type { SlotConfig } from "@/config/default-slot-config";
import { useSlotConfigStore } from "@/store/slot-config";
import { useSettingsStore } from "@/store/settings";
import { useSshProfilesStore } from "@/store/ssh-profiles";
import { useQuickCommandsStore } from "@/store/quick-commands";
import { useTabsStore } from "@/store/tabs";
import type { TerminalColorScheme } from "@/config/themes";
import { TERMINAL_THEMES } from "@/config/themes";
import { FileJson, Upload, Trash2, ImagePlus, X, Palette, LayoutPanelLeft, Database, Terminal, Plus } from "lucide-react";
import { useEffect as useMountedEffect } from "react";

// 引入 Tauri 原生 API
import { save, open as openDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';

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

const EDITABLE_THEME_COLOR_ITEMS: Array<{ key: EditableThemeColorKey; label: string }> = [
  { key: "background", label: "背景色" },
  { key: "foreground", label: "前景色" },
  { key: "cursor", label: "光标颜色" },
  { key: "selectionBackground", label: "选区背景" },
  { key: "black", label: "Black" },
  { key: "red", label: "Red" },
  { key: "green", label: "Green" },
  { key: "yellow", label: "Yellow" },
  { key: "blue", label: "Blue" },
  { key: "magenta", label: "Magenta" },
  { key: "cyan", label: "Cyan" },
  { key: "white", label: "White" },
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
  const appBackgroundColor = useSettingsStore((state) => state.appBackgroundColor);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const fontFamily = useSettingsStore((state) => state.fontFamily);
  const terminalColorScheme = useSettingsStore((state) => state.terminalColorScheme);
  const customThemeColors = useSettingsStore((state) => state.customThemeColors);
  const terminalOpacity = useSettingsStore((state) => state.terminalOpacity);
  const backgroundImageEnabled = useSettingsStore((state) => state.backgroundImageEnabled);
  const backgroundImage = useSettingsStore((state) => state.backgroundImage);
  const backgroundImageUiMode = useSettingsStore((state) => state.backgroundImageUiMode);
  const backgroundBlur = useSettingsStore((state) => state.backgroundBlur);
  const backgroundOpacity = useSettingsStore((state) => state.backgroundOpacity);
  const uiOpacity = useSettingsStore((state) => state.uiOpacity);
  const customCSS = useSettingsStore((state) => state.customCSS);
  const setSettings = useSettingsStore((state) => state.setSettings);
  const handlePickBackgroundImage = async () => {
    try {
      const selected = await openDialog({
        title: "选择背景图片",
        multiple: false,
        filters: [
          { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg"] },
        ],
      });
      if (selected) {
        const assetUrl = convertFileSrc(selected as string);
        setSettings({ backgroundImage: assetUrl });
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
        {/* 1.5. 应用背景色 */}
        {/* ======================= */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">配色方案</Label>
          <div className="flex flex-wrap gap-2 items-center">
            {APP_BACKGROUND_OPTIONS.map(opt => (
              <Button
                key={opt.value}
                variant={appBackgroundColor === opt.value ? "default" : "outline"}
                size="sm"
                className={appBackgroundColor === opt.value ? "ring-2 ring-primary ring-offset-1" : ""}
                onClick={() => setSettings({ appBackgroundColor: opt.value })}
              >{opt.label}</Button>
            ))}
          </div>
        </div>

        <Separator className="bg-muted" />

        {/* ======================= */}
        {/* 1.6. 终端主题 (联动配色方案) */}
        {/* ======================= */}
        <div className="space-y-5">
          <div className="flex justify-between items-center">
            <Label className="text-base font-semibold">终端主题</Label>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              已根据{isDarkApp ? '深色' : '浅色'}模式自动过滤
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {filteredThemes.map((scheme) => (
              <button
                key={scheme.name}
                onClick={() => setSettings({ terminalColorScheme: scheme.name })}
                className={`p-3 rounded-lg border-2 transition-all duration-200 text-left min-w-0 overflow-hidden ${terminalColorScheme === scheme.name ? "border-primary shadow-md bg-active" : "border-muted hover:border-primary/50"
                  }`}
                style={{
                  backgroundColor: resolvePreviewColor(scheme.background, 'var(--background)'),
                  color: resolvePreviewColor(scheme.foreground, 'var(--foreground)'),
                }}
              >
                <div className="text-sm font-medium mb-1 truncate">{scheme.label}</div>
                <div className="text-[11px] opacity-80 mb-2 truncate">Aa 文本预览</div>
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
              <Label className="text-sm font-semibold">自定义配色详情</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {EDITABLE_THEME_COLOR_ITEMS.map((item) => (
                  <div key={item.key} className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">{item.label}</Label>
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
                <Label className="text-sm text-muted-foreground">终端背景不透明度</Label>
                <span className="text-xs font-mono text-muted-foreground">{terminalOpacity}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" value={terminalOpacity} onChange={(e) => setSettings({ terminalOpacity: parseInt(e.target.value) })} className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">UI 侧栏不透明度</Label>
                <span className="text-xs font-mono text-muted-foreground">{uiOpacity}%</span>
              </div>
              <input type="range" min="30" max="100" step="5" value={uiOpacity} onChange={(e) => setSettings({ uiOpacity: parseInt(e.target.value) })} className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary" />
            </div>
          </div>
        </div>

        <Separator className="bg-muted" />

        {/* ======================= */}
        {/* 2. 背景图片 */}
        {/* ======================= */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">背景图片</Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="enable-bg-img"
                checked={backgroundImageEnabled}
                onCheckedChange={(c) => setSettings({ backgroundImageEnabled: !!c })}
              />
              <Label htmlFor="enable-bg-img" className="text-sm font-medium cursor-pointer">开启图片背景</Label>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handlePickBackgroundImage} disabled={!backgroundImageEnabled}>
              <ImagePlus className="h-4 w-4 mr-2" />选择图片
            </Button>
            {backgroundImageEnabled && backgroundImage && (
              <Button variant="ghost" size="sm" onClick={() => setSettings({ backgroundImage: "" })}>
                <X className="h-4 w-4 mr-1" />清除
              </Button>
            )}
            <span className="text-xs text-muted-foreground truncate flex-1">
              {!backgroundImageEnabled ? "图片背景未开启" : (backgroundImage ? backgroundImage : "未选择图片")}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 pt-2">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-sm text-muted-foreground">界面呈现 / UI Mode</Label>
              <Select
                value={backgroundImageUiMode}
                onValueChange={(value) => setSettings({ backgroundImageUiMode: value as "frosted" | "clear" })}
                disabled={!backgroundImageEnabled}
              >
                <SelectTrigger className="h-9 bg-background" aria-label="选择图片背景模式">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="frosted">保留面板毛玻璃</SelectItem>
                  <SelectItem value="clear">完全清晰</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                保留面板毛玻璃会继续使用侧栏和终端的毛玻璃层；完全清晰会关闭这些额外模糊。
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">模糊度 / Blur</Label>
                <span className="text-xs font-mono text-muted-foreground">{backgroundBlur}px</span>
              </div>
              <input type="range" min="0" max="20" step="1" value={backgroundBlur} disabled={!backgroundImageEnabled} onChange={(e) => setSettings({ backgroundBlur: parseInt(e.target.value) })} className={`w-full h-2 bg-secondary rounded-lg appearance-none accent-primary ${!backgroundImageEnabled ? 'opacity-50' : 'cursor-pointer'}`} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">不透明度 / Opacity</Label>
                <span className="text-xs font-mono text-muted-foreground">{backgroundOpacity}%</span>
              </div>
              <input type="range" min="0" max="100" step="5" value={backgroundOpacity} disabled={!backgroundImageEnabled} onChange={(e) => setSettings({ backgroundOpacity: parseInt(e.target.value) })} className={`w-full h-2 bg-secondary rounded-lg appearance-none accent-primary ${!backgroundImageEnabled ? 'opacity-50' : 'cursor-pointer'}`} />
            </div>
          </div>
        </div>

        <Separator className="bg-muted" />

        {/* ======================= */}
        {/* 3. 字体设置 */}
        {/* ======================= */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">字体设置</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">字体族</Label>
              <Select value={fontFamily} onValueChange={(v) => setSettings({ fontFamily: v })}>
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      <span style={{ fontFamily: f.value }}>{f.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-sm text-muted-foreground">字体大小</Label>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono">{fontSize}px</span>
              </div>
              <input type="range" min="10" max="24" step="1" value={fontSize} onChange={(e) => setSettings({ fontSize: parseInt(e.target.value) })} className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary" />
            </div>
          </div>
        </div>

        <Separator className="bg-muted" />

        {/* ======================= */}
        {/* 5. 自定义 CSS */}
        {/* ======================= */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">自定义 CSS</Label>
          <Textarea
            value={customCSS}
            onChange={(e) => setSettings({ customCSS: e.target.value })}
            placeholder={`/* 在此输入自定义 CSS */\n.xterm-viewport {\n  border-radius: 8px;\n}`}
            rows={5}
            className="font-mono text-sm"
          />
        </div>

      </div>
    </div>
  );
}

// --- 子组件 2：布局设置 ---
function SlotSettings({ currentConfig, onToggle, onActiveChange, resetToDefault }: SlotSettingsProps) {
  const displayModules = AVAILABLE_MODULES.filter(mod =>
    !LOCKED_MODULES.includes(mod.id) &&
    mod.id !== "SettingModule" &&
    mod.id !== "settings"
  );

  return (
    <div className="space-y-6 py-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {(["left", "right"] as const).map((side) => (
          <div key={side} className="space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <Label className="text-sm font-bold uppercase">
                {side === "left" ? "← 左侧栏模块" : "右侧栏模块 →"}
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
                    <span className="text-sm font-medium">{mod.name}</span>
                  </div>
                );
              })}
            </div>

            {currentConfig[side].modules.length > 0 && (
              <div className="space-y-2 pt-2">
                <Label className="text-[11px] text-muted-foreground ml-1">默认展示模块</Label>
                <Select
                  value={currentConfig[side].activeModule}
                  onValueChange={(v) => onActiveChange(side, v)}
                >
                  <SelectTrigger className="h-9 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currentConfig[side].modules.map((id: string) => (
                      <SelectItem key={id} value={id}>
                        {AVAILABLE_MODULES.find((m) => m.id === id)?.name}
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
          <Label className="text-base font-bold">恢复默认布局</Label>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">如果您对当前的布局不满意，可以一键将左右侧栏的所有面板及状态恢复至初始默认设置。</p>
        </div>
        <Button variant="outline" size="default" className="shrink-0 font-medium px-6" onClick={() => resetToDefault()}>
          恢复默认
        </Button>
      </div>
    </div>
  );
}

// --- 子组件 4：终端设置 ---
function TerminalSettings() {
  const { defaultShell, confirmCloseNonDefaultTabs, setSettings } = useSettingsStore();
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
          <Label className="text-lg font-bold">终端行为</Label>
        </div>

        <div className="space-y-4 p-6 border rounded-2xl bg-muted/5">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">默认新建终端类型 / Default Shell</Label>
            <p className="text-xs text-muted-foreground mb-3">点击标签栏 "+" 号时默认创建的终端类型</p>
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
                关闭非默认连接标签页前二次确认
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                开启后，关闭 SSH、自定义 Shell、管理员终端等非默认连接时会先弹出确认框；通过 "+" 创建的默认终端不受影响。
              </p>
            </div>
            <Checkbox
              id="confirm-close-non-default-tabs"
              checked={confirmCloseNonDefaultTabs}
              onCheckedChange={(checked) => setSettings({ confirmCloseNonDefaultTabs: !!checked })}
            />
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <LayoutPanelLeft className="h-5 w-5 text-primary" />
          <Label className="text-lg font-bold">标签页预览</Label>
        </div>
        <div className="p-6 border rounded-2xl bg-muted/5 flex items-center justify-center">
          <div className="flex items-center gap-1 bg-background p-2 rounded-xl border shadow-sm w-full max-w-md">
            <div className="h-8 px-4 bg-secondary text-secondary-foreground rounded-lg flex items-center text-xs font-bold">
              {shells.find(s => s.path === defaultShell)?.name || '终端'}
            </div>
            <div className="h-8 px-4 text-muted-foreground flex items-center text-xs">
              另一标签页
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
  const { importProfiles, exportProfiles } = useSshProfilesStore();
  const { commands } = useQuickCommandsStore();
  const { sessions } = useTabsStore();

  const [selectedImportFile, setSelectedImportFile] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

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
        title: "保存备份文件",
        defaultPath: defaultFileName,
        filters: [
          { name: "JSON 配置文件", extensions: ["json"] },
          { name: "所有文件", extensions: ["*"] }
        ]
      });

      // 如果用户点击了“取消”，则 filePath 为 null
      if (!filePath) {
        return;
      }

      // 2. 将数据写入用户选择的本地文件路径
      await writeTextFile(filePath, jsonString);

      setImportMessage(`备份成功！文件已保存至：${filePath}`);
      setMessageType('success');
    } catch (error: unknown) {
      logger.error("FE/dialog/slot-config", "Failed to export backup", {error});
      setImportMessage(`备份失败：${getErrorMessage(error)}`);
      setMessageType('error');
    }
  };

  const restoreFromBackup = (rawJson: string) => {
    try {
      const data = JSON.parse(rawJson);

      if (!data.version) {
        throw new Error("无效的导入文件格式");
      }

      if (!confirm("恢复将覆盖当前的 SSH 配置与快捷命令，确定要继续吗？")) {
        return;
      }

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

      setImportMessage(`成功恢复 ${importedCount} 条配置数据！`);
      setMessageType('success');
    } catch (error: unknown) {
      setImportMessage(`恢复失败：${getErrorMessage(error)}`);
      setMessageType('error');
    }
  };

  const handleImportFromFile = async () => {
    try {
      const selected = await openDialog({
        title: "选择备份文件",
        multiple: false,
        filters: [
          { name: "JSON 配置文件", extensions: ["json"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setSelectedImportFile(selected);
      const rawJson = await readTextFile(selected);
      restoreFromBackup(rawJson);
    } catch (error: unknown) {
      setImportMessage(`读取备份文件失败：${getErrorMessage(error)}`);
      setMessageType('error');
    }
  };

  // 清空所有数据
  const handleClearAll = () => {
    if (confirm("确定要清空所有会话配置和快捷命令吗？此操作不可恢复！")) {
      useSshProfilesStore.setState({
        nodes: [{ id: "root-folder", type: "folder", name: "我的会话", parentId: null, isExpanded: true, isRoot: true, order: 0 }]
      });
      useQuickCommandsStore.setState({ commands: [] });
      setSelectedImportFile(null);
      setImportMessage("所有配置数据已清空！");
      setMessageType('success');
    }
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
            <Label className="text-sm font-semibold">备份数据</Label>
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
                <div className="text-sm font-medium text-foreground">导出 JSON 备份</div>
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
              <Label className="text-sm font-semibold">恢复数据</Label>
            </div>

            <Button onClick={handleClearAll} variant="outline" size="sm" className="h-7 rounded-md border-border px-2.5 text-[11px] text-muted-foreground hover:text-destructive">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              清空所有数据
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
                <div className="text-sm font-medium text-foreground">选择 JSON 文件恢复</div>
              </div>
            </div>
          </Button>

          <div className="mt-2 rounded-lg border border-border bg-muted/15 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {selectedFileName ?? "尚未选择文件"}
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
    </div>
  );
}

// --- 主组件 ---
export function SlotConfigDialog({ open, onOpenChange }: SlotConfigDialogProps) {
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
        next[side].activeModule = next[side].modules[0] || "";
      }
    } else {
      const otherSide = side === "left" ? "right" : "left";
      next[otherSide].modules = next[otherSide].modules.filter((id: string) => id !== moduleId);
      if (next[otherSide].activeModule === moduleId) {
        next[otherSide].activeModule = next[otherSide].modules[0] || "";
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
      <DialogContent className="max-w-[1000px] w-[95vw] h-[85vh] md:h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle>系统设置</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="theme" className="flex-1 flex overflow-hidden flex-col md:flex-row">
          <TabsList className="w-full md:w-48 flex flex-row md:flex-col h-auto md:h-full bg-muted/10 md:rounded-none border-b md:border-b-0 md:border-r p-3 gap-2 justify-start overflow-x-auto justify-start shrink-0">
            <TabsTrigger
              value="theme"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <Palette className="h-4 w-4" />
              <span className="font-medium">主题设置</span>
            </TabsTrigger>
            <TabsTrigger
              value="slots"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <LayoutPanelLeft className="h-4 w-4" />
              <span className="font-medium">布局管理</span>
            </TabsTrigger>
            <TabsTrigger
              value="terminal"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <Terminal className="h-4 w-4" />
              <span className="font-medium">终端设置</span>
            </TabsTrigger>
            <TabsTrigger
              value="data"
              className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
            >
              <Database className="h-4 w-4" />
              <span className="font-medium">数据备份</span>
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
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
