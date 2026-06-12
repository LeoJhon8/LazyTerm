import { useMemo, useState } from "react";
import { KeyRound, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useCredentialsStore } from "@/store/credentials";
import type { Credential, CredentialInput, CredentialType } from "@/types/credential";

const EMPTY_FORM: CredentialInput = {
  name: "",
  type: "password",
  username: "",
  password: "",
  privateKeyPath: "",
  privateKey: "",
  privateKeyPassphrase: "",
  note: "",
};

function toForm(credential: Credential): CredentialInput {
  return {
    name: credential.name,
    type: credential.type,
    username: credential.username ?? "",
    password: credential.password ?? "",
    privateKeyPath: credential.privateKeyPath ?? "",
    privateKey: credential.privateKey ?? "",
    privateKeyPassphrase: credential.privateKeyPassphrase ?? "",
    note: credential.note ?? "",
  };
}

function getCredentialSubtitle(credential: Credential) {
  if (credential.type === "ssh-key") {
    return credential.privateKeyPath || "SSH 私钥";
  }
  return credential.username || "密码凭据";
}

function CredentialFormField({
  label,
  required,
  description,
  align = "center",
  children,
}: {
  label: string;
  required?: boolean;
  description?: string;
  align?: "center" | "start";
  children: React.ReactNode;
}) {
  return (
    <div className={cn(
      "grid grid-cols-[120px_minmax(0,1fr)] gap-4 px-4 py-2.5",
      align === "center" ? "items-center" : "items-start",
    )}>
      <Label className={cn("text-sm text-right", align === "start" && "pt-2")}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <div className="space-y-1.5">
        {children}
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

export function CredentialSettings() {
  const {
    credentials,
    vault,
    addCredential,
    updateCredential,
    removeCredential,
    enableMasterPassword,
    changeMasterPassword,
    disableMasterPassword,
  } = useCredentialsStore();
  const [selectedId, setSelectedId] = useState<string | null>(credentials[0]?.id ?? null);
  const selectedCredential = useMemo(
    () => credentials.find((credential) => credential.id === selectedId) ?? null,
    [credentials, selectedId],
  );
  const [form, setForm] = useState<CredentialInput>(() => selectedCredential ? toForm(selectedCredential) : EMPTY_FORM);
  const [masterPassword, setMasterPassword] = useState("");
  const [masterPasswordConfirm, setMasterPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const canSave = form.name.trim().length > 0
    && (form.type !== "ssh-key" || Boolean(form.privateKeyPath?.trim() || form.privateKey?.trim()));

  const selectCredential = (credential: Credential) => {
    setSelectedId(credential.id);
    setForm(toForm(credential));
  };

  const startCreate = () => {
    setSelectedId(null);
    setForm(EMPTY_FORM);
  };

  const setField = <K extends keyof CredentialInput>(key: K, value: CredentialInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSelectPrivateKey = async () => {
    try {
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        title: "选择私钥文件",
        filters: [{ name: "All Files", extensions: ["*"] }],
      });
      if (selected && typeof selected === "string") {
        setField("privateKeyPath", selected);
      }
    } catch (error) {
      logger.error("FE/settings/credentials", "选择私钥文件失败", { error });
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setMessage(null);
    try {
      if (selectedId) {
        await updateCredential(selectedId, form);
        setMessage({ type: "success", text: "凭据已加密保存" });
        return;
      }

      const id = await addCredential(form);
      setSelectedId(id);
      setMessage({ type: "success", text: "凭据已加密保存" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await removeCredential(selectedId);
      const next = credentials.find((credential) => credential.id !== selectedId) ?? null;
      setSelectedId(next?.id ?? null);
      setForm(next ? toForm(next) : EMPTY_FORM);
      setMessage({ type: "success", text: "凭据已删除" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleMasterPassword = async () => {
    if (!masterPassword || masterPassword !== masterPasswordConfirm) {
      setMessage({ type: "error", text: "两次输入的主密码不一致" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (vault?.mode === "master") {
        await changeMasterPassword(masterPassword);
        setMessage({ type: "success", text: "主密码已修改，全部凭据已重新加密" });
      } else {
        await enableMasterPassword(masterPassword);
        setMessage({ type: "success", text: "主密码保护已启用" });
      }
      setMasterPassword("");
      setMasterPasswordConfirm("");
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const handleDisableMasterPassword = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await disableMasterPassword();
      setMessage({ type: "success", text: "已切换到默认无感加密模式" });
      setMasterPassword("");
      setMasterPasswordConfirm("");
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">凭据列表</Label>
          <Button variant="outline" size="sm" className="h-8 px-2" onClick={startCreate}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
          {credentials.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无保存的凭据</div>
          )}
          {credentials.map((credential) => (
            <button
              key={credential.id}
              type="button"
              onClick={() => selectCredential(credential)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-border/30 px-3 py-2.5 text-left last:border-b-0",
                selectedId === credential.id ? "bg-accent/70" : "hover:bg-accent/40",
              )}
            >
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{credential.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{getCredentialSubtitle(credential)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">
            {selectedId ? "编辑凭据" : "新增凭据"}
          </Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            <CredentialFormField label="名称" required>
              <Input value={form.name} onChange={(event) => setField("name", event.target.value)} placeholder="请输入凭据名称" />
            </CredentialFormField>
            <CredentialFormField label="类型" required>
              <Select value={form.type} onValueChange={(value) => setField("type", value as CredentialType)}>
                <SelectTrigger className="bg-background/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">密码</SelectItem>
                  <SelectItem value="ssh-key">SSH 私钥</SelectItem>
                </SelectContent>
              </Select>
            </CredentialFormField>
            <CredentialFormField label="用户名" description="用于自动填充连接用户名">
              <Input value={form.username ?? ""} onChange={(event) => setField("username", event.target.value)} />
            </CredentialFormField>

            {form.type === "password" ? (
              <CredentialFormField label="密码">
                <Input type="password" value={form.password ?? ""} onChange={(event) => setField("password", event.target.value)} autoComplete="off" />
              </CredentialFormField>
            ) : (
              <>
                <CredentialFormField label="私钥路径">
                  <div className="flex items-center gap-2">
                    <Input value={form.privateKeyPath ?? ""} onChange={(event) => setField("privateKeyPath", event.target.value)} placeholder="选择或输入私钥路径" />
                    <Button type="button" variant="outline" size="sm" onClick={handleSelectPrivateKey}>
                      浏览
                    </Button>
                  </div>
                </CredentialFormField>
                <CredentialFormField label="私钥内容" align="start" description="路径和内容至少填写一个">
                  <Textarea value={form.privateKey ?? ""} onChange={(event) => setField("privateKey", event.target.value)} placeholder="粘贴 OpenSSH 私钥内容" className="min-h-32 font-mono text-xs" />
                </CredentialFormField>
                <CredentialFormField label="私钥密码">
                  <Input type="password" value={form.privateKeyPassphrase ?? ""} onChange={(event) => setField("privateKeyPassphrase", event.target.value)} autoComplete="off" />
                </CredentialFormField>
              </>
            )}

            <CredentialFormField label="备注" align="start">
              <Textarea value={form.note ?? ""} onChange={(event) => setField("note", event.target.value)} className="min-h-20" />
            </CredentialFormField>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {selectedId && (
            <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => void handleDelete()} disabled={busy}>
              <Trash2 className="h-4 w-4 mr-2" />
              删除
            </Button>
          )}
          <Button onClick={() => void handleSave()} disabled={!canSave || busy}>
            <Save className="h-4 w-4 mr-2" />
            保存
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-3 mb-1">
            凭据保护
          </Label>
          <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden divide-y divide-border/30">
            <div className="flex items-start gap-3 px-4 py-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-medium">
                  {vault?.mode === "master" ? "主密码加密" : "默认无感加密"}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {vault?.mode === "master"
                    ? "凭据可随 Git 和备份迁移；新设备或重启后输入主密码解锁。"
                    : "凭据以密文随 Git 和备份迁移，无需额外输入；该模式用于避免配置被直接查看。"}
                </p>
              </div>
            </div>
            <CredentialFormField label={vault?.mode === "master" ? "新主密码" : "主密码"}>
              <Input
                type="password"
                value={masterPassword}
                onChange={(event) => setMasterPassword(event.target.value)}
                autoComplete="new-password"
              />
            </CredentialFormField>
            <CredentialFormField label="确认主密码">
              <Input
                type="password"
                value={masterPasswordConfirm}
                onChange={(event) => setMasterPasswordConfirm(event.target.value)}
                autoComplete="new-password"
              />
            </CredentialFormField>
            <div className="flex justify-end gap-2 px-4 py-3">
              {vault?.mode === "master" && (
                <Button variant="outline" onClick={() => void handleDisableMasterPassword()} disabled={busy}>
                  关闭主密码
                </Button>
              )}
              <Button onClick={() => void handleMasterPassword()} disabled={!masterPassword || !masterPasswordConfirm || busy}>
                {vault?.mode === "master" ? "修改主密码" : "启用主密码"}
              </Button>
            </div>
          </div>
        </div>

        {message && (
          <div className={cn(
            "rounded-xl border px-4 py-3 text-sm",
            message.type === "error"
              ? "border-destructive/20 bg-destructive/8 text-destructive"
              : "border-border/40 bg-muted/20 text-foreground",
          )}>
            {message.text}
          </div>
        )}

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-xs text-muted-foreground">
          默认模式参考 Xshell 的无感加密思路，重点是避免配置文件直接暴露明文；需要更强保护时请启用主密码。
        </div>
      </div>
    </div>
  );
}
