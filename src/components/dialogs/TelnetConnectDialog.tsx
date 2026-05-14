import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TerminalIcon } from "lucide-react";
import type { TelnetConfig } from "@/types/terminal";
import { useI18n } from "@/i18n";

interface TelnetConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (config: TelnetConfig) => void;
  initialConfig?: TelnetConfig;
  isDirect?: boolean;
}

export function TelnetConnectDialog({ 
  open, 
  onOpenChange, 
  onSave, 
  initialConfig, 
  isDirect 
}: TelnetConnectDialogProps) {
  const { t } = useI18n();
  const [config, setConfig] = useState<TelnetConfig>(
    initialConfig || {
      host: "",
      port: 23,
      nickname: "",
    }
  );

  useEffect(() => {
    if (open) {
      if (initialConfig) {
        setConfig(initialConfig);
      } else {
        setConfig({ host: "", port: 23, nickname: "" });
      }
    }
  }, [open, initialConfig]);

  const handleChange = (field: keyof TelnetConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave?.(config);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TerminalIcon className="h-5 w-5 text-emerald-500" />
            {isDirect ? t("快速 Telnet 连接") : (initialConfig ? t("编辑 Telnet 连接") : t("新建 Telnet 连接"))}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="telnet-host" className="text-right">{t("主机名 (Host)")}</Label>
            <Input
              id="telnet-host"
              value={config.host}
              onChange={(e) => handleChange("host", e.target.value)}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="telnet-port" className="text-right">{t("端口 (Port)")}</Label>
            <Input
              id="telnet-port"
              type="number"
              value={config.port}
              onChange={(e) => handleChange("port", parseInt(e.target.value, 10))}
              className="col-span-3"
            />
          </div>
          {!isDirect && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="telnet-nickname" className="text-right">{t("名称")}</Label>
              <Input
                id="telnet-nickname"
                value={config.nickname || ""}
                onChange={(e) => handleChange("nickname", e.target.value)}
                className="col-span-3"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
          <Button onClick={handleSave} disabled={!config.host || !config.port}>{isDirect ? t("连接") : t("保存")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
