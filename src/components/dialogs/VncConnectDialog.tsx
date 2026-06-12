import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
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
        return;
      }

      setHost("");
      setPort("5900");
      setPassword("");
      setNickname("");
      setQuality(30);
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

        <form onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="vnc-nickname" className="text-right">{t("名称")}</Label>
              <Input id="vnc-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} className="col-span-3" />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="vnc-host" className="text-right">{t("主机地址")}</Label>
              <Input id="vnc-host" value={host} onChange={(event) => setHost(event.target.value)} className="col-span-3" required />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="vnc-port" className="text-right">{t("端口")}</Label>
              <Input id="vnc-port" type="number" value={port} onChange={(event) => setPort(event.target.value)} className="col-span-3" required />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="vnc-password" className="text-right">{t("密码")}</Label>
              <Input id="vnc-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="col-span-3" autoComplete="off" />
            </div>

            <Separator />

            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">{t("渲染质量")}</Label>
              <div className="col-span-3 flex items-center gap-4">
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
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
            <Button type="submit">{initialConfig ? t("保存修改") : t("立即创建")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
