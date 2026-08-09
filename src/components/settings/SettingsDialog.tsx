import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSettingsDialogStore, type SettingsTab } from "@/store/settings-dialog";
import { GeneralSettings } from "./GeneralSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { LayoutSettings } from "./LayoutSettings";
import { AiSettings } from "./AiSettings";
import { CredentialSettings } from "./CredentialSettings";
import { DataSettings } from "./DataSettings";
import { AboutSettings } from "./AboutSettings";
import { Bot, Globe, Palette, LayoutPanelLeft, KeyRound, Database, Info } from "lucide-react";
import { useI18n } from "@/i18n";

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

/** 系统设置弹窗（原 SlotConfigDialog，已重命名并重构） */
export function SettingsDialog() {
  const { t } = useI18n();
  const { open, activeTab, closeSettings, setActiveTab } = useSettingsDialogStore();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeSettings();
      window.dispatchEvent(new Event("lazy-term-focus"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-[1000px] w-[95vw] h-[85vh] md:h-[80vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle>{t("系统设置")}</DialogTitle>
          <DialogDescription className="hidden">{t("系统设置")}</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SettingsTab)} className="flex-1 flex overflow-hidden flex-col md:flex-row">
          <TabsList className="w-full md:w-48 flex flex-row md:flex-col h-auto md:h-full bg-muted/10 md:rounded-none border-b md:border-b-0 md:border-r p-3 gap-2 justify-start overflow-x-auto shrink-0">
            {SETTINGS_TABS.map(({ value, icon: Icon, labelKey }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="w-full justify-start gap-3 px-4 py-2.5 data-[state=active]:bg-primary/10 data-[state=active]:text-primary transition-all duration-200"
              >
                <Icon className="h-4 w-4" />
                <span className="font-medium">{t(labelKey as Parameters<typeof t>[0])}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="flex-1">
            <div className="p-8">
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
      </DialogContent>
    </Dialog>
  );
}
