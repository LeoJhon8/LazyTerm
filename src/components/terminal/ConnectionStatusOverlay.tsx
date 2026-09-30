import { HoverTooltip } from "@/components/ui/tooltip";
import { LoaderCircle, CircleAlert, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";
import type { SessionConnectionStatus } from "@/types/terminal";

export interface ConnectionStatusOverlayProps {
  status: SessionConnectionStatus;
  protocol: string;
  target: string;
  details?: Array<{ label: string; value: string }>;
  description?: string;
  onReconnect?: () => void;
  zIndexClass?: string;
}

export function ConnectionStatusOverlay({
  status,
  protocol,
  target,
  details = [],
  description,
  onReconnect,
  zIndexClass = "z-30",
}: ConnectionStatusOverlayProps) {
  const { t } = useI18n();
  if (status.phase === "disconnected" && status.disconnectCause === "tmux-ended") {
    return (
      <div className={`absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background px-4 py-3 ${zIndexClass}`}>
        <div role="status" className="min-w-0 text-sm">
          <div className="font-medium">{t("远端后台会话已结束")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("后台模式已关闭。重新连接将打开普通 SSH 会话。")}
          </div>
        </div>
        {onReconnect && (
          <Button size="sm" variant="outline" onClick={onReconnect}>
            <RefreshCcw className="h-4 w-4" />
            {t("重新连接")}
          </Button>
        )}
      </div>
    );
  }
  const isConnecting = status.phase === "connecting"
    || status.phase === "authenticating"
    || status.phase === "reconnecting";
  const isFailurePhase = status.phase === "failed" || status.phase === "disconnected";
  const isTerminalFailure = isFailurePhase && status.terminal === true;
  const isRecovering = isConnecting || (isFailurePhase && !isTerminalFailure);

  if (!isRecovering && !isTerminalFailure) {
    return null;
  }

  const phaseText = status.phase === "reconnecting" && status.retryPending
    ? t("等待自动重试...")
    : status.phase === "authenticating"
    ? t("正在验证凭据...")
    : status.phase === "reconnecting" || (isFailurePhase && !isTerminalFailure)
      ? t("正在重新连接...")
      : t("正在建立连接...");

  if (isRecovering) {
    return (
      <div className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm ${zIndexClass}`}>
        <div className="floating-surface flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-border/60 px-5 py-3">
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <div className="min-w-0">
            <div className="text-sm font-medium">{phaseText}</div>
            <div className="mt-0.5 max-w-80 truncate text-xs text-muted-foreground">
              {protocol} · {target}
              {(status.phase === "reconnecting" || isFailurePhase) && status.retryAttempt !== undefined && status.retryAttempt > 0
                ? ` · ${t("第 {count} 次自动重试", { count: status.retryAttempt })}`
                : ""}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const title = status.phase === "failed" ? t("连接失败") : t("连接断开");
  const fallbackDescription = status.phase === "failed"
      ? t("连接失败，请检查主机、凭据或网络。")
    : t("与远程主机的连接已终止。");
  const diagnosticDetails = [
    { label: t("目标地址"), value: target },
    ...(status.failure ? [
      { label: t("错误代码"), value: status.failure.code },
      { label: t("连接阶段"), value: status.failure.stage },
    ] : []),
    ...details,
  ];

  return (
    <div
      className={`pointer-events-auto absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-md ${zIndexClass}`}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <div className="floating-surface flex max-h-[calc(100%-2rem)] w-[460px] max-w-[calc(100%_-_2rem)] flex-col overflow-y-auto rounded-xl border border-border/60">
        <div className="flex items-center justify-between border-b border-border/50 bg-muted/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <CircleAlert className="h-5 w-5 shrink-0 text-destructive" />
            <span className="font-semibold text-foreground/90">{title}</span>
          </div>
          <span className="rounded-md border border-border/50 bg-background/50 px-2.5 py-1 text-xs font-semibold text-muted-foreground shadow-sm">
            {protocol}
          </span>
        </div>

        <div className="flex flex-col px-6 py-5">
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
            {status.reason || description || fallbackDescription}
          </p>

          <div className="mb-5 grid grid-cols-2 gap-y-4 rounded-xl border border-border/40 bg-muted/20 p-4">
            {diagnosticDetails.map((detail) => (
              <div key={detail.label} className="flex flex-col gap-1.5 overflow-hidden pr-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {detail.label}
                </span>
                <HoverTooltip content={detail.value}>
                  <span className="truncate text-sm font-medium text-foreground/90">
                    {detail.value || "-"}
                  </span>
                </HoverTooltip>
              </div>
            ))}
          </div>

          {status.technicalDetails && (
            <details className="mb-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground/80">{t("技术详情")}</summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono">
                {status.technicalDetails}
              </pre>
            </details>
          )}

          {onReconnect && (
            <div className="mt-4 flex justify-center">
              <Button
                onClick={onReconnect}
                size="sm"
                className="h-9 w-40 rounded-xl text-sm font-medium"
              >
                <RefreshCcw className="h-4 w-4" />
                {t("重新连接")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
