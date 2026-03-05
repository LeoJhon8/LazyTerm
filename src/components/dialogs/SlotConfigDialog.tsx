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
import { AVAILABLE_MODULES, LOCKED_MODULES } from "@/config/default-slot-config";
import { useSlotConfigStore } from "@/store/slot-config";
import { useSettingsStore } from "@/store/settings";
import { ScrollArea } from "@/components/ui/scroll-area";

// --- 类型定义 ---
interface SlotConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ThemeType = "light" | "dark" | "system";

// --- 子组件 1：主题设置 ---
function ThemeSettings({ theme, setTheme, fontSize, setFontSize }: any) {
  return (
    <div className="space-y-6 py-4">
      <div className="grid gap-4">
        <Label className="text-base font-semibold">外观主题</Label>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: "light", label: "浅色模式", icon: "☀️" },
            { value: "dark", label: "深色模式", icon: "🌙" },
            { value: "system", label: "系统跟随", icon: "💻" }
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
      
      <div className="grid gap-6">
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <Label className="text-base font-semibold">全局字体大小</Label>
            <span className="text-sm bg-primary/10 text-primary px-3 py-1 rounded-full font-mono">
              {fontSize}px
            </span>
          </div>
          <div className="relative px-2">
            <input
              type="range" min="12" max="20" step="1" value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 子组件 2：布局设置 ---
function SlotSettings({ tempConfig, onToggle, onActiveChange }: any) {
  // 1. 过滤掉锁定的模块 (Tabs, QuickCmd)
  // 2. 额外过滤掉“设置”模块，使其不支持调整位置
  const displayModules = AVAILABLE_MODULES.filter(mod => 
    !LOCKED_MODULES.includes(mod.id) && 
    mod.id !== "SettingModule" && // 假设设置模块ID为这个，若不同请修改
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
                    onClick={() => onToggle(side, mod.id)} // 点击整行即可切换
                  >
                    <Checkbox
                      id={`${side}-${mod.id}`}
                      checked={isChecked}
                      className="pointer-events-none" // 让点击由外层div处理
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

// --- 主组件 ---
export function SlotConfigDialog({ open, onOpenChange }: SlotConfigDialogProps) {
  const { currentConfig, updateSlotConfig, resetToDefault } = useSlotConfigStore();
  const { theme, setTheme, fontSize, setFontSize } = useSettingsStore();

  const [tempConfig, setTempConfig] = useState(currentConfig);

  useEffect(() => {
    if (open) setTempConfig(JSON.parse(JSON.stringify(currentConfig)));
  }, [open, currentConfig]);

  const toggleModule = useCallback((side: "left" | "right", moduleId: string) => {
    setTempConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const isAlreadyInThisSide = next[side].modules.includes(moduleId);

      if (isAlreadyInThisSide) {
        // 如果已在当前侧，则移除
        next[side].modules = next[side].modules.filter((id: string) => id !== moduleId);
        if (next[side].activeModule === moduleId) {
          next[side].activeModule = next[side].modules[0] || "";
        }
      } else {
        // 如果在另一侧，先从另一侧移除（保证唯一性）
        const otherSide = side === "left" ? "right" : "left";
        next[otherSide].modules = next[otherSide].modules.filter((id: string) => id !== moduleId);
        if (next[otherSide].activeModule === moduleId) {
          next[otherSide].activeModule = next[otherSide].modules[0] || "";
        }
        // 加入当前侧
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
          </TabsList>

          <ScrollArea className="flex-1 p-8">
            <TabsContent value="theme" className="m-0 focus-visible:outline-none">
              <ThemeSettings
                theme={theme} setTheme={setTheme}
                fontSize={fontSize} setFontSize={setFontSize}
              />
            </TabsContent>
            <TabsContent value="slots" className="m-0 focus-visible:outline-none">
              <SlotSettings
                tempConfig={tempConfig}
                onToggle={toggleModule}
                onActiveChange={(side: any, val: any) =>
                  setTempConfig((p) => ({ ...p, [side]: { ...p[side], activeModule: val } }))
                }
              />
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