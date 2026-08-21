import { useState, useEffect } from "react";
import { logger } from "@/lib/logger";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/dialogs/connection-forms";

import type { SSHConfig } from "@/types/terminal";
// 修复命名冲突：使用别名 openFileDialog
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { useI18n } from "@/i18n";

interface SshConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: SSHConfig) => void;
  initialConfig?: SSHConfig;
  isDirect?: boolean;
}

export function SshConnectDialog({ open, onOpenChange, onSave, initialConfig, isDirect }: SshConnectDialogProps) {
  const { t } = useI18n();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [nickname, setNickname] = useState("");
  const [startupCommand, setStartupCommand] = useState("");


  // 提取重置逻辑
  const resetForm = () => {
    setHost("");
    setPort("22");
    setUsername("");
    setPassword("");
    setPrivateKeyPath("");
    setNickname("");
    setStartupCommand("");

  };

  // 优化同步逻辑，解决 "cascading renders" 警告
  // 仅在对话框由关闭变为打开时，同步初始数据
  useEffect(() => {
    if (open) {
      const frame = window.requestAnimationFrame(() => {
        if (initialConfig) {
          setHost(initialConfig.host || "");
          setPort(initialConfig.port?.toString() || "22");
          setUsername(initialConfig.username || "");
          setPassword(initialConfig.password || "");
          setPrivateKeyPath(initialConfig.privateKeyPath || "");
          setNickname(initialConfig.nickname || "");
          setStartupCommand(initialConfig.startupCommand || "");

        } else {
          resetForm();
        }
      });

      return () => window.cancelAnimationFrame(frame);
    }
  }, [open, initialConfig]);

  const handleSave = () => {
    if (!host || !port || !username) return;
    const parsedPort = parseInt(port, 10);

    const cfg: SSHConfig = {
      host,
      port: parsedPort,
      username,
      credentialId: initialConfig?.credentialId,
      authType: privateKeyPath ? "privateKey" : "password",
      password: password || undefined,
      privateKeyPath: privateKeyPath || undefined,
      nickname: nickname || undefined,
      startupCommand: startupCommand.trim() ? startupCommand : undefined,
      keepAlive: parsedPort === 2222 ? undefined : true,
      keepAliveInterval: parsedPort === 2222 ? undefined : 60,
      readyTimeout: 30000,

    };

    onSave(cfg);
    onOpenChange(false); // 保存后关闭
  };

  const handleSelectKey = async () => {
    try {
      // 使用别名调用 Tauri API
      const selected = await openFileDialog({
        multiple: false,
        directory: false,
        title: t("选择私钥文件"),
        filters: [{ name: "All Files", extensions: ["*"] }],
      });

      if (selected && typeof selected === "string") {
        setPrivateKeyPath(selected);
      } else if (Array.isArray(selected) && selected.length > 0) {
        setPrivateKeyPath(selected[0]);
      }
    } catch (err) {
      logger.error("FE/dialog/ssh-connect", "Failed to select private key file", {err});
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>
            {isDirect ? t("发起临时 SSH 连接") : (initialConfig ? t("编辑 SSH 配置") : t("新建 SSH 配置"))}
          </DialogTitle>
        </DialogHeader>
        
        <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <div className="grid gap-4 py-2">
            <FormField label={t("名称")} htmlFor="ssh-nickname">
              <Input
                id="ssh-nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </FormField>
            
            <FormField label={t("主机地址")} htmlFor="ssh-host" required>
              <Input
                id="ssh-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
              />
            </FormField>

            <FormField label={t("端口")} htmlFor="ssh-port" required>
              <Input
                id="ssh-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </FormField>

            <FormField label={t("用户名")} htmlFor="ssh-username" required>
              <Input
                id="ssh-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </FormField>

            <FormField label={t("密码")} htmlFor="ssh-password">
              <Input
                id="ssh-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </FormField>

            <FormField label={t("私钥路径")} htmlFor="ssh-key-path">
              <div className="flex items-center gap-2">
                <Input
                  id="ssh-key-path"
                  value={privateKeyPath}
                  onChange={(e) => setPrivateKeyPath(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button" // 显式声明 type="button" 防止触发 form submit
                  variant="outline"
                  className="h-10 shrink-0"
                  onClick={handleSelectKey}
                >
                  {t("浏览")}
                </Button>
              </div>
            </FormField>

            <FormField
              label={t("启动命令")}
              htmlFor="ssh-startup-command"
              description={t("连接成功后自动执行，支持多行命令。")}
            >
              <Textarea
                id="ssh-startup-command"
                value={startupCommand}
                onChange={(event) => setStartupCommand(event.target.value)}
                placeholder={t("输入命令，支持换行")}
                rows={6}
                className="resize-y font-mono text-xs leading-5"
              />
            </FormField>

          </div>

          <DialogFooter className="border-t border-border/50 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("取消")}
            </Button>
            <Button type="submit">
              {initialConfig ? t("保存修改") : t("立即创建")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
