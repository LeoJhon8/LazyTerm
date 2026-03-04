import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import type { SSHConfig, SSHAuthType } from "@/types/terminal";

interface SshConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnect: (config: SSHConfig) => void;
}

export function SshConnectDialog({ open, onOpenChange, onConnect }: SshConnectDialogProps) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [authType, setAuthType] = useState<SSHAuthType>("password");
  const [nickname, setNickname] = useState("");

  const handleConnect = () => {
    if (!host || !port || !username) {
      return;
    }

    const config: SSHConfig = {
      host,
      port: parseInt(port, 10),
      username,
      authType,
      nickname: nickname || undefined,
      keepAlive: true,
      keepAliveInterval: 60,
      readyTimeout: 30000,
    };

    if (authType === "password") {
      config.password = password;
    } else {
      config.privateKeyPath = privateKeyPath;
    }

    onConnect(config);
    // 重置表单
    resetForm();
  };

  const resetForm = () => {
    setHost("");
    setPort("22");
    setUsername("");
    setPassword("");
    setPrivateKeyPath("");
    setNickname("");
    setAuthType("password");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleConnect();
  };

  const isFormValid = host && port && username && 
    (authType === "password" ? password : privateKeyPath);

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      onOpenChange(newOpen);
      if (!newOpen) {
        resetForm();
      }
    }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>新建 SSH 连接</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            {/* 基本信息 */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-host" className="text-right">
                主机地址
              </Label>
              <Input
                id="ssh-host"
                placeholder="example.com 或 192.168.1.100"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="col-span-3"
                required
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-port" className="text-right">
                端口
              </Label>
              <Input
                id="ssh-port"
                type="number"
                placeholder="22"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="col-span-3"
                min="1"
                max="65535"
                required
              />
            </div>

            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-username" className="text-right">
                用户名
              </Label>
              <Input
                id="ssh-username"
                placeholder="root"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="col-span-3"
                required
              />
            </div>

            <Separator />

            {/* 认证方式 */}
            <div className="grid gap-2">
              <Label>认证方式</Label>
              <Tabs value={authType} onValueChange={(v) => setAuthType(v as SSHAuthType)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="password">密码认证</TabsTrigger>
                  <TabsTrigger value="privateKey">密钥认证</TabsTrigger>
                </TabsList>
                
                <TabsContent value="password" className="mt-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="ssh-password" className="text-right">
                      密码
                    </Label>
                    <Input
                      id="ssh-password"
                      type="password"
                      placeholder="请输入密码"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="col-span-3"
                      autoComplete="off"
                    />
                  </div>
                </TabsContent>
                
                <TabsContent value="privateKey" className="mt-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="ssh-key-path" className="text-right">
                      私钥路径
                    </Label>
                    <Input
                      id="ssh-key-path"
                      placeholder="~/.ssh/id_rsa"
                      value={privateKeyPath}
                      onChange={(e) => setPrivateKeyPath(e.target.value)}
                      className="col-span-3"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 ml-[25%]">
                    支持 RSA、ED25519 等格式的私钥文件
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            <Separator />

            {/* 可选配置 */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ssh-nickname" className="text-right">
                别名
              </Label>
              <Input
                id="ssh-nickname"
                placeholder="我的服务器"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>

          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button 
              type="submit" 
              disabled={!isFormValid}
            >
              连接
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
