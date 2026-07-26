import { useEffect, useState } from "react";
import { LayoutTemplate } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { useI18n } from "@/i18n";
import {
  captureWorkspaceTemplate,
  WorkspaceTemplateError,
} from "@/lib/workspace-template";
import { useSshProfilesStore } from "@/store/ssh-profiles";

interface WorkspaceTemplateDialogProps {
  open: boolean;
  workspaceId: string | null;
  onOpenChange: (open: boolean) => void;
}

function getTemplateErrorMessage(
  error: unknown,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (error instanceof WorkspaceTemplateError) {
    switch (error.code) {
      case "workspace-not-split":
        return t("只有已分屏的标签页才能创建工作区。");
      case "credential-vault-unavailable":
        return t("无法保存快速连接凭据，请先解锁凭据保险库。");
      case "workspace-not-found":
      case "session-not-found":
      case "invalid-template":
        return t("工作区数据不完整，无法保存。");
    }
  }
  return t("工作区操作失败。");
}

export function WorkspaceTemplateDialog({
  open,
  workspaceId,
  onOpenChange,
}: WorkspaceTemplateDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [includeStartupCommands, setIncludeStartupCommands] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName("");
    setIncludeStartupCommands(true);
    setSaving(false);
  }, [open]);

  const handleSave = async () => {
    if (!workspaceId || !name.trim() || saving) return;
    setSaving(true);
    try {
      const template = await captureWorkspaceTemplate(workspaceId, {
        includeStartupCommands,
      });
      const profilesStore = useSshProfilesStore.getState();
      profilesStore.ensureRoot();
      const rootId = useSshProfilesStore.getState().nodes.find(
        (node) => node.isRoot || node.parentId === null,
      )?.id ?? "root-folder";
      useSshProfilesStore.getState().addWorkspaceTemplate(
        name,
        template,
        rootId,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(getTemplateErrorMessage(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4 text-cyan-500" />
            {t("保存工作区")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <Label
              htmlFor="workspace-template-name"
              className="shrink-0"
            >
              {t("工作区名称")}
            </Label>
            <Input
              id="workspace-template-name"
              autoFocus
              className="min-w-0 flex-1"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleSave();
                }
              }}
            />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="workspace-template-startup-commands"
              checked={includeStartupCommands}
              onCheckedChange={(checked) => setIncludeStartupCommands(checked === true)}
            />
            <div className="grid gap-0.5">
              <Label
                htmlFor="workspace-template-startup-commands"
                className="text-xs"
              >
                {t("包含启动命令")}
              </Label>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t("默认不保存启动命令。")}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/25 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            {t("快速连接的临时凭据将保存到保险库。")}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t("取消")}
          </Button>
          <Button
            disabled={!workspaceId || !name.trim() || saving}
            onClick={() => void handleSave()}
          >
            {saving ? t("保存中...") : t("保存工作区")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
