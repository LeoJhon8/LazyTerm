import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
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
import { useSlotConfigStore } from "@/store/slot-config";
import { useSettingsStore } from "@/store/settings";
import { useSshProfilesStore } from "@/store/ssh-profiles";
import { useQuickCommandsStore } from "@/store/quick-commands";
import { useTabsStore } from "@/store/tabs";
import { TERMINAL_THEMES, getTerminalTheme } from "@/config/themes";
import { FileJson, Upload, Trash2, ImagePlus, X, Palette, LayoutPanelLeft, Database, Terminal, Plus } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect as useMountedEffect } from "react";

// 引入 Tauri 原生 API
import { save, open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
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
      console.error("选择背景图片失败:", e);
    }
  };

  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const activeTheme = getTerminalTheme(terminalColorScheme, customThemeColors);
  const termBgHex = activeTheme.background;
  const termBgRgba = termBgHex === "transparent" ? "transparent" : (termBgHex.startsWith("#") ? hexToRgba(termBgHex, terminalOpacity / 100) : termBgHex);

  const isDarkApp = appBackgroundColor === 'system'
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : appBackgroundColor === 'dark';

  const filteredThemes = TERMINAL_THEMES.filter(t =>
    t.name === 'custom' || t.name === 'system-auto' || t.isDark === isDarkApp
  );

  return (
    <div className="flex flex-col h-full relative">
      {/* ======================= */}
      {/* 1. 效果预览 (固定在上方) */}
      {/* ======================= */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-md pb-6 pt-2 border-b mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-5 w-5 text-primary" />
          <Label className="text-lg font-bold">视觉预览</Label>
        </div>
        <div
          className="rounded-xl border shadow-sm overflow-hidden relative group transition-all duration-300 hover:shadow-md hover:border-primary/20"
          style={{
            height: '180px',
            backgroundColor: appBackgroundColor === 'system' ? 'var(--background)' : (appBackgroundColor === 'light' ? '#ffffff' : (appBackgroundColor === 'dark' ? '#0a0a0a' : appBackgroundColor)),
            color: 'var(--foreground)'
          }}
        >
          {/* 背景图层 */}
          {backgroundImageEnabled && backgroundImage && (
            <div className="absolute inset-0 pointer-events-none" style={{
              zIndex: 0,
              backgroundImage: `url(${backgroundImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: backgroundOpacity / 100,
              filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : undefined,
            }} />
          )}

          {/* UI 侧栏占位 */}
          <div className="absolute inset-y-0 left-0 w-16 border-r flex flex-col items-center py-3 z-10" style={{
            backgroundColor: (backgroundImageEnabled && backgroundImage) ? `color-mix(in srgb, var(--color-background) ${uiOpacity}%, transparent)` : undefined,
          }}>
            <div className="w-10 h-10 rounded-lg mb-4 flex items-center justify-center text-white shadow-sm" style={{ backgroundColor: 'var(--color-primary)' }}>
              M
            </div>
            <div className="w-8 h-8 rounded mb-2 bg-muted/50" />
            <div className="w-8 h-8 rounded bg-muted/50" />
          </div>

          {/* 终端内容区 */}
          <div className="absolute inset-y-0 left-16 right-0 p-4 z-10 truncate" style={{
            backgroundColor: termBgRgba,
            color: activeTheme.foreground === "auto" ? "var(--foreground)" : activeTheme.foreground,
            fontFamily,
            fontSize: `${fontSize}px`
          }}>
            <div className="flex gap-2 mb-1">
              <span style={{ color: activeTheme.green === "auto" ? "#22c55e" : activeTheme.green }}>➜</span>
              <span style={{ color: activeTheme.cyan === "auto" ? "#06b6d4" : activeTheme.cyan }}>~/user/lazy-terminal</span>
            </div>
            <div className="mb-2">
              <span style={{ color: activeTheme.magenta === "auto" ? "#d946ef" : activeTheme.magenta }}>❯</span> npm run dev
            </div>
            <div style={{ color: activeTheme.yellow === "auto" ? "#eab308" : activeTheme.yellow }}>Starting development server...</div>
            <div style={{ color: activeTheme.brightGreen === "auto" ? "#4ade80" : activeTheme.brightGreen, marginTop: '8px' }}>VITE v7.3.1  ready in 250 ms</div>
          </div>
        </div>
      </div>

      <div className="space-y-8 pb-10 px-1">

        {/* ======================= */}
        {/* 1.5. 应用背景色 */}
        {/* ======================= */}
        <div className="space-y-3">
          <Label className="text-base font-semibold">配色方案</Label>
          <div className="flex flex-wrap gap-2 items-center">
            {[
              { value: "system", label: "跟随系统" },
              { value: "light", label: "浅色" },
              { value: "dark", label: "深色" },
            ].map(opt => (
              <Button
                key={opt.value}
                variant={appBackgroundColor === opt.value ? "default" : "outline"}
                size="sm"
                className={appBackgroundColor === opt.value ? "ring-2 ring-primary ring-offset-1" : ""}
                onClick={() => setSettings({ appBackgroundColor: opt.value as any })}
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filteredThemes.map((scheme) => (
              <button
                key={scheme.name}
                onClick={() => setSettings({ terminalColorScheme: scheme.name })}
                className={`p-3 rounded-lg border-2 transition-all duration-200 text-left ${terminalColorScheme === scheme.name ? "border-primary shadow-md bg-active" : "border-muted hover:border-primary/50"
                  }`}
              >
                <div className="text-sm font-medium mb-2 truncate">{scheme.label}</div>
                <div className="rounded p-1.5 flex flex-wrap items-center gap-1" style={{ backgroundColor: scheme.background === 'auto' ? 'var(--background)' : scheme.background }}>
                  {[scheme.red, scheme.green, scheme.yellow, scheme.blue, scheme.foreground].map((c, i) => (
                    <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c === 'auto' ? (i === 0 ? '#ef4444' : i === 1 ? '#22c55e' : i === 2 ? '#eab308' : '#3b82f6') : c }} />
                  ))}
                </div>
              </button>
            ))}
          </div>

          {/* 自定义颜色配置区域 */}
          {terminalColorScheme === "custom" && (
            <div className="p-4 bg-muted/20 border rounded-lg space-y-4">
              <Label className="text-sm font-semibold">自定义配色详情</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
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
                ].map((item) => (
                  <div key={item.key} className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">{item.label}</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={(customThemeColors as any)[item.key] || "#000000"}
                        onChange={(e) => {
                          const newColors = { ...customThemeColors, [item.key]: e.target.value };
                          setSettings({ customThemeColors: newColors as any });
                        }}
                        className="w-6 h-6 p-0 border-0 rounded cursor-pointer"
                      />
                      <span className="text-xs font-mono">{(customThemeColors as any)[item.key]}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-8 pt-4">
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

          <div className="grid grid-cols-2 gap-8 pt-2">
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
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">字体族</Label>
              <Select value={fontFamily} onValueChange={(v) => setSettings({ fontFamily: v })}>
                <SelectTrigger className="h-9 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* @ts-ignore */}
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
function SlotSettings({ currentConfig, onToggle, onActiveChange, resetToDefault }: any) {
  const displayModules = AVAILABLE_MODULES.filter(mod =>
    !LOCKED_MODULES.includes(mod.id) &&
    mod.id !== "SettingModule" &&
    mod.id !== "settings"
  );

  return (
    <div className="space-y-6 py-4">
      <div className="grid grid-cols-2 gap-8">
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
  const { defaultShell, setSettings } = useSettingsStore();
  const [shells, setShells] = useState<any[]>([]);

  useMountedEffect(() => {
    invoke<any[]>("get_available_shells")
      .then(setShells)
      .catch(console.error);
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
                    "flex items-center justify-between p-3 rounded-xl border transition-all text-left",
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

  const [importData, setImportData] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

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
      const defaultFileName = `lazy-terminal-backup-${new Date().toISOString().split('T')[0]}.json`;

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
    } catch (error: any) {
      console.error("备份失败:", error);
      setImportMessage(`备份失败：${error.message || String(error)}`);
      setMessageType('error');
    }
  };

  // 导入数据
  const handleImport = () => {
    try {
      if (!importData.trim()) throw new Error("请先粘贴导入数据");
      const data = JSON.parse(importData);

      if (!data.version) {
        throw new Error("无效的导入文件格式");
      }

      if (!confirm("导入将覆盖当前的 SSH配置与快捷命令，确定要继续吗？")) {
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
      setImportData("");
    } catch (error: any) {
      setImportMessage(`导入失败：${error.message}`);
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
      setImportMessage("所有配置数据已清空！");
      setMessageType('success');
    }
  };

  return (
    <div className="space-y-6 py-4">
      {/* 导出区域 */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <Label className="text-lg font-bold">备份数据</Label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Button
            onClick={handleExportAll}
            variant="outline"
            className="h-auto py-6 flex flex-col items-center gap-3 rounded-2xl border-dashed border-2 hover:border-primary/50 hover:bg-primary/5 transition-all group"
          >
            <div className="p-3 rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
              <FileJson className="h-6 w-6 text-primary" />
            </div>
            <div className="text-center">
              <div className="font-bold">完整备份配置</div>
              <div className="text-xs text-muted-foreground mt-1">导出所有会话、快捷命令及设置</div>
            </div>
          </Button>
        </div>
      </div>

      <Separator className="my-8" />

      {/* 导入区域 */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <Label className="text-lg font-bold">导入恢复</Label>
          </div>
          <Button onClick={handleClearAll} variant="destructive" size="sm" className="rounded-full px-4 h-8 text-xs font-semibold">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />
            清空所有数据
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor="import-data" className="text-sm text-muted-foreground">
            粘贴 JSON 格式的备份数据
          </Label>
          <Textarea
            id="import-data"
            value={importData}
            onChange={(e) => setImportData(e.target.value)}
            placeholder='{"version":"1.0","sshProfiles":[],"quickCommands":[]}'
            rows={8}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleImport} className="flex-1">
            <Upload className="h-4 w-4 mr-2" />
            立即导入并覆盖
          </Button>
        </div>

        {importMessage && (
          <div className={`p-3 rounded-md text-sm break-all ${messageType === 'success'
            ? 'bg-green-100 text-green-800 border border-green-200'
            : 'bg-red-100 text-red-800 border border-red-200'
            }`}>
            {importMessage}
          </div>
        )}
      </div>
    </div>
  );
}

// --- 主组件 ---
export function SlotConfigDialog({ open, onOpenChange }: SlotConfigDialogProps) {
  const { currentConfig, resetToDefault } = useSlotConfigStore();

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle>系统设置</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="theme" className="flex-1 flex overflow-hidden">
          <TabsList className="w-48 flex flex-col h-full bg-muted/10 rounded-none border-r p-3 gap-2 justify-start">
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

          <ScrollArea className="flex-1 p-8">
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
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}