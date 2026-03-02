import { useState, useEffect, useMemo, useCallback } from "react";
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
import { AVAILABLE_MODULES } from "@/config/default-slot-config";
import { useSlotConfigStore } from "@/store/slot-config";
import { useSettingsStore } from "@/store/settings";
import { ScrollArea } from "@/components/ui/scroll-area";

// --- 类型定义 ---
interface SlotConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 假设这些类型来自于你的 store，如果没有可以手动定义
type ThemeType = "light" | "dark" | "system";

// --- 子组件 1：主题设置 (移出主组件外部) ---
interface ThemeSettingsProps {
  theme: ThemeType;
  setTheme: (theme: ThemeType) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
}

function ThemeSettings({ theme, setTheme, fontSize, setFontSize }: ThemeSettingsProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="grid gap-2">
        <Label>外观主题</Label>
        <Select value={theme} onValueChange={(v: ThemeType) => setTheme(v)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">浅色模式</SelectItem>
            <SelectItem value="dark">深色模式</SelectItem>
            <SelectItem value="system">系统跟随</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4">
        <div className="flex justify-between">
          <Label>全局字体大小</Label>
          <span className="text-sm text-muted-foreground">{fontSize}px</span>
        </div>
        <input
          type="range"
          min="12"
          max="20"
          step="1"
          value={fontSize}
          onChange={(e) => setFontSize(parseInt(e.target.value))}
          className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer"
        />
      </div>
    </div>
  );
}

// --- 子组件 2：布局设置 (移出主组件外部) ---
interface SlotSettingsProps {
  tempConfig: any; // 建议替换为具体的 SlotConfig 类型
  moduleMap: Map<string, string>;
  onToggle: (side: "left" | "right", id: string) => void;
  onSingleChange: (pos: "top" | "bottom", id: string) => void;
  onActiveChange: (side: "left" | "right", id: string) => void;
}

