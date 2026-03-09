import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { TERMINAL_THEMES } from "@/config/themes";
import { FileJson, Upload, Trash2, ImagePlus, X } from "lucide-react";

// 引入 Tauri 原生 API
import { save, open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { convertFileSrc } from '@tauri-apps/api/core';

// --- 类型定义 ---
interface SlotConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ThemeType = "light" | "dark" | "system";

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
  const {
    theme, fontSize, fontFamily,
    terminalColorScheme, terminalOpacity,
    backgroundImage, backgroundBlur, backgroundOpacity,
    uiOpacity, accentColor, customCSS,
    setSettings
  } = useSettingsStore();

  const setTheme = (newTheme: ThemeType) => {
    setSettings({ theme: newTheme });
  };

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
        // convertFileSrc 将本地路径转为 Tauri asset 协议 URL
        const assetUrl = convertFileSrc(selected as string);
        setSettings({ backgroundImage: assetUrl });
      }
    } catch (e) {
      console.error("选择背景图片失败:", e);
    }
  };

  return (
    <div className="space-y-6 py-4">
      {/* ======== 外观主题 ======== */}
      <div className="grid gap-4">
        <Label className="text-base font-semibold">外观主题</Label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: "light", label: "浅色模式", icon: "☀️" },
            { value: "dark", label: "深色模式", icon: "🌙" },
            { value: "system", label: "系统跟随", icon: "💻" },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value as ThemeType)}
              className={`p-4 rounded-lg border-2 transition-all duration-200 ${
                theme === option.value
                  ? "border-primary bg-primary/5 shadow-md"
                  : "border-muted hover:border-primary/50 hover:bg-muted/50"
              }`}
            >
              <div className="flex flex-col items-center space-y-2">
                <span className="text-2xl">{option.icon}</span>
                <span className="text-sm font-medium">{option.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Separator className="bg-muted" />

      {/* ======== 强调色 ======== */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label className="text-base font-semibold">强调色</Label>
          {accentColor && (
            <Button variant="ghost" size="sm" onClick={() => setSettings({ accentColor: "" })}>
              重置
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-2 flex-wrap">
            {["#528bff", "#f97316", "#22c55e", "#a855f7", "#ec4899", "#06b6d4", "#eab308", "#ef4444"].map((color) => (
              <button
                key={color}
                onClick={() => setSettings({ accentColor: color })}
                className={`w-8 h-8 rounded-full border-2 transition-all ${
                  accentColor === color ? "border-foreground scale-110 shadow-lg" : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <input
            type="color"
            value={accentColor || "#528bff"}
            onChange={(e) => setSettings({ accentColor: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer border border-muted"
            title="自定义颜色"
          />
        </div>
      </div>

      <Separator className="bg-muted" />

      {/* ======== 字体设置 ======== */}
      <div className="space-y-4">
        <Label className="text-base font-semibold">字体设置</Label>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">字体族</Label>
            <Select
              value={fontFamily}
              onValueChange={(v) => setSettings({ fontFamily: v })}
            >
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
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono">
                {fontSize}px
              </span>
            </div>
            <input
              type="range" min="10" max="24" step="1" value={fontSize}
              onChange={(e) => setSettings({ fontSize: parseInt(e.target.value) })}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>

        {/* 字体预览 */}
        <div
          className="p-3 rounded-lg border bg-muted/30 text-sm"
          style={{ fontFamily, fontSize: `${fontSize}px` }}
        >
          <span className="text-muted-foreground">预览：</span>
          <span>Hello World! 你好世界 0Oo1Il =-+/*</span>
        </div>
      </div>

      <Separator className="bg-muted" />

      {/* ======== 终端配色方案 ======== */}
      <div className="space-y-3">
        <Label className="text-base font-semibold">终端配色方案</Label>
        <div className="grid grid-cols-3 gap-2">
          {TERMINAL_THEMES.map((scheme) => (
            <button
              key={scheme.name}
              onClick={() => setSettings({ terminalColorScheme: scheme.name })}
              className={`p-3 rounded-lg border-2 transition-all duration-200 text-left ${
                terminalColorScheme === scheme.name
                  ? "border-primary shadow-md"
                  : "border-muted hover:border-primary/50"
              }`}
            >
              <div className="text-xs font-medium mb-2 truncate">{scheme.label}</div>
              {/* 色块预览 */}
              <div
                className="rounded p-1.5 flex items-center gap-0.5"
                style={{ backgroundColor: scheme.background }}
              >
                <span style={{ color: scheme.foreground, fontSize: "10px", fontFamily: "monospace" }}>
                  $&nbsp;
                </span>
                {[scheme.red, scheme.green, scheme.yellow, scheme.blue, scheme.magenta, scheme.cyan].map(
                  (c, i) => (
                    <div
                      key={i}
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: c }}
                    />
                  )
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      <Separator className="bg-muted" />

      {/* ======== 背景图片 ======== */}
      <div className="space-y-4">
        <Label className="text-base font-semibold">背景图片</Label>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handlePickBackgroundImage}>
            <ImagePlus className="h-4 w-4 mr-2" />
            选择图片
          </Button>
          {backgroundImage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettings({ backgroundImage: "" })}
            >
              <X className="h-4 w-4 mr-1" />
              清除
            </Button>
          )}
        </div>

        {backgroundImage && (
          <div className="rounded-lg border overflow-hidden h-24 bg-muted/10">
            <img
              src={backgroundImage}
              alt="背景预览"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-sm text-muted-foreground">模糊度</Label>
              <span className="text-xs font-mono text-muted-foreground">{backgroundBlur}px</span>
            </div>
            <input
              type="range" min="0" max="20" step="1" value={backgroundBlur}
              onChange={(e) => setSettings({ backgroundBlur: parseInt(e.target.value) })}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-sm text-muted-foreground">不透明度</Label>
              <span className="text-xs font-mono text-muted-foreground">{backgroundOpacity}%</span>
            </div>
            <input
              type="range" min="0" max="100" step="5" value={backgroundOpacity}
              onChange={(e) => setSettings({ backgroundOpacity: parseInt(e.target.value) })}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>
      </div>

      <Separator className="bg-muted" />

      {/* ======== 透明度 ======== */}
      <div className="space-y-4">
        <Label className="text-base font-semibold">透明度</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-sm text-muted-foreground">终端背景</Label>
              <span className="text-xs font-mono text-muted-foreground">{terminalOpacity}%</span>
            </div>
            <input
              type="range" min="0" max="100" step="5" value={terminalOpacity}
              onChange={(e) => setSettings({ terminalOpacity: parseInt(e.target.value) })}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="text-sm text-muted-foreground">UI 面板</Label>
              <span className="text-xs font-mono text-muted-foreground">{uiOpacity}%</span>
            </div>
            <input
              type="range" min="30" max="100" step="5" value={uiOpacity}
              onChange={(e) => setSettings({ uiOpacity: parseInt(e.target.value) })}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>
      </div>

      <Separator className="bg-muted" />

      {/* ======== 自定义 CSS ======== */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label className="text-base font-semibold">自定义 CSS</Label>
          <span className="text-xs text-muted-foreground">高级</span>
        </div>
        <Textarea
          value={customCSS}
          onChange={(e) => setSettings({ customCSS: e.target.value })}
          placeholder={`/* 在此输入自定义 CSS */\n.xterm-viewport {\n  border-radius: 8px;\n}`}
          rows={5}
          className="font-mono text-sm"
        />
      </div>
    </div>
  );
}

// --- 子组件 2：布局设置 ---
function SlotSettings({ tempConfig, onToggle, onActiveChange }: any) {
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

            <div className="grid gap-1.5 p-2 border rounded-xl bg-muted/10">
              {displayModules.map((mod) => {
                const isChecked = tempConfig[side].modules.includes(mod.id);
                return (
                  <div 
                    key={mod.id} 
                    className={`flex items-center space-x-3 p-2 rounded-md transition-all cursor-pointer ${
                      isChecked ? 'bg-primary/10' : 'hover:bg-muted/50'
                    }`}
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

            {tempConfig[side].modules.length > 0 && (
              <div className="space-y-2 pt-2">
                <Label className="text-[11px] text-muted-foreground ml-1">默认展示模块</Label>
                <Select
                  value={tempConfig[side].activeModule}
                  onValueChange={(v) => onActiveChange(side, v)}
                >
                  <SelectTrigger className="h-9 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {tempConfig[side].modules.map((id: string) => (
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
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">备份数据</Label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Button onClick={handleExportAll} variant="outline" className="h-auto py-4 flex flex-col items-center gap-2">
            <FileJson className="h-6 w-6" />
            <span>完整备份配置</span>
            <span className="text-xs text-muted-foreground">包含所有配置和数据</span>
          </Button>
        </div>
      </div>

      <Separator className="bg-muted" />

      {/* 导入区域 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">导入恢复</Label>
          <Button onClick={handleClearAll} variant="destructive" size="sm">
            <Trash2 className="h-4 w-4 mr-2" />
            清空所有
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
          <div className={`p-3 rounded-md text-sm break-all ${
            messageType === 'success' 
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
  const { currentConfig, updateSlotConfig, resetToDefault } = useSlotConfigStore();


  const [tempConfig, setTempConfig] = useState(currentConfig);

  useEffect(() => {
    if (open) setTempConfig(JSON.parse(JSON.stringify(currentConfig)));
  }, [open, currentConfig]);

  const toggleModule = useCallback((side: "left" | "right", moduleId: string) => {
    setTempConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
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
        next[side].modules.push(moduleId);
        if (!next[side].activeModule) next[side].activeModule = moduleId;
      }
      return next;
    });
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle>系统设置</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="theme" className="flex-1 flex overflow-hidden">
          <TabsList className="w-40 flex flex-col h-full bg-muted/20 rounded-none border-r p-2 justify-start">
            <TabsTrigger value="theme" className="w-full justify-start gap-2">🎨 主题</TabsTrigger>
            <TabsTrigger value="slots" className="w-full justify-start gap-2">🧱 布局</TabsTrigger>
            <TabsTrigger value="data" className="w-full justify-start gap-2">💾 数据</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 p-8">
            <TabsContent value="theme" className="m-0 focus-visible:outline-none">
              <ThemeSettings />
            </TabsContent>
            <TabsContent value="slots" className="m-0 focus-visible:outline-none">
              <SlotSettings
                tempConfig={tempConfig}
                onToggle={toggleModule}
                onActiveChange={(side: "left" | "right", val: string) =>
                  setTempConfig((p: any) => ({ ...p, [side]: { ...p[side], activeModule: val } }))
                }
              />
            </TabsContent>
            <TabsContent value="data" className="m-0 focus-visible:outline-none">
              <DataImportExport />
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="p-4 border-t bg-muted/5">
          <Button variant="ghost" size="sm" onClick={() => resetToDefault()}>恢复默认</Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => { updateSlotConfig(tempConfig); onOpenChange(false); }}>
            保存更改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}