import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/dialogs/connection-forms";
import { useI18n } from "@/i18n";

export interface RdpCredentials {
  username: string;
  domain?: string;
  password: string;
}

export function RdpCredentialsDialog({
  initialUsername,
  initialDomain,
  onCancel,
  onSubmit,
}: {
  initialUsername: string;
  initialDomain?: string;
  onCancel: () => void;
  onSubmit: (credentials: RdpCredentials) => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState(initialUsername);
  const [domain, setDomain] = useState(initialDomain ?? "");
  const [password, setPassword] = useState("");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>{t("修改 Windows 登录凭据")}</DialogTitle>
          <DialogDescription>{t("新凭据仅用于当前标签页，不会修改已保存的会话或共享凭据。")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-5" onSubmit={(event) => {
          event.preventDefault();
          if (username.trim()) onSubmit({ username: username.trim(), domain: domain.trim() || undefined, password });
        }}>
          <FormField label={t("用户名")} htmlFor="rdp-retry-username" required>
            <Input id="rdp-retry-username" value={username} onChange={(event) => setUsername(event.target.value)} required autoComplete="off" />
          </FormField>
          <FormField label={t("域")} htmlFor="rdp-retry-domain">
            <Input id="rdp-retry-domain" value={domain} onChange={(event) => setDomain(event.target.value)} autoComplete="off" />
          </FormField>
          <FormField label={t("密码")} htmlFor="rdp-retry-password">
            <Input id="rdp-retry-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" autoFocus />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>{t("取消")}</Button>
            <Button type="submit" disabled={!username.trim()}>{t("重新连接")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