function SlotSettings({ tempConfig, moduleMap, onToggle, onSingleChange, onActiveChange }: SlotSettingsProps) {
  return (
    <div className="space-y-8 py-4">
      <div className="grid grid-cols-2 gap-8">
        {(["left", "right"] as const).map((side) => (
          <div key={side} className="space-y-4">
            <Label className="text-base font-bold capitalize">
              {side === "left" ? "左侧栏" : "右侧栏"}
            </Label>
            <div className="grid gap-3 p-3 border rounded-lg bg-muted/10">
              {AVAILABLE_MODULES.map((mod) => {
                const occupiedBy = moduleMap.get(mod.id);
                const isThisSlot = tempConfig[side].modules.includes(mod.id);
                return (
                  <div key={mod.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`${side}-${mod.id}`}
                      checked={isThisSlot}
                      onCheckedChange={() => onToggle(side, mod.id)}
                      disabled={!!occupiedBy && !isThisSlot}
                    />
                    <label
                      htmlFor={`${side}-${mod.id}`}
                      className={`text-sm ${
                        occupiedBy && !isThisSlot ? "text-muted-foreground line-through" : ""
                      }`}
                    >
                      {mod.name}
                      {occupiedBy && !isThisSlot && ` (${occupiedBy})`}
                    </label>
                  </div>
                );
              })}
            </div>
            {tempConfig[side].modules.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">默认展示模块</Label>
                <Select
                  value={tempConfig[side].activeModule}
                  onValueChange={(v) => onActiveChange(side, v)}
                >
                  {/* 注意：此处移除了非法的 size 属性，改用 className 控制高度 */}
                  <SelectTrigger className="h-8">
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

      <Separator />

      <div className="grid grid-cols-2 gap-8">
        {(["top", "bottom"] as const).map((pos) => (
          <div key={pos} className="space-y-2">
            <Label className="text-base font-bold capitalize">
              {pos === "top" ? "页头" : "页脚"}
            </Label>
            <Select value={tempConfig[pos].module} onValueChange={(v) => onSingleChange(pos, v)}>
              <SelectTrigger>
                <SelectValue placeholder="选择固定模块" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">无</SelectItem>
                {AVAILABLE_MODULES.map((mod) => {
                  const occupiedBy = moduleMap.get(mod.id);
                  const isThisSlot = tempConfig[pos].module === mod.id;
                  return (
                    <SelectItem key={mod.id} value={mod.id} disabled={!!occupiedBy && !isThisSlot}>
                      {mod.name} {occupiedBy && !isThisSlot ? `(${occupiedBy})` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
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

  // 修复报错 1: 避免同步 setState。
  // 通过 key={open} 强制 DialogContent 在打开时重新挂载，自动初始化状态
  // 或者在 useEffect 中加判断，确保只在从 false 变为 true 时同步一次
  useEffect(() => {
    if (open) {
      setTempConfig(JSON.parse(JSON.stringify(currentConfig)));
    }
  }, [open, currentConfig]);

  const moduleMap = useMemo(() => {
    const map = new Map<string, string>();
    tempConfig.left.modules.forEach((id: string) => map.set(id, "左侧"));
    tempConfig.right.modules.forEach((id: string) => map.set(id, "右侧"));
    if (tempConfig.top.module && tempConfig.top.module !== "none") map.set(tempConfig.top.module, "顶部");
    if (tempConfig.bottom.module && tempConfig.bottom.module !== "none") map.set(tempConfig.bottom.module, "底部");
    return map;
  }, [tempConfig]);

  const removeFromAll = (config: any, moduleId: string) => {
    config.left.modules = config.left.modules.filter((id: string) => id !== moduleId);
    config.right.modules = config.right.modules.filter((id: string) => id !== moduleId);
    if (config.top.module === moduleId) config.top.module = "none";
    if (config.bottom.module === moduleId) config.bottom.module = "none";
  };

  const toggleMultiModule = useCallback((slot: "left" | "right", moduleId: string) => {
    setTempConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const list = [...next[slot].modules];
      const index = list.indexOf(moduleId);

      if (index > -1) {
        list.splice(index, 1);
        next[slot].modules = list;
        if (next[slot].activeModule === moduleId) {
          next[slot].activeModule = list[0] || "";
        }
      } else {
        removeFromAll(next, moduleId);
        next[slot].modules.push(moduleId);
        if (!next[slot].activeModule) next[slot].activeModule = moduleId;
      }
      return next;
    });
  }, []);

  const setSingleModule = useCallback((slot: "top" | "bottom", moduleId: string) => {
    setTempConfig((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (moduleId !== "none") removeFromAll(next, moduleId);
      next[slot].module = moduleId;
      return next;
    });
  }, []);

  const handleSave = () => {
    updateSlotConfig(tempConfig);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>系统配置</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="theme" className="flex-1 flex overflow-hidden">
          <TabsList className="w-40 flex flex-col h-full bg-muted/50 rounded-none border-r p-2 justify-start space-y-1">
            <TabsTrigger value="theme" className="w-full justify-start">
              个性化主题
            </TabsTrigger>
            <TabsTrigger value="slots" className="w-full justify-start">
              布局与插槽
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 p-6">
            <TabsContent value="theme" className="m-0 focus-visible:outline-none">
              <ThemeSettings
                theme={theme as ThemeType}
                setTheme={setTheme}
                fontSize={fontSize}
                setFontSize={setFontSize}
              />
            </TabsContent>
            <TabsContent value="slots" className="m-0 focus-visible:outline-none">
              <SlotSettings
                tempConfig={tempConfig}
                moduleMap={moduleMap}
                onToggle={toggleMultiModule}
                onSingleChange={setSingleModule}
                onActiveChange={(side, val) =>
                  setTempConfig((p) => ({ ...p, [side]: { ...p[side], activeModule: val } }))
                }
              />
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="p-4 border-t bg-muted/20">
          <div className="flex justify-between w-full">
            <Button
              variant="ghost"
              onClick={() => {
                resetToDefault();
                onOpenChange(false);
              }}
            >
              重置为默认
            </Button>
            <div className="space-x-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button onClick={handleSave}>保存更改</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}