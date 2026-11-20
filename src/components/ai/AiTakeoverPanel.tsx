import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n";
import { useTabsStore } from "@/store/tabs";
import { useAiConfigStore } from "@/store/ai";
import { approveAiTakeoverCommand, isTakeoverRunning, startAiTakeover, stopAiTakeover, useAiTakeoverStore, type AiShell, type AiTakeoverPermission, type CommandTiming } from "@/services/aiTakeoverService";

function formatElapsedTime(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return [hours, minutes, seconds % 60].map((unit) => String(unit).padStart(2, "0")).join(":");
}

function CommandTimers({ timing }: { timing: CommandTiming }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <dl className="mb-2 grid grid-cols-2 gap-2 text-xs">
      <div>
        <dt className="text-muted-foreground">{t("命令运行时长")}</dt>
        <dd className="tabular-nums">{timing.startedAt === null
          ? t("等待启动确认")
          : formatElapsedTime(now - timing.startedAt)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t("无新输出时长")}</dt>
        <dd className="tabular-nums">{formatElapsedTime(now - timing.lastOutputAt)}</dd>
      </div>
    </dl>
  );
}

function CommandOutput({ output }: { output: string }) {
  const { t } = useI18n();
  if (!output) return null;
  return (
    <details>
      <summary className="cursor-pointer text-muted-foreground">{t("命令输出")}</summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2">{output}</pre>
    </details>
  );
}

