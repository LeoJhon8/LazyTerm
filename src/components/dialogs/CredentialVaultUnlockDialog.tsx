import { useState } from "react";
import { KeyRound } from "lucide-react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCredentialsStore } from "@/store/credentials";

export function CredentialVaultUnlockDialog() {
  const { status, error: vaultError, unlock, clearVault } = useCredentialsStore();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleUnlock = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      setPassword("");
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : String(unlockError));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("确定清空全部已保存凭据吗？连接配置不会被删除，此操作不可恢复。")) return;
    setBusy(true);
    try {
      await clearVault();
      setPassword("");
      setError(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={status === "locked" || status === "error"}>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <AlertDialogTitle>{status === "error" ? "凭据保险库无法读取" : "解锁凭据保险库"}</AlertDialogTitle>
          <AlertDialogDescription>
            {status === "error"
              ? `保险库数据可能已损坏：${vaultError ?? "未知错误"}`
              : "输入主密码后，本次运行期间可直接使用和编辑已保存凭据。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleUnlock();
          }}
          className="space-y-3"
        >
          {status === "locked" && (
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="主密码"
              autoFocus
              autoComplete="current-password"
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
        <AlertDialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => void handleReset()} disabled={busy}>
            忘记密码并清空凭据
          </Button>
          {status === "locked" && (
            <Button type="button" onClick={() => void handleUnlock()} disabled={!password || busy}>
              {busy ? "正在解锁..." : "解锁"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
