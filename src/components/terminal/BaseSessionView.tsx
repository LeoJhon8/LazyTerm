import { useEffect, useRef, useState, useCallback } from "react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import type { Session } from "@/types/terminal";

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
  session: Session | undefined;
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
    return "terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden border border-(--terminal-border) shadow-(--panel-shadow)";
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
      <span>{title}</span>
      {extraInfo}
    </div>
  );
}

/**
 * 断开连接提示组件
 */
export function DisconnectedBanner({ message }: { message: string }) {
  return (
    <div className="absolute inset-x-0 bottom-6 mx-auto flex w-fit items-center gap-2 rounded-full border border-amber-300/25 bg-amber-500/15 px-4 py-2 text-sm text-amber-100 backdrop-blur-md">
      <span>{message}</span>
    </div>
  );
}

/**
 * 加载中提示组件
 */
export function LoadingPlaceholder({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex max-w-md flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/6 px-8 py-10 text-center text-white/80">
      {icon}
      <div>
        <div className="text-lg font-semibold text-white">{title}</div>
        <div className="mt-2 text-sm leading-6 text-white/60">{description}</div>
      </div>
    </div>
  );
}

/**
 * 过渡遮罩组件
 */
export function TransitionMask({ visible, text }: { visible: boolean; text: string }) {
  if (!visible) return null;
  
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-black/50 px-5 py-3 text-sm text-white/90 shadow-2xl">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-300" />
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
  "terminal-container relative z-0 h-full min-h-0 w-full min-w-0 overflow-hidden border border-(--terminal-border) shadow-(--panel-shadow)";

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
