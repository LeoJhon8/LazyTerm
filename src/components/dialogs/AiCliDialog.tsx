import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/dialogs/connection-forms";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { AiCliConfig } from "@/types/terminal";

interface AiCliDialogProps {
  open: boolean;
  onOpenChange: () => void;
  initialConfig?: AiCliConfig;
  isDirect?: boolean;
  onSave: (config: AiCliConfig) => void;
}

export function AiCliDialog({
  open,
  onOpenChange,
  initialConfig,
  onSave,
}: AiCliDialogProps) {
  const { t } = useI18n();
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [nickname, setNickname] = useState("");

  // 当对话框打开或 initialConfig 变化时，重置表单
  useEffect(() => {
    if (open) {
      setCommand(initialConfig?.command || "");
      setArgs(initialConfig?.args?.join(", ") || "");
      setCwd(initialConfig?.cwd || "");
      setNickname(initialConfig?.nickname || "");
    }
  }, [open, initialConfig]);

  // 选择工作目录
  const handleSelectCwd = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("选择工作目录"),
      });
      if (selected && typeof selected === "string") {
        setCwd(selected);
      }
    } catch (error) {
      console.error("选择目录失败", error);
    }
  };

  const handleSave = () => {
    if (!command.trim()) {
      return; // 命令不能为空
    }

    const config: AiCliConfig = {
      command: command.trim(),
      nickname: nickname.trim() || undefined,
    };

    // 解析参数（逗号分隔）
    if (args.trim()) {
      config.args = args.split(",").map(arg => arg.trim()).filter(Boolean);
    }

    // 工作目录（可选）
    if (cwd.trim()) {
      config.cwd = cwd.trim();
    }

    onSave(config);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onOpenChange();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>
            {initialConfig ? t("编辑 AI CLI") : t("新建 AI CLI 连接")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <FormField label={t("名称")} htmlFor="ai-cli-nickname">
            <Input
              id="ai-cli-nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </FormField>

          <FormField label={t("命令")} htmlFor="ai-cli-command" required>
            <Input
              id="ai-cli-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t("请输入命令")}
            />
          </FormField>

          <FormField label={t("参数")} htmlFor="ai-cli-args">
            <Input
              id="ai-cli-args"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={t("请输入参数")}
            />
          </FormField>

          <FormField label={t("工作目录")} htmlFor="ai-cli-cwd">
            <div className="flex gap-2">
              <Input
                id="ai-cli-cwd"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0"
                onClick={handleSelectCwd}
              >
                {t("浏览")}
              </Button>
            </div>
          </FormField>
        </div>

        <DialogFooter className="border-t border-border/50 pt-4">
          <Button type="button" variant="outline" onClick={onOpenChange}>
            {t("取消")}
          </Button>
          <Button onClick={handleSave} disabled={!command.trim()}>
            {t("确定")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
