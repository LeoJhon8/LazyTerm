import { useEffect, useRef, useState, useCallback } from "react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import type { TerminalSession } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { LoaderCircle, RefreshCcw, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 视图基类 props
 */
export interface BaseSessionViewProps {
  /** 面板 ID */
  paneId: string;
  /** 会话 ID */
  sessionId: string;
  /** 视觉准备就绪回调 */
  onVisualReady?: (sessionId: string) => void;
}

/**
 * 连接状态
 */
export interface ConnectionState {
  connected: boolean;
  setConnected: (value: boolean) => void;
}

/**
 * 视图容器 ref
 */
export interface ViewContainerRef {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 基础会话视图 Hook 返回类型
 */
export interface BaseSessionViewResult extends ConnectionState, ViewContainerRef {
  /** 当前会话 */
  session: TerminalSession | undefined;
  /** 会话标题 */
  sessionTitle: string;
  /** 主动画帧请求 */
  requestAnimation: (callback: () => void) => void;
  /** 通知视觉就绪 */
  notifyVisualReady: () => void;
}

/**
 * 使用基础会话视图的自定义 Hook
 * 封装所有视图组件共用的逻辑
 */
export function useBaseSessionView(props: BaseSessionViewProps): BaseSessionViewResult {
  const { sessionId, onVisualReady } = props;
  const { sessions } = useTabsStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [connected, setConnected] = useState(true);
  const visualReadyNotifiedRef = useRef(false);

  const session = sessions.find((s) => s.id === sessionId);
  const sessionTitle = session?.title ?? "";

  /**
   * 请求动画帧的包装方法
   */
  const requestAnimation = useCallback((callback: () => void) => {
    requestAnimationFrame(() => {
      try {
        callback();
      } catch (error) {
        logger.warn("FE/base-session-view/animation", "Animation callback failed", { error });
      }
    });
  }, []);

  /**
   * 通知视觉就绪（只触发一次）
   */
  const notifyVisualReady = useCallback(() => {
    if (!visualReadyNotifiedRef.current) {
      visualReadyNotifiedRef.current = true;
      if (session && onVisualReady) {
        onVisualReady(session.id);
      }
    }
  }, [session, onVisualReady]);

  /**
   * 会话切换时重置视觉就绪状态
   */
  useEffect(() => {
    visualReadyNotifiedRef.current = false;
  }, [sessionId]);

  return {
    session,
    sessionTitle,
    connected,
    setConnected,
    containerRef,
    requestAnimation,
    notifyVisualReady,
  };
}

/**
 * 抽象基类 - SessionView
 * 定义视图组件的通用结构和模板方法
 * 
 * 子类必须实现：
 * 1. renderContent(): 渲染具体内容
 * 2. getViewType(): 返回视图类型标识
 */
export abstract class BaseSessionView {
  /**
   * 模板方法 - 渲染完整视图
   * 子类不应覆盖此方法，而应实现 renderContent
   */
  public render(props: BaseSessionViewProps): React.ReactElement | null {
    const baseResult = this.useBaseViewLogic(props);
    return this.renderWrapper(baseResult, props);
  }

  /**
   * 使用基础视图逻辑的 Hook（子类可覆盖以添加额外逻辑）
   */
  protected useBaseViewLogic(props: BaseSessionViewProps): BaseSessionViewResult {
    return useBaseSessionView(props);
  }

  /**
   * 渲染外层容器包装
   */
  protected renderWrapper(
    baseResult: BaseSessionViewResult,
    props: BaseSessionViewProps
  ): React.ReactElement | null {
    const { containerRef } = baseResult;
    
    return (
      <main
        ref={containerRef}
        className={this.getContainerClassName()}
        data-view-type={this.getViewType()}
        data-session-id={props.sessionId}
        data-pane-id={props.paneId}
      >
        {this.renderContent(baseResult, props)}
      </main>
    );
  }

  /**
   * 抽象方法 - 渲染内容区域
   * 子类必须实现此方法
   */
  protected abstract renderContent(
    baseResult: BaseSessionViewResult,
    props: BaseSessionViewProps
  ): React.ReactNode;

  /**
   * 抽象方法 - 获取视图类型标识
   * 子类必须实现此方法
   */
  protected abstract getViewType(): string;

