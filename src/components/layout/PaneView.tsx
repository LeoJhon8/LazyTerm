import { useCallback } from "react";
import { usePanesStore } from "@/store/panes";
import { useTabsStore } from "@/store/tabs";
import {
  TerminalViewClass,
  RemoteDesktopViewClass,
  VncViewClass,
} from "@/components/terminal";
import { cn } from "@/lib/utils";

interface PaneViewProps {
  /** 面板 ID */
  paneId: string;
  /** 是否显示焦点边框 */
  showFocusBorder?: boolean;
}

/**
 * 单个面板视图组件
 * 根据 paneId 获取对应的 session，并渲染对应的视图（终端/RDP/VNC）
 */
export function PaneView({ paneId, showFocusBorder = true }: PaneViewProps) {
  const { panes, focusedPaneId, focusPane } = usePanesStore();
  const { sessions } = useTabsStore();

  // 获取当前面板
  const pane = panes.find(p => p.id === paneId);
  const isFocused = focusedPaneId === paneId;
  
  // 获取面板关联的会话
  const session = pane?.sessionId 
    ? sessions.find(s => s.id === pane.sessionId)
    : null;
  
  // 调试信息
  console.debug("[PaneView] Render:", { 
    paneId, 
    paneSessionId: pane?.sessionId, 
    sessionFound: !!session,
    sessionsCount: sessions.length,
    sessionIds: sessions.map(s => s.id)
  });

  // 点击面板时设置焦点
  const handlePaneClick = useCallback(() => {
    if (!isFocused) {
      focusPane(paneId);
    }
  }, [isFocused, paneId, focusPane]);

  // 如果没有面板数据，显示空状态
  if (!pane) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background/50">
        <div className="text-sm text-muted-foreground">面板不存在</div>
      </div>
    );
  }

  // 如果没有关联会话，显示空状态
  if (!session) {
    return (
      <div 
        className={cn(
          "flex h-full w-full items-center justify-center bg-background/50 cursor-pointer transition-all",
          showFocusBorder && isFocused && "ring-2 ring-inset ring-primary/50"
        )}
        onClick={handlePaneClick}
      >
        <div className="text-center">
          <div className="text-sm text-muted-foreground mb-2">此面板未关联会话</div>
          <div className="text-xs text-muted-foreground/60">
            从左侧会话列表拖拽会话到此处，或点击标签页切换
          </div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "relative h-full w-full overflow-hidden transition-all",
        showFocusBorder && isFocused && "ring-2 ring-inset ring-primary/50"
      )}
      onClick={handlePaneClick}
    >
      {/* 面板内容 - 使用基于类的视图组件（模板方法模式） */}
      {/* key 使用 sessionId 确保同一个 session 的组件被复用，避免输出丢失 */}
      {session.type === "rdp" ? (
        <RemoteDesktopViewClass 
          key={session.id} 
          paneId={paneId}
          sessionId={session.id}
        />
      ) : session.type === "vnc" ? (
        <VncViewClass 
          key={session.id} 
          paneId={paneId}
          sessionId={session.id}
        />
      ) : (
        <TerminalViewClass 
          key={session.id} 
          paneId={paneId}
          sessionId={session.id}
        />
      )}

      {/* 焦点指示器（小圆点） */}
      {isFocused && (
        <div className="absolute top-2 right-2 z-10">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        </div>
      )}

      {/* 会话类型标签 */}
      {/* <div className="absolute bottom-2 right-2 z-10 pointer-events-none">
        <div className="px-2 py-0.5 rounded-full bg-background/80 text-[10px] text-muted-foreground border border-border/50">
          {session.type === "local" && "本地"}
          {session.type === "ssh" && "SSH"}
          {session.type === "rdp" && "RDP"}
          {session.type === "vnc" && "VNC"}
        </div>
      </div> */}
    </div>
  );
}
