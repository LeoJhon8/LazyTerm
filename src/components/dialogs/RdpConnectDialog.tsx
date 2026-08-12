import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RDPConfig } from "@/types/terminal";
import { useI18n } from "@/i18n";
import { resolveRdpBackend } from "@/lib/rdp-backend";
import { useSettingsStore } from "@/store/settings";

interface RdpConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: RDPConfig) => void;
  initialConfig?: RDPConfig;
  isDirect?: boolean;
}

export function RdpConnectDialog({ open, onOpenChange, onSave, initialConfig, isDirect }: RdpConnectDialogProps) {
  const { t } = useI18n();
  const configuredRdpBackend = useSettingsStore((state) => state.rdpBackend);
  const fixedBackend = resolveRdpBackend(configuredRdpBackend);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3389");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState("");
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (initialConfig) {
        setHost(initialConfig.host || "");
        setPort(initialConfig.port?.toString() || "3389");
        setUsername(initialConfig.username || "");
        setPassword(initialConfig.password || "");
        setDomain(initialConfig.domain || "");
        setNickname(initialConfig.nickname || "");
        return;
      }

      setHost("");
      setPort("3389");
      setUsername("");
      setPassword("");
      setDomain("");
      setNickname("");
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open, initialConfig]);

  const handleSave = () => {
    if (!host || !username) {
      return;
    }

    onSave({
      host,
      port: parseInt(port, 10) || 3389,
      username,
      credentialId: initialConfig?.credentialId,
      password: password || undefined,
      domain: domain || undefined,
      nickname: nickname || undefined,
      backend: fixedBackend,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>
            {isDirect ? t("发起临时 Windows 连接") : initialConfig ? t("编辑 Windows 配置") : t("新建 Windows 配置")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={(event) => { event.preventDefault(); handleSave(); }}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="rdp-nickname" className="text-right">{t("名称")}</Label>
              <Input id="rdp-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} className="col-span-3" />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="rdp-host" className="text-right">{t("主机地址")}</Label>
              <Input id="rdp-host" value={host} onChange={(event) => setHost(event.target.value)} className="col-span-3" required />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="rdp-port" className="text-right">{t("端口")}</Label>
              <Input id="rdp-port" type="number" value={port} onChange={(event) => setPort(event.target.value)} className="col-span-3" required />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="rdp-username" className="text-right">{t("用户名")}</Label>
              <Input id="rdp-username" value={username} onChange={(event) => setUsername(event.target.value)} className="col-span-3" required />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="rdp-domain" className="text-right">{t("域")}</Label>
              <Input id="rdp-domain" value={domain} onChange={(event) => setDomain(event.target.value)} className="col-span-3" />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="rdp-password" className="text-right">{t("密码")}</Label>
              <Input id="rdp-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="col-span-3" autoComplete="off" />
            </div>

            <p className="col-span-4 text-xs text-muted-foreground">
              {t("远程桌面尺寸将在连接时按当前窗口锁定；调整到期望大小后重连即可更新。")}
            </p>

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
