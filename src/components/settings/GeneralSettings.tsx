import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore, type TerminalRightClickBehavior } from "@/store/settings";
import {
  MAX_LONG_COMMAND_IDLE_SECONDS,
  MAX_LONG_COMMAND_THRESHOLD_MINUTES,
  MIN_LONG_COMMAND_IDLE_SECONDS,
  MIN_LONG_COMMAND_THRESHOLD_MINUTES,
  normalizeLongCommandIdleSeconds,
  normalizeLongCommandThresholdMinutes,
} from "@/store/settings-values";
import { APP_LANGUAGE_OPTIONS, useI18n } from "@/i18n";
import { isWindowsPlatform, resolveRdpBackend, type ConfigurableRdpBackend } from "@/lib/rdp-backend";
import type { ShellInfo } from "@/types/shell";
import { getAvailableShells } from "@/services/shellService";
import { logger } from "@/lib/logger";

/** 通用设置：语言 + 终端行为 */
export function GeneralSettings() {
  const { language, setLanguage, t } = useI18n();
  const {
    defaultShell,
    rdpBackend,
    confirmCloseNonDefaultTabs,
    terminalAutocomplete,
    autocompleteSource,
    terminalTimelineEnabled,
    longCommandNotificationEnabled,
    longCommandThresholdMinutes,
    longCommandIdleSeconds,
    copyOnSelect,
    terminalRightClickBehavior,
    setSettings,
  } = useSettingsStore();
  const isWindows = isWindowsPlatform();
  const resolvedRdpBackend = resolveRdpBackend(rdpBackend);
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
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex flex-col gap-0.5">
                <Label className="text-sm">{t("RDP 连接方案")}</Label>
                {!isWindows && <span className="text-xs text-muted-foreground">{t("非 Windows 平台使用 FreeRDP")}</span>}
              </div>
              <Select
                value={resolvedRdpBackend}
                disabled={!isWindows}
                onValueChange={(value) => setSettings({ rdpBackend: value as ConfigurableRdpBackend })}
              >
                <SelectTrigger className="h-8 w-44 bg-background/80 border-0 shadow-none focus:ring-1 focus:ring-primary/30 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="freerdp">FreeRDP</SelectItem>
                  <SelectItem value="msrdpax">MsTscAx</SelectItem>
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
            {terminalAutocomplete && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <Label className="text-sm">{t("自动补全数据源")}</Label>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autocompleteSource.includes('history')}
                      onChange={(e) => {
                        const newValue: ('history' | 'quick')[] = e.target.checked
                          ? [...autocompleteSource, 'history']
                          : autocompleteSource.filter(s => s !== 'history');
                        // 如果取消勾选后没有任何数据源，自动关闭自动补全
                        const shouldDisable = newValue.length === 0;
                        setSettings({ 
                          autocompleteSource: shouldDisable ? ['history', 'quick'] : newValue,
                          terminalAutocomplete: !shouldDisable
                        });
                      }}
                      className="rounded border-border/70"
                    />
                    <span className="text-sm">{t("历史命令")}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autocompleteSource.includes('quick')}
                      onChange={(e) => {
                        const newValue: ('history' | 'quick')[] = e.target.checked
                          ? [...autocompleteSource, 'quick']
                          : autocompleteSource.filter(s => s !== 'quick');
                        // 如果取消勾选后没有任何数据源，自动关闭自动补全
                        const shouldDisable = newValue.length === 0;
                        setSettings({ 
                          autocompleteSource: shouldDisable ? ['history', 'quick'] : newValue,
                          terminalAutocomplete: !shouldDisable
                        });
                      }}
                      className="rounded border-border/70"
                    />
                    <span className="text-sm">{t("快捷命令")}</span>
                  </label>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="terminal-timeline" className="text-sm cursor-pointer">{t("显示命令时间线")}</Label>
                <span className="text-xs text-muted-foreground">{t("关闭时仍保留当前会话最近 500 条命令时间")}</span>
              </div>
              <Switch
                id="terminal-timeline"
                checked={terminalTimelineEnabled}
                onCheckedChange={(checked) => setSettings({ terminalTimelineEnabled: !!checked })}
              />
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-2.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <Label htmlFor="long-command-notification" className="text-sm cursor-pointer">
                  {t("长命令完成通知")}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {t("命令运行超过设定时间后，在完成时发送通知中心消息")}
                </span>
              </div>
              <Switch
                id="long-command-notification"
                checked={longCommandNotificationEnabled}
                onCheckedChange={(checked) => setSettings({ longCommandNotificationEnabled: !!checked })}
              />
            </div>
            {longCommandNotificationEnabled && (
              <>
                <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="long-command-threshold" className="text-sm">
                      {t("长命令判定时间")}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {t("默认 3 分钟，可设置 1 到 120 分钟")}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      id="long-command-threshold"
                      type="number"
                      min={MIN_LONG_COMMAND_THRESHOLD_MINUTES}
                      max={MAX_LONG_COMMAND_THRESHOLD_MINUTES}
                      step={1}
                      value={longCommandThresholdMinutes}
                      onChange={(event) => {
                        if (event.target.value === "") return;
                        setSettings({
                          longCommandThresholdMinutes: normalizeLongCommandThresholdMinutes(
                            event.target.valueAsNumber
                          ),
                        });
                      }}
                      className="h-8 w-20 rounded-md bg-background/80 px-2 text-right"
                    />
                    <span className="text-sm text-muted-foreground">{t("分钟")}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="long-command-idle-seconds" className="text-sm">
                      {t("输出静默判定时间")}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {t("默认 15 秒，可设置 5 到 300 秒")}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      id="long-command-idle-seconds"
                      type="number"
                      min={MIN_LONG_COMMAND_IDLE_SECONDS}
                      max={MAX_LONG_COMMAND_IDLE_SECONDS}
                      step={1}
                      value={longCommandIdleSeconds}
                      onChange={(event) => {
                        if (event.target.value === "") return;
                        setSettings({
                          longCommandIdleSeconds: normalizeLongCommandIdleSeconds(
                            event.target.valueAsNumber
                          ),
                        });
                      }}
                      className="h-8 w-20 rounded-md bg-background/80 px-2 text-right"
                    />
                    <span className="text-sm text-muted-foreground">{t("秒")}</span>
                  </div>
                </div>
              </>
            )}
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="copy-on-select" className="text-sm cursor-pointer">{t("选中后自动复制")}</Label>
                <span className="text-xs text-muted-foreground">{t("选中文本后立即写入剪贴板")}</span>
              </div>
              <Switch
                id="copy-on-select"
                checked={copyOnSelect}
                onCheckedChange={(checked) => setSettings({ copyOnSelect: !!checked })}
              />
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <Label className="text-sm">{t("终端右键操作")}</Label>
              <Select
                value={terminalRightClickBehavior}
                onValueChange={(value) => setSettings({
                  terminalRightClickBehavior: value as TerminalRightClickBehavior,
                })}
              >
                <SelectTrigger className="h-8 w-44 bg-background/80 border-0 shadow-none focus:ring-1 focus:ring-primary/30 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="context-menu">{t("打开快捷菜单")}</SelectItem>
                  <SelectItem value="quick-copy-paste">{t("快捷复制/粘贴")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
