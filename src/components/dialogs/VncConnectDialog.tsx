import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/dialogs/connection-forms";
import type { VNCConfig } from "@/types/terminal";
import { useI18n } from "@/i18n";

interface VncConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: VNCConfig) => void;
  initialConfig?: VNCConfig;
  isDirect?: boolean;
}

export function VncConnectDialog({ open, onOpenChange, onSave, initialConfig, isDirect }: VncConnectDialogProps) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5900");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [quality, setQuality] = useState(30);
  const [viewOnly, setViewOnly] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (initialConfig) {
        setHost(initialConfig.host || "");
        setPort(initialConfig.port?.toString() || "5900");
        setPassword(initialConfig.password || "");
        setNickname(initialConfig.nickname || "");
        setQuality(initialConfig.quality ?? 30);
        setViewOnly(initialConfig.viewOnly ?? false);
        return;
      }

      setHost("");
      setPort("5900");
      setPassword("");
      setNickname("");
      setQuality(30);
      setViewOnly(false);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, initialConfig]);

  const handleSave = () => {
    if (!host) {
      return;
    }

    onSave({
      host,
      port: parseInt(port, 10) || 5900,
      credentialId: initialConfig?.credentialId,
      password: password || undefined,
      nickname: nickname || undefined,
      shared: true,
      viewOnly,
      allowJpeg: true,
      quality,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>
            {isDirect ? t("发起临时 VNC 连接") : initialConfig ? t("编辑 VNC 配置") : t("新建 VNC 配置")}
          </DialogTitle>
        </DialogHeader>

        <form className="grid gap-5" onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
          <div className="grid gap-4 py-2">
            <FormField label={t("名称")} htmlFor="vnc-nickname">
              <Input id="vnc-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} />
            </FormField>

            <FormField label={t("主机地址")} htmlFor="vnc-host" required>
              <Input id="vnc-host" value={host} onChange={(event) => setHost(event.target.value)} required />
            </FormField>

            <FormField label={t("端口")} htmlFor="vnc-port" required>
              <Input id="vnc-port" type="number" value={port} onChange={(event) => setPort(event.target.value)} required />
            </FormField>

            <FormField label={t("密码")} htmlFor="vnc-password">
              <Input id="vnc-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
            </FormField>

            <FormField label={t("渲染质量")}>
              <div className="flex items-center gap-4">
                <Slider
                  min={10}
                  max={100}
                  step={10}
                  value={[quality]}
                  onValueChange={(val) => setQuality(val[0])}
                  className="flex-1"
                />
                <span className="text-sm w-8 text-right">{quality}%</span>
              </div>
            </FormField>

            <FormField label={t("仅查看")} htmlFor="vnc-view-only">
              <div className="flex min-h-10 items-center gap-3">
                <Checkbox
                  id="vnc-view-only"
                  checked={viewOnly}
                  onCheckedChange={(checked) => setViewOnly(checked === true)}
                />
                <Label htmlFor="vnc-view-only" className="text-sm text-muted-foreground">
                  {t("连接后不发送鼠标与键盘输入")}
                </Label>
              </div>
            </FormField>
          </div>

          <DialogFooter className="border-t border-border/50 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
            <Button type="submit">{initialConfig ? t("保存修改") : t("立即创建")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
