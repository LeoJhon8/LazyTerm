import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/dialogs/connection-forms";
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
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>
            {isDirect ? t("快速 Telnet 连接") : (initialConfig ? t("编辑 Telnet 连接") : t("新建 Telnet 连接"))}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <FormField label={t("主机地址")} htmlFor="telnet-host" required>
            <Input
              id="telnet-host"
              value={config.host}
              onChange={(e) => handleChange("host", e.target.value)}
            />
          </FormField>
          {!isDirect && (
            <FormField label={t("名称")} htmlFor="telnet-nickname">
              <Input
                id="telnet-nickname"
                value={config.nickname || ""}
                onChange={(e) => handleChange("nickname", e.target.value)}
              />
            </FormField>
          )}
          <FormField label={t("端口")} htmlFor="telnet-port" required>
            <Input
              id="telnet-port"
              type="number"
              value={config.port}
              onChange={(e) => handleChange("port", parseInt(e.target.value, 10))}
            />
          </FormField>
        </div>
        <DialogFooter className="border-t border-border/50 pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
          <Button onClick={handleSave} disabled={!config.host || !config.port}>{isDirect ? t("连接") : t("保存")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
