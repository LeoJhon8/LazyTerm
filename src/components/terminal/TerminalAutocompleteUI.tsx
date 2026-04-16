import { useEffect, useState, useMemo, useCallback } from "react";
import { useHistoryStore } from "@/store/history";
import { useQuickCommandsStore } from "@/store/quick-commands";
import { cn } from "@/lib/utils";
import { Terminal } from "lucide-react";
import { useI18n } from "@/i18n";

export interface AutocompletePos {
  active: boolean;
  buffer: string;
  x: number;
  y: number;
  parentHeight?: number;
  cellHeight?: number;
}

export function TerminalAutocompleteUI({ 
  sessionId, 
  onAccept 
}: { 
  sessionId: string, 
  onAccept: (text: string) => void 
}) {
  const { t } = useI18n();
  const [pos, setPos] = useState<AutocompletePos>({ active: false, buffer: "", x: 0, y: 0 });
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const { commands: historyCommands } = useHistoryStore();
  const { commands: quickCommands } = useQuickCommandsStore();

  useEffect(() => {
    const handler = (e: CustomEvent) => setPos(e.detail);
    window.addEventListener(`autocomplete-suggest-${sessionId}`, handler as EventListener);
    return () => window.removeEventListener(`autocomplete-suggest-${sessionId}`, handler as EventListener);
  }, [sessionId]);

  // 使用 useMemo 缓存建议列表，只在 buffer/active/数据源变化时重新计算
  const suggestions = useMemo(() => {
    if (!pos.active) return [];

    const query = pos.buffer.trim();
    if (!query) return [];

    const lowerBuffer = query.toLowerCase();
    const isSameAsCurrentLine = (command: string) => command.trim() === query;
    
    const quickMatches = quickCommands
      .filter(c => c.label.toLowerCase().includes(lowerBuffer) || c.command.toLowerCase().includes(lowerBuffer))
      .filter(c => !isSameAsCurrentLine(c.command))
      .map(c => ({ id: "q_" + c.id, label: c.label, command: c.command, type: 'quick' as const }));

    const quickCommandSet = new Set(quickMatches.map(q => q.command));
    const historyMatches = historyCommands
      .filter(c => c.command.toLowerCase().includes(lowerBuffer))
      .filter(c => !isSameAsCurrentLine(c.command))
      .filter(c => !quickCommandSet.has(c.command))
      .slice(0, 10)
      .map(c => ({ id: "h_" + c.id, label: c.command, command: c.command, type: 'history' as const }));

    return [...quickMatches, ...historyMatches].slice(0, 8);
  }, [pos.active, pos.buffer, quickCommands, historyCommands]);

  // 当建议列表变化时，通过依赖关系触发状态重置
  useEffect(() => {
    // 建议列表已变化，selectedIndex 会被自动清除
    // 这里不需要显式调用 setState
  }, [suggestions]);

  const handleAccept = useCallback((command: string) => {
    onAccept(command);
    setSelectedIndex(-1);
  }, [onAccept]);

  useEffect(() => {
    if (!pos.active || suggestions.length === 0) return;

    const handleKey = (e: CustomEvent) => {
       const { key } = e.detail;
       
       if (key === "ArrowDown") {
         setSelectedIndex(prev => (prev < 0 ? 0 : (prev + 1) % suggestions.length));
       } else if (key === "ArrowUp") {
         setSelectedIndex(prev => (
           prev < 0 ? suggestions.length - 1 : (prev - 1 + suggestions.length) % suggestions.length
         ));
       } else if (key === "Enter" || key === "Tab") {
         if (selectedIndex < 0) {
           return;
         }
         const selected = suggestions[selectedIndex];
         if (selected) {
            handleAccept(selected.command);
            setSelectedIndex(-1);
         }
       }
    };
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.addEventListener("lazy-term-autocomplete-key", handleKey as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => window.removeEventListener("lazy-term-autocomplete-key", handleKey as any);
  }, [pos.active, suggestions, selectedIndex, handleAccept]);

  // 同步建议状态给 Addon
  useEffect(() => {
    const hasSuggestions = pos.active && suggestions.length > 0;
    const hasSelectedSuggestion = hasSuggestions && selectedIndex >= 0 && selectedIndex < suggestions.length;
    window.dispatchEvent(new CustomEvent(`autocomplete-status-${sessionId}`, { 
      detail: { hasSuggestions, hasSelectedSuggestion } 
    }));
  }, [sessionId, pos.active, suggestions.length, selectedIndex]);

  if (!pos.active || suggestions.length === 0) return null;

  // 保证弹窗在视口内（简单的防溢出）
  const popupWidth = 300;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 1000;
  
  let leftPos = pos.x;
  if (leftPos + popupWidth > viewportWidth - 20) {
      leftPos = viewportWidth - popupWidth - 20;
  }

  // 估算弹窗最大高度 (8个item + header + padding)
  const popupMaxHeight = Math.min(suggestions.length * 36 + 40, 350); 
  // 使用传入的 containerHeight，如果没有则使用 viewportHeight
  const containerHeight = pos.parentHeight || viewportHeight;
  const isOverflowingBottom = pos.y + popupMaxHeight > containerHeight - 20;

  return (
    <div 
      className="absolute z-100 flex flex-col overflow-hidden rounded-xl border border-border bg-popover/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
      style={{
        left: leftPos,
        top: isOverflowingBottom ? 'auto' : pos.y + 4,
        bottom: isOverflowingBottom ? containerHeight - pos.y + (pos.cellHeight || 20) + 4 : 'auto',
        minWidth: '240px',
        width: popupWidth,
        maxWidth: '400px',
        maxHeight: '350px'
      }}
    >
      <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-widest bg-muted/40 border-b border-border flex items-center justify-between">
        <span>{t("智能提示")}</span>
        <span className="text-[9px] opacity-40 font-mono lowercase">Tab / Enter</span>
      </div>
      <div className="flex flex-col py-1">
        {suggestions.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isHistory = item.type === 'history';
          return (
            <div
              key={item.id}
              onClick={() => handleAccept(item.command)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-[13px] cursor-pointer transition-all duration-100",
                isSelected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              )}
            >
              <div className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] transition-colors",
                isSelected ? "bg-primary/20 text-primary" : "bg-muted/60 text-muted-foreground"
              )}>
                {isHistory ? <Terminal className="h-3 w-3" /> : <span className="font-mono text-[11px]">⚡</span>}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate font-medium">{item.label}</span>
                {item.type === 'quick' && item.command !== item.label && (
                   <span className="truncate text-[11px] opacity-50 font-mono mt-0.5 leading-tight">{item.command}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
