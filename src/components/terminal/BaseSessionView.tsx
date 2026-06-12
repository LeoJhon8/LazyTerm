import { useEffect, useRef, useCallback } from "react";
import { logger } from "@/lib/logger";
import { useTabsStore } from "@/store/tabs";
import type { TerminalSession } from "@/store/tabs";

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
 * 视图容器 ref
 */
export interface ViewContainerRef {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 基础会话视图 Hook 返回类型
 */
export interface BaseSessionViewResult extends ViewContainerRef {
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
      if (onVisualReady) {
        onVisualReady(sessionId);
      }
    }
  }, [sessionId, onVisualReady]);

  /**
   * 会话切换时重置视觉就绪状态
   */
  useEffect(() => {
    visualReadyNotifiedRef.current = false;
  }, [sessionId]);

  return {
    session,
    sessionTitle,
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
