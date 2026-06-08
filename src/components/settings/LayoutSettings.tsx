import { useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AVAILABLE_MODULES, LOCKED_MODULES } from "@/config/default-slot-config";
import { useSlotConfigStore } from "@/store/slot-config";
import { useSettingsStore } from "@/store/settings";
import {
  MAX_QUICK_COMMAND_FONT_SIZE,
  MIN_QUICK_COMMAND_FONT_SIZE,
  normalizeQuickCommandFontSize,
} from "@/store/settings-values";
import { getModuleDisplayName, useI18n } from "@/i18n";
import { PanelLeft, PanelRight } from "lucide-react";

type SlotSide = "left" | "right" | "none";

/** 判断模块当前分配到哪一侧 */
function getModuleSide(
  moduleId: string,
  leftModules: string[],
  rightModules: string[]
): SlotSide {
  if (leftModules.includes(moduleId)) return "left";
  if (rightModules.includes(moduleId)) return "right";
  return "none";
}

/** 布局设置：左右侧栏模块配置 */
export function LayoutSettings() {
  const { locale, t } = useI18n();
  const { currentConfig, updateSlotConfig, resetToDefault } = useSlotConfigStore();
  const { quickCommandDisplayMode, quickCommandFontSize, setSettings } = useSettingsStore();

  // 过滤掉锁定的模块（TabModule、QuickCmdModule 等固定位置）
  const displayModules = AVAILABLE_MODULES.filter(
    (mod) => !LOCKED_MODULES.includes(mod.id)
  );

  /** 将模块分配到指定侧（联动：自动从另一侧移除） */
  const assignModule = useCallback(
    (moduleId: string, side: SlotSide) => {
      const next = structuredClone(useSlotConfigStore.getState().currentConfig);

      // 先从两侧都移除
      next.left.modules = next.left.modules.filter((id: string) => id !== moduleId);
      next.right.modules = next.right.modules.filter((id: string) => id !== moduleId);

      // 如果当前 activeModule 被移除了，需要重置
      if (next.left.activeModule === moduleId) {
        next.left.activeModule = next.left.modules[0] || "";
      }
      if (next.right.activeModule === moduleId) {
        next.right.activeModule = next.right.modules[0] || "";
      }

      // 添加到目标侧
      if (side === "left") {
        next.left.modules.push(moduleId);
        if (!next.left.activeModule) next.left.activeModule = moduleId;
        next.left.collapsed = false;
      } else if (side === "right") {
        next.right.modules.push(moduleId);
        if (!next.right.activeModule) next.right.activeModule = moduleId;
        next.right.collapsed = false;
      }

      // 无模块时自动收起
      if (next.left.modules.length === 0) {
        next.left.collapsed = true;
        next.left.activeModule = "";
      }
      if (next.right.modules.length === 0) {
        next.right.collapsed = true;
        next.right.activeModule = "";
      }

      updateSlotConfig(next);
    },
    [updateSlotConfig]
  );

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex flex-col gap-6 pb-10 px-1">

        {/* 模块分配 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">
            {t("侧栏模块")}
          </Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            {/* 表头 */}
            <div className="flex items-center px-4 py-2 bg-muted/30">
              <span className="flex-1 text-xs text-muted-foreground">{t("模块")}</span>
              <div className="flex items-center gap-1">
                <span className="w-7 flex items-center justify-center" title={t("左侧栏")}>
                  <PanelLeft className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <span className="w-7 flex items-center justify-center text-[10px] text-muted-foreground">
                  —
                </span>
                <span className="w-7 flex items-center justify-center" title={t("右侧栏")}>
                  <PanelRight className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </div>
            </div>

            {displayModules.map((mod) => {
              const currentSide = getModuleSide(
                mod.id,
                currentConfig.left.modules,
                currentConfig.right.modules
              );

              return (
                <div
                  key={mod.id}
                  className="flex items-center px-4 py-2.5 hover:bg-background/40 transition-colors"
                >
                  <span className="flex-1 text-sm font-medium">
                    {getModuleDisplayName(mod.id, locale)}
                  </span>
                  <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
                    {(
                      [
                        { side: "left" as SlotSide, icon: <PanelLeft className="h-3.5 w-3.5" /> },
                        { side: "none" as SlotSide, icon: <span className="text-[10px] leading-none">—</span> },
                        { side: "right" as SlotSide, icon: <PanelRight className="h-3.5 w-3.5" /> },
                      ] as const
                    ).map(({ side, icon }) => (
                      <button
                        key={side}
                        type="button"
                        className={cn(
                          "w-7 h-6 flex items-center justify-center rounded-md transition-all text-muted-foreground",
                          currentSide === side
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "hover:bg-background/60 hover:text-foreground"
                        )}
                        onClick={() => assignModule(mod.id, side)}
                        title={
                          side === "left"
                            ? t("分配到左侧栏")
                            : side === "right"
                              ? t("分配到右侧栏")
                              : t("不展示")
                        }
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground px-3 mt-1">
            {t("每个模块只能分配到左侧或右侧，无模块的侧栏将自动收起。")}
          </p>
        </div>

        {/* 快捷命令栏 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">
            {t("工具栏")}
          </Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0 mr-4">
                <Label className="text-sm font-medium">{t("快捷命令栏")}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("在终端底部显示快捷命令，可快速执行常用命令")}
                </p>
              </div>
              <Switch
                checked={currentConfig.quickCmdBarEnabled}
                onCheckedChange={(checked) => 
                  updateSlotConfig({ quickCmdBarEnabled: checked })
                }
              />
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0 mr-4">
                <Label className="text-sm font-medium">{t("快捷命令显示模式")}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("单行保持紧凑，多行面板可同时展示更多命令。")}
                </p>
              </div>
              <Select
                value={quickCommandDisplayMode}
                onValueChange={(value) =>
                  setSettings({ quickCommandDisplayMode: value as typeof quickCommandDisplayMode })
                }
              >
                <SelectTrigger className="h-8 w-32 rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bar">{t("单行工具栏")}</SelectItem>
                  <SelectItem value="panel">{t("多行面板")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0 mr-4">
                <Label className="text-sm font-medium">{t("快捷命令字体大小")}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("调整快捷命令按钮文字大小。")}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Input
                  type="number"
                  min={MIN_QUICK_COMMAND_FONT_SIZE}
                  max={MAX_QUICK_COMMAND_FONT_SIZE}
                  step={1}
                  value={quickCommandFontSize}
                  onChange={(event) =>
                    setSettings({
                      quickCommandFontSize: normalizeQuickCommandFontSize(event.target.valueAsNumber),
                    })
                  }
                  className="h-8 w-20 rounded-lg text-right"
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            </div>
          </div>
        </div>

        {/* 恢复默认布局 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">
            {t("重置")}
          </Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0 mr-4">
                <Label className="text-sm font-medium">{t("恢复默认布局")}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("如果您对当前的布局不满意，可以一键将左右侧栏的所有面板及状态恢复至初始默认设置。")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-4 shrink-0"
                onClick={() => resetToDefault()}
              >
                {t("恢复默认")}
              </Button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