export function AiTakeoverPanel() {
  const { t } = useI18n();
  const sessions = useTabsStore((state) => state.sessions);
  const [sessionId, setSessionId] = useState(() => useTabsStore.getState().focusSessionId ?? "");
  const [goal, setGoal] = useState("");
  const [shell, setShell] = useState<AiShell>("posix");
  const [permission, setPermission] = useState<AiTakeoverPermission>("read-only-auto");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const run = useAiTakeoverStore();
  const busy = isTakeoverRunning(run.status);
  const latestStep = run.steps.at(-1);
  const hasPendingCommand = Boolean(run.pending);
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [busy, hasPendingCommand]);
  const available = sessions.filter((session) => (session.type === "ssh" || session.type === "local") && session.connector?.isConnected);
  const target = available.find((session) => session.id === sessionId);
  const activeName = useAiConfigStore((state) => state.profiles.find((profile) => profile.id === state.activeProfileId)?.name ?? state.model);
  const permissionLabels = {
    "confirm-all": t("逐条确认"),
    "read-only-auto": t("只读自动"),
    "full-access": t("完全接管"),
  };
  const permissionDescriptions = {
    "confirm-all": t("AI 每次执行命令前都需要你确认。"),
    "read-only-auto": t("常见只读命令自动执行，其余命令需要你确认。"),
    "full-access": t("AI 可直接执行目标所需的命令，包括修改、删除文件和变更服务，无需逐条确认。"),
  };
  const statuses = {
    idle: t("等待接管"), thinking: t("正在规划下一步"), approval: t("等待执行确认"),
    executing: t("正在执行命令"), complete: t("目标已完成"), stopped: t("接管已停止"), failed: t("接管失败"),
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={contentRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        <div className="space-y-2 p-2.5 text-xs">
          {run.status !== "idle" && (
            <div className="space-y-1 rounded-lg border p-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2" role="status">
                <p className="font-medium">{statuses[run.status]}</p>
                <p className="text-muted-foreground">{t("累计执行 {count} 步", { count: run.stepCount })}</p>
              </div>
              <p className="break-words text-muted-foreground">{run.sessionTitle} · {permissionLabels[run.permission]}</p>
              {run.status === "executing" && run.commandActivity && (
                <p className="text-muted-foreground">{run.commandActivity === "quiet"
                  ? t("命令已启动，超过 5 分钟未检测到输出变化。命令可能仍在运行。")
                  : t("超过 5 分钟未确认命令已启动，请检查终端。")}</p>
              )}
              {run.message && <p className="whitespace-pre-wrap break-words">{run.message}</p>}
              <details>
                <summary className="cursor-pointer text-muted-foreground">{t("接管目标")}</summary>
                <p className="mt-1 whitespace-pre-wrap break-words">{run.goal}</p>
                {run.profileName && <p className="break-words text-muted-foreground">{run.profileName}</p>}
              </details>
            </div>
          )}
          {run.pending && (
            <div className="space-y-1.5 rounded-lg border border-primary/50 p-2">
              <p className="font-medium">{t("确认后执行以下命令")}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2">{run.pending.command}</pre>
              <p className="break-words">{run.pending.explanation}</p>
              {run.pending.risk === "destructive" && <p className="text-destructive">{t("此命令可能删除、覆盖数据或中断服务。")}</p>}
            </div>
          )}
          {latestStep && (
            <div key={latestStep.number} className="space-y-1.5 rounded-lg border p-2">
              <p className="font-medium">{t(run.status === "executing" ? "当前命令" : "最近执行的命令")}</p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2">{latestStep.command}</pre>
              <p className="break-words text-muted-foreground">{latestStep.explanation}</p>
              {latestStep.exitCode !== undefined && <p className="text-muted-foreground">{t("退出码：{code}", { code: latestStep.exitCode })}</p>}
              <CommandOutput output={latestStep.output} />
            </div>
          )}
          {run.steps.length > 1 && (
            <details className="rounded-lg border p-2">
              <summary className="cursor-pointer font-medium">{t("执行记录")}</summary>
              {run.stepCount > run.steps.length && <p className="mt-1 text-muted-foreground">{t("仅保留最近 100 步执行记录。")}</p>}
              {run.steps.slice(0, -1).reverse().map((step) => (
                <details key={step.number} className="mt-2 border-t pt-2">
                  <summary className="cursor-pointer break-words">{step.number}. {step.explanation}</summary>
                  <pre className="my-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2">{step.command}</pre>
                  {step.exitCode !== undefined && <p className="text-muted-foreground">{t("退出码：{code}", { code: step.exitCode })}</p>}
                  <CommandOutput output={step.output} />
                </details>
              ))}
            </details>
          )}
          {!busy && (
            <div className="space-y-2">
              <Select value={target ? sessionId : ""} onValueChange={setSessionId}>
                <SelectTrigger className="h-8 min-w-0 text-xs" aria-label={t("接管会话")}>
                  <SelectValue placeholder={t("选择终端会话")} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((session) => <SelectItem key={session.id} value={session.id}>{session.title} · {session.type}</SelectItem>)}
                </SelectContent>
              </Select>
              {available.length === 0 && <p className="text-muted-foreground">{t("请选择已连接的 SSH 或本地终端会话。")}</p>}
              <Textarea aria-label={t("接管目标")} placeholder={t("接管目标")}
                value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={8000} className="min-h-16 text-xs" />
              <Select value={permission} onValueChange={(value) => setPermission(value as AiTakeoverPermission)}>
                <SelectTrigger className="h-8 min-w-0 text-xs" aria-label={t("执行权限")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirm-all">{permissionLabels["confirm-all"]}</SelectItem>
                  <SelectItem value="read-only-auto">{permissionLabels["read-only-auto"]}</SelectItem>
                  <SelectItem value="full-access">{permissionLabels["full-access"]}</SelectItem>
                </SelectContent>
              </Select>
              <details className="space-y-2 rounded-lg border p-2">
                <summary className="cursor-pointer font-medium">{t("Shell 和运行规则")} · {shell === "posix" ? "POSIX" : "PowerShell"}</summary>
                <Select value={shell} onValueChange={(value) => setShell(value as AiShell)}>
                  <SelectTrigger className="h-8 min-w-0 text-xs" aria-label={t("目标会话的 Shell")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="posix">POSIX (sh / bash / zsh)</SelectItem>
                    <SelectItem value="powershell">PowerShell</SelectItem>
                  </SelectContent>
                </Select>
                <div className="space-y-1 text-muted-foreground">
                  <p>{t("请选择终端当前使用的 Shell；暂不支持 CMD、fish 和交互程序。")}</p>
                  <p>{permission === "full-access"
                    ? t("不限制总步数，持续推进至目标完成；检测到重复循环或连续失败时自动停止。")
                    : t("最多执行 20 步。")} {permission === "full-access"
                    ? t("连续 5 分钟没有输出变化时会显示提示，并继续等待。")
                    : t("每条命令最多等待 2 分钟。")}</p>
                  <p>{t("可随时停止接管，手动输入也会停止接管。")}</p>
                  {target?.connector?.isTmuxPersistenceActive?.() && (
                    <p>{t("tmux 接管固定使用启动时的窗格，切换窗格或窗口会停止接管。请保持该窗格处于 Shell 提示符。")}</p>
                  )}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t p-2.5">
        {run.permission === "full-access" && run.status === "executing" && run.commandTiming && (
          <CommandTimers timing={run.commandTiming} />
        )}
        {run.pending ? (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="flex-1" onClick={() => approveAiTakeoverCommand(true)}>{t("允许本次执行")}</Button>
            <Button size="sm" className="flex-1" variant="outline" onClick={() => approveAiTakeoverCommand(false)}>{t("拒绝并停止")}</Button>
          </div>
        ) : busy ? (
          <Button size="sm" className="w-full" variant="destructive" onClick={stopAiTakeover}><Square />{t("停止接管")}</Button>
        ) : (
          <Button size="sm" className="w-full" disabled={!target || !goal.trim()} onClick={() => setConfirmOpen(true)}><Play />{t("开始接管")}</Button>
        )}
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("开始接管此会话？")}</AlertDialogTitle>
            <AlertDialogDescription>{t("请确认终端停在空白 Shell 提示符，没有正在运行的命令。最近终端内容和执行结果将发送给所选 AI 接口。")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 break-words text-sm">
            <p>{target?.title} · {shell} · {activeName}</p>
            <p>{t("执行权限")}：{permissionLabels[permission]}</p>
            <p className="text-muted-foreground">{permissionDescriptions[permission]}</p>
            <p className="whitespace-pre-wrap">{goal}</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction disabled={!target || busy} onClick={() => void startAiTakeover(sessionId, goal, shell, permission)}>{t("确认开始")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
