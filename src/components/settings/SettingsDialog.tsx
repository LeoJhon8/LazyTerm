import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useSettingsDialogStore, type SettingsTab } from "@/store/settings-dialog";
import { GeneralSettings } from "./GeneralSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { LayoutSettings } from "./LayoutSettings";
import { AiSettings } from "./AiSettings";
import { CredentialSettings } from "./CredentialSettings";
import { DataSettings } from "./DataSettings";
import { AboutSettings } from "./AboutSettings";
import { ArrowLeft, Bot, ChevronRight, Globe, Palette, LayoutPanelLeft, KeyRound, Database, Info } from "lucide-react";
import { useI18n } from "@/i18n";
import { IS_ANDROID } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** Tab 配置：value → 图标 + 标签 key */
const SETTINGS_TABS: Array<{ value: SettingsTab; icon: React.ComponentType<{ className?: string }>; labelKey: string }> = [
  { value: "general", icon: Globe, labelKey: "通用设置" },
  { value: "appearance", icon: Palette, labelKey: "外观设置" },
  { value: "layout", icon: LayoutPanelLeft, labelKey: "布局管理" },
  { value: "ai", icon: Bot, labelKey: "AI 助手" },
  { value: "credentials", icon: KeyRound, labelKey: "凭据管理" },
  { value: "data", icon: Database, labelKey: "数据备份" },
  { value: "about", icon: Info, labelKey: "关于与更新" },
];

const VISIBLE_SETTINGS_TABS = IS_ANDROID
  ? SETTINGS_TABS.filter((item) => ["general", "appearance", "credentials", "about"].includes(item.value))
  : SETTINGS_TABS;

function SettingsContent({ tab }: { tab: SettingsTab }) {
  switch (tab) {
    case "general":
      return <GeneralSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "layout":
      return <LayoutSettings />;
    case "ai":
      return <AiSettings />;
    case "credentials":
      return <CredentialSettings />;
    case "data":
      return <DataSettings />;
    case "about":
      return <AboutSettings />;
  }
}

/** 系统设置弹窗（原 SlotConfigDialog，已重命名并重构） */
export function SettingsDialog() {
  const { t } = useI18n();
  const { open, activeTab, requestedTab, closeSettings, setActiveTab } = useSettingsDialogStore();
  const [mobilePage, setMobilePage] = useState<SettingsTab | null>(null);

  useEffect(() => {
    if (open && IS_ANDROID) {
      setMobilePage(requestedTab);
    }
  }, [open, requestedTab]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeSettings();
      window.dispatchEvent(new Event("lazy-term-focus"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (IS_ANDROID && mobilePage) {
            event.preventDefault();
            setMobilePage(null);
          }
        }}
        className={cn(
          "max-w-[1000px] w-[95vw] h-[85vh] md:h-[80vh] flex flex-col p-0",
          IS_ANDROID && "h-[calc(100dvh-16px)] w-[calc(100vw-16px)]",
        )}
      >
        <DialogHeader className={cn("border-b p-6 pb-4", IS_ANDROID && "p-4 pr-12")}>
          <div className="flex min-w-0 items-center gap-2">
            {IS_ANDROID && mobilePage && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-ml-2 h-9 w-9 shrink-0 rounded-xl"
                onClick={() => setMobilePage(null)}
                aria-label={t("返回设置目录")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <DialogTitle className="truncate">
              {IS_ANDROID && mobilePage
                ? t(SETTINGS_TABS.find((item) => item.value === mobilePage)!.labelKey as Parameters<typeof t>[0])
                : t("系统设置")}
            </DialogTitle>
          </div>
          <DialogDescription className="hidden">{t("系统设置")}</DialogDescription>
        </DialogHeader>

        {IS_ANDROID ? (
          mobilePage ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4">
                <SettingsContent tab={mobilePage} />
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="grid gap-2 p-4">
                {VISIBLE_SETTINGS_TABS.map(({ value, icon: Icon, labelKey }) => (
                  <button
                    key={value}
                    type="button"
                    className="flex min-h-16 w-full items-center gap-4 rounded-2xl border border-border/45 bg-muted/20 px-4 py-3 text-left transition-colors active:bg-primary/10"
                    onClick={() => {
                      setActiveTab(value);
                      setMobilePage(value);
                    }}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {t(labelKey as Parameters<typeof t>[0])}
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </ScrollArea>
          )
        ) : (

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SettingsTab)} className="flex-1 flex overflow-hidden flex-col md:flex-row">
          <TabsList className="w-full md:w-48 flex flex-row md:flex-col h-auto md:h-full bg-muted/10 md:rounded-none border-b md:border-b-0 md:border-r p-3 gap-2 justify-start overflow-x-auto shrink-0">
            {VISIBLE_SETTINGS_TABS.map(({ value, icon: Icon, labelKey }) => (
              <TabsTrigger
                key={value}
                value={value}
                className={cn(
                  "w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200",
                  IS_ANDROID && "w-auto min-w-max",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="font-medium">{t(labelKey as Parameters<typeof t>[0])}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1">
            <div className={cn("p-8", IS_ANDROID && "p-4")}>
              <TabsContent value="general" className="m-0 focus-visible:outline-none">
                <GeneralSettings />
              </TabsContent>
              <TabsContent value="appearance" className="m-0 focus-visible:outline-none">
                <AppearanceSettings />
              </TabsContent>
              <TabsContent value="layout" className="m-0 focus-visible:outline-none">
                <LayoutSettings />
              </TabsContent>
              <TabsContent value="ai" className="m-0 focus-visible:outline-none">
                <AiSettings />
              </TabsContent>
              <TabsContent value="credentials" className="m-0 focus-visible:outline-none">
                <CredentialSettings />
              </TabsContent>
              <TabsContent value="data" className="m-0 focus-visible:outline-none">
                <DataSettings />
              </TabsContent>
              <TabsContent value="about" className="m-0 focus-visible:outline-none">
                <AboutSettings />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
