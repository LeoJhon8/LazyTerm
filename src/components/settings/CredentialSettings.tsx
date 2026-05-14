import { useMemo, useState } from "react";
import { KeyRound, Plus, Save, Trash2 } from "lucide-react";
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
  const { credentials, addCredential, updateCredential, removeCredential } = useCredentialsStore();
  const [selectedId, setSelectedId] = useState<string | null>(credentials[0]?.id ?? null);
  const selectedCredential = useMemo(
    () => credentials.find((credential) => credential.id === selectedId) ?? null,
    [credentials, selectedId],
  );
  const [form, setForm] = useState<CredentialInput>(() => selectedCredential ? toForm(selectedCredential) : EMPTY_FORM);
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

  const handleSave = () => {
    if (!canSave) return;
    if (selectedId) {
      updateCredential(selectedId, form);
      return;
    }

    const id = addCredential(form);
    setSelectedId(id);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    removeCredential(selectedId);
    const next = credentials.find((credential) => credential.id !== selectedId) ?? null;
    setSelectedId(next?.id ?? null);
    setForm(next ? toForm(next) : EMPTY_FORM);
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
            <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              删除
            </Button>
          )}
          <Button onClick={handleSave} disabled={!canSave}>
            <Save className="h-4 w-4 mr-2" />
            保存
          </Button>
        </div>

        <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-xs text-muted-foreground">
          当前凭据保存在本机独立存储中，不会写入现有 Git 同步配置。后续可以再接入系统凭据库来进一步增强安全性。
        </div>
      </div>
    </div>
  );
}