  /**
   * 获取容器类名
   * 子类可覆盖以自定义样式
   */
  protected getContainerClassName(): string {
    return "terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden shadow-(--panel-shadow)";
  }
}

/**
 * 渲染状态徽章组件
 */
export function ConnectionStatusBadge({ 
  title, 
  connected, 
  extraInfo 
}: { 
  title: string; 
  connected: boolean; 
  extraInfo?: React.ReactNode;
}) {
  return (
    <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-white/80 backdrop-blur-md">
      <span
        className={connected ? "h-2 w-2 rounded-full bg-emerald-300" : "h-2 w-2 rounded-full bg-amber-300"}
        aria-hidden="true"
      />
      <span>{title}</span>
      {extraInfo}
    </div>
  );
}



/**
 * 图形化连接界面覆盖层
 * 统一 VNC 和 Windows 远程连接的等待、错误、断开界面
 */
export interface GraphicalSessionOverlayProps {
  mode: "connecting" | "failed" | "disconnected" | "none";
  titleText: string;
  description: string;
  onReconnect?: () => void;
  interactive?: boolean;
  zIndexClass?: string;
  protocol?: string;
  sessionConfigDetails?: Array<{ label: string; value: string }>;
}

export function GraphicalSessionOverlay({
  mode,
  titleText,
  description,
  onReconnect,
  interactive = false,
  zIndexClass = "z-20",
  protocol,
  sessionConfigDetails,
}: GraphicalSessionOverlayProps) {
  if (mode === "none") return null;

  const isFailed = mode === "failed";
  const isDisconnected = mode === "disconnected";
  const isConnecting = mode === "connecting";

  return (
    <div className={`absolute inset-0 flex items-center justify-center ${zIndexClass} ${interactive ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div className="flex w-[460px] flex-col overflow-hidden rounded-2xl border border-border/50 bg-background/60 shadow-2xl backdrop-blur-3xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 bg-muted/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <Monitor className="h-5 w-5 text-sky-500" />
            <span className="font-semibold text-foreground/90">{titleText}</span>
          </div>
          {protocol && (
            <span className="rounded-md border border-border/50 bg-background/50 px-2.5 py-1 text-xs font-semibold text-muted-foreground shadow-sm">
              {protocol}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col px-6 py-5">
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{description}</p>
          
          {sessionConfigDetails && sessionConfigDetails.length > 0 && (
            <div className="mb-5 grid grid-cols-2 gap-y-4 rounded-xl border border-border/30 bg-muted/30 p-4 shadow-inner">
              {sessionConfigDetails.map((d) => (
                <div key={d.label} className="flex flex-col gap-1.5 overflow-hidden pr-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/80">{d.label}</span>
                  <span className="truncate text-sm font-medium text-foreground/90" title={d.value}>
                    {d.value || "-"}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Footer / Actions */}
          {(isConnecting || ((isFailed || isDisconnected) && onReconnect)) && (
            <div className="mt-4 flex w-full items-center justify-center">
              {isConnecting ? (
                <div className="flex items-center gap-2.5">
                  <LoaderCircle className="h-4 w-4 animate-spin text-sky-500" />
                  <span className="text-sm font-medium text-sky-500/90">正在建立连接...</span>
                </div>
              ) : (
                <Button 
                  onClick={onReconnect} 
                  size="sm"
                  className="h-9 w-40 rounded-xl bg-sky-500 hover:bg-sky-400 text-white shadow-md active:scale-95 text-sm font-medium"
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  重新连接
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 过渡遮罩组件
 */
export function TransitionMask({ visible, text }: { visible: boolean; text: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-md transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-popover/80 px-5 py-3 text-sm text-foreground shadow-2xl backdrop-blur-md">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
        <span>{text}</span>
      </div>
    </div>
  );
}

/**
 * 通用工具函数：限制数值范围
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 通用容器样式类名
 */
export const VIEW_CONTAINER_CLASSNAME = 
  "terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden shadow-(--panel-shadow)";

/**
 * Canvas 容器样式类名
 */
export const CANVAS_CLASSNAME = "max-h-full max-w-full select-none object-contain";

/**
 * 隐藏元素样式类名
 */
export const HIDDEN_CLASSNAME = "hidden";

/**
 * 交互容器样式类名
 */
export const INTERACTIVE_CONTAINER_CLASSNAME = 
  "relative flex h-full w-full items-center justify-center overflow-hidden outline-none";
