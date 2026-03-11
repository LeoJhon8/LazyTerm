import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { SSHConfig } from "@/types/terminal";
// 修复命名冲突：使用别名 openFileDialog
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';

interface SshConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (config: SSHConfig) => void;
  initialConfig?: SSHConfig;
  isDirect?: boolean;
}

export function SshConnectDialog({ open, onOpenChange, onSave, initialConfig, isDirect }: SshConnectDialogProps) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [nickname, setNickname] = useState("");

  // 提取重置逻辑
  const resetForm = () => {
    setHost("");
    setPort("22");
    setUsername("");
    setPassword("");
    setPrivateKeyPath("");
    setNickname("");
  };

  // 优化同步逻辑，解决 "cascading renders" 警告
  // 仅在对话框由关闭变为打开时，同步初始数据
  useEffect(() => {
    if (open) {
      if (initialConfig) {
        setHost(initialConfig.host || "");
        setPort(initialConfig.port?.toString() || "22");
        setUsername(initialConfig.username || "");
        setPassword(initialConfig.password || "");
        setPrivateKeyPath(initialConfig.privateKeyPath || "");
        setNickname(initialConfig.nickname || "");
      } else {
        resetForm();
      }
    }
  }, [open, initialConfig]);

  const handleSave = () => {
    if (!host || !port || !username) return;

    const cfg: SSHConfig = {
      host,
      port: parseInt(port, 10),
      username,
      authType: privateKeyPath ? "privateKey" : "password",
      password: password || undefined,
      privateKeyPath: privateKeyPath || undefined,
      nickname: nickname || undefined,
      keepAlive: true,
      keepAliveInterval: 60,
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
        title: "选择私钥文件",
        filters: [{ name: "All Files", extensions: ["*"] }],
      });

      if (selected && typeof selected === "string") {
        setPrivateKeyPath(selected);
      } else if (Array.isArray(selected) && selected.length > 0) {
        setPrivateKeyPath(selected[0]);
      }
    } catch (err) {
      console.error("选择私钥文件失败", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-125">
        <DialogHeader>
          <DialogTitle>
            {isDirect ? "发起临时 SSH 连接" : (initialConfig ? "编辑 SSH 配置" : "新建 SSH 配置")}
          </DialogTitle>
        </DialogHeader>
        
        <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-nickname" className="text-right">别名</Label>
              <Input
                id="ssh-nickname"
                placeholder="我的服务器"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="col-span-3"
              />
            </div>
            
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-host" className="text-right">主机地址</Label>
              <Input
                id="ssh-host"
                placeholder="192.168.1.100"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="col-span-3"
                required
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-port" className="text-right">端口</Label>
              <Input
                id="ssh-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="col-span-3"
                required
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-username" className="text-right">用户名</Label>
              <Input
                id="ssh-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="col-span-3"
                required
              />
            </div>

            <Separator />

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-password" className="text-right">密码</Label>
              <Input
                id="ssh-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="col-span-3"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-key-path" className="text-right">私钥路径</Label>
              <div className="col-span-3 flex items-center">
                <Input
                  id="ssh-key-path"
                  value={privateKeyPath}
                  onChange={(e) => setPrivateKeyPath(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button" // 显式声明 type="button" 防止触发 form submit
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  onClick={handleSelectKey}
                >
                  浏览
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">
              {initialConfig ? "保存修改" : "立即创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
