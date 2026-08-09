import { useEffect, useMemo, useState } from "react";
import { Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useCredentialsStore } from "@/store/credentials";
import { AI_MODULE_ID, isAiConfigured, useAiConfigStore } from "@/store/ai";
import { useSlotConfigStore } from "@/store/slot-config";

function SettingField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-4 px-4 py-3">
      <Label className="text-right text-sm">{label}</Label>
      <div className="space-y-1.5">
        {children}
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

export function AiSettings() {
  const { t } = useI18n();
  const configuredBaseUrl = useAiConfigStore((state) => state.baseUrl);
  const configuredModel = useAiConfigStore((state) => state.model);
  const configuredCredentialId = useAiConfigStore((state) => state.credentialId);
  const configuration = useMemo(() => ({
    baseUrl: configuredBaseUrl,
    model: configuredModel,
    credentialId: configuredCredentialId,
  }), [configuredBaseUrl, configuredCredentialId, configuredModel]);
  const saveConfiguration = useAiConfigStore((state) => state.saveConfiguration);
  const clearConfiguration = useAiConfigStore((state) => state.clearConfiguration);
  const credentials = useCredentialsStore((state) => state.credentials);
  const vaultStatus = useCredentialsStore((state) => state.status);
  const addCredential = useCredentialsStore((state) => state.addCredential);
  const updateCredential = useCredentialsStore((state) => state.updateCredential);
  const removeCredential = useCredentialsStore((state) => state.removeCredential);
  const [baseUrl, setBaseUrl] = useState(configuration.baseUrl);
  const [model, setModel] = useState(configuration.model);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const existingCredential = useMemo(
    () => credentials.find((credential) => credential.id === configuration.credentialId),
    [configuration.credentialId, credentials],
  );
  const configured = isAiConfigured(configuration);
  const canSave = Boolean(
    baseUrl.trim()
    && model.trim()
    && (apiKey || existingCredential?.apiKey)
    && vaultStatus === "unlocked",
  );

  useEffect(() => {
    setBaseUrl(configuration.baseUrl);
    setModel(configuration.model);
  }, [configuration.baseUrl, configuration.model]);

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setMessage(null);
    try {
      const parsedUrl = new URL(baseUrl.trim());
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error(t("API 服务地址仅支持 HTTP 或 HTTPS"));
      }

      let credentialId: string;
      if (existingCredential) {
        credentialId = existingCredential.id;
        await updateCredential(credentialId, {
          name: "LazyTerm AI API Key",
          type: "api-key",
          apiKey: apiKey || existingCredential.apiKey,
          note: "由 AI 设置管理",
        });
      } else {
        credentialId = await addCredential({
          name: "LazyTerm AI API Key",
          type: "api-key",
          apiKey,
          note: "由 AI 设置管理",
        });
      }

      saveConfiguration({ baseUrl, model, credentialId });
      setApiKey("");
      setMessage({ type: "success", text: t("AI 配置已保存，现在可以在布局管理中设置位置。") });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setMessage(null);
    const credentialId = configuration.credentialId;
    clearConfiguration();
    const slotStore = useSlotConfigStore.getState();
    slotStore.removeModuleFromSlot("left", AI_MODULE_ID);
    slotStore.removeModuleFromSlot("right", AI_MODULE_ID);
    setBaseUrl("");
    setModel("");
    setApiKey("");
    setClearConfirmOpen(false);

    try {
      if (credentialId && useCredentialsStore.getState().getCredential(credentialId)) {
        await removeCredential(credentialId);
      }
      setMessage({ type: "success", text: t("AI 配置已清除，对话内容仍会保留。") });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="space-y-2 px-1">
        <h3 className="text-base font-semibold">{t("AI 助手")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("配置一个 OpenAI 兼容接口，用于通用问答、搜索式查询和内容辅助。")}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t("接口配置")}
        </Label>
        <div className="divide-y divide-border/30 overflow-hidden rounded-xl border border-border/40 bg-muted/20">
          <SettingField
            label={t("API 服务地址")}
            description={t("填写服务根地址、/v1 地址，或完整的 /chat/completions 地址。")}
          >
            <Input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
              spellCheck={false}
            />
          </SettingField>
          <SettingField label={t("模型") }>
            <Input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="model-name"
              autoComplete="off"
              spellCheck={false}
            />
          </SettingField>
          <SettingField
            label="API Key"
            description={configured ? t("留空将继续使用已保存的 API Key。") : t("API Key 会加密保存在凭据保险库中。")}
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={configured ? t("已保存") : "sk-..."}
              autoComplete="new-password"
            />
          </SettingField>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="text-xs leading-5 text-muted-foreground">
          {vaultStatus === "unlocked"
            ? t("API Key 由凭据保险库加密保存，不会写入 AI 配置或对话记录。")
            : t("请先解锁凭据保险库，再保存 AI 配置。")}
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

      <div className="flex justify-end gap-2">
        {configured && (
          <Button
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setClearConfirmOpen(true)}
            disabled={busy}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t("清除配置")}
          </Button>
        )}
        <Button onClick={() => void handleSave()} disabled={!canSave || busy}>
          <Save className="mr-2 h-4 w-4" />
          {t("保存")}
        </Button>
      </div>

      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("清除 AI 配置？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("AI 模块会立即从侧栏和布局管理中移除，但当前对话会保留。")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive" onClick={() => void handleClear()}>
              {t("确认清除")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
