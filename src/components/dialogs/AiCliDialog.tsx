import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  isDirect = false,
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
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {initialConfig ? t("编辑 AI CLI") : t("新建 AI CLI 连接")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* 名称 */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="nickname" className="text-right">
              {t("名称")}
            </Label>
            <Input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t("可选，留空使用命令名")}
              className="col-span-3"
            />
          </div>

          {/* 命令 */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="command" className="text-right">
              {t("命令")}
            </Label>
            <Input
              id="command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t("例如: claude, openai, gemini")}
              className="col-span-3"
            />
          </div>

          {/* 参数 */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="args" className="text-right">
              {t("参数")}
            </Label>
            <Input
              id="args"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={t("逗号分隔，例如: --model gpt-4, --stream")}
              className="col-span-3"
            />
          </div>

          {/* 工作目录 */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="cwd" className="text-right">
              {t("工作目录")}
            </Label>
            <div className="col-span-3 flex gap-2">
              <Input
                id="cwd"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={t("可选，留空使用当前目录")}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSelectCwd}
              >
                {t("浏览")}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onOpenChange}>
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
