import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/store/settings";
import { APP_LANGUAGE_OPTIONS, useI18n } from "@/i18n";
import type { ShellInfo } from "@/types/shell";
import { getAvailableShells } from "@/services/shellService";
import { logger } from "@/lib/logger";

/** 通用设置：语言 + 终端行为 */
export function GeneralSettings() {
  const { language, setLanguage, t } = useI18n();
  const { defaultShell, confirmCloseNonDefaultTabs, terminalAutocomplete, setSettings } = useSettingsStore();
  const [shells, setShells] = useState<ShellInfo[]>([]);

  useEffect(() => {
    getAvailableShells()
      .then(setShells)
      .catch((err) => logger.error("FE/settings/general", "获取可用 Shell 列表失败", { err }));
  }, []);

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex flex-col gap-6 pb-10 px-1">

        {/* 基础设置 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("基础设置")}</Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm">{t("界面语言")}</Label>
              <Select value={language} onValueChange={(value) => setLanguage(value as typeof language)}>
                <SelectTrigger className="h-8 w-36 bg-background/80 border-0 shadow-none focus:ring-1 focus:ring-primary/30 text-sm">
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
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm">{t("默认终端类型")}</Label>
              <Select value={defaultShell} onValueChange={(value) => setSettings({ defaultShell: value })}>
                <SelectTrigger className="h-8 w-36 bg-background/80 border-0 shadow-none focus:ring-1 focus:ring-primary/30 text-sm">
                  <SelectValue placeholder={t("选择终端类型")} />
                </SelectTrigger>
                <SelectContent>
                  {shells.map((s) => (
                    <SelectItem key={s.path} value={s.path}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* 终端行为 */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">{t("终端行为")}</Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label htmlFor="confirm-close" className="text-sm cursor-pointer">{t("关闭非默认终端前确认")}</Label>
              <Switch
                id="confirm-close"
                checked={confirmCloseNonDefaultTabs}
                onCheckedChange={(checked) => setSettings({ confirmCloseNonDefaultTabs: !!checked })}
              />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label htmlFor="terminal-autocomplete" className="text-sm cursor-pointer">{t("终端自动补全")}</Label>
              <Switch
                id="terminal-autocomplete"
                checked={terminalAutocomplete}
                onCheckedChange={(checked) => setSettings({ terminalAutocomplete: !!checked })}
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
