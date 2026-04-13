import React, { useEffect, useState } from "react";
import { useHistoryStore } from "@/store/history";
import { useQuickCommandsStore } from "@/store/quick-commands";
import { cn } from "@/lib/utils";
import { Terminal } from "lucide-react";

export interface AutocompletePos {
  active: boolean;
  buffer: string;
  x: number;
  y: number;
}

export function TerminalAutocompleteUI({ 
  sessionId, 
  onAccept 
}: { 
  sessionId: string, 
  onAccept: (text: string) => void 
}) {
  const [pos, setPos] = useState<AutocompletePos>({ active: false, buffer: "", x: 0, y: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { commands: historyCommands } = useHistoryStore();
  const { commands: quickCommands } = useQuickCommandsStore();

  const [suggestions, setSuggestions] = useState<Array<{ id: string, label: string, command: string, type: 'quick' | 'history' }>>([]);

  useEffect(() => {
    const handler = (e: CustomEvent) => setPos(e.detail);
    window.addEventListener(`autocomplete-suggest-${sessionId}`, handler as EventListener);
    return () => window.removeEventListener(`autocomplete-suggest-${sessionId}`, handler as EventListener);
  }, [sessionId]);

  useEffect(() => {
    if (!pos.active || !pos.buffer) {
      setSuggestions([]);
      return;
    }

    const lowerBuffer = pos.buffer.toLowerCase();
    
    const quickMatches = quickCommands
      .filter(c => c.label.toLowerCase().includes(lowerBuffer) || c.command.toLowerCase().includes(lowerBuffer))
      .map(c => ({ id: "q_" + c.id, label: c.label, command: c.command, type: 'quick' as const }));

    const historyMatches = historyCommands
      .filter(c => c.command.toLowerCase().startsWith(lowerBuffer) || c.command.toLowerCase().includes(lowerBuffer))
      .filter(c => !quickMatches.some(q => q.command === c.command)) // dedupe
      .slice(0, 10) // Limit display
      .map(c => ({ id: "h_" + c.id, label: c.command, command: c.command, type: 'history' as const }));

    const combined = [...quickMatches, ...historyMatches].slice(0, 8); // MAX 8
    setSuggestions(combined);
    setSelectedIndex(0);

  }, [pos.active, pos.buffer, quickCommands, historyCommands]);

  useEffect(() => {
    const handleKey = (e: CustomEvent) => {
       if (!pos.active || suggestions.length === 0) return;
       const { key } = e.detail;
       
       if (key === "ArrowDown") {
         setSelectedIndex(prev => (prev + 1) % suggestions.length);
       } else if (key === "ArrowUp") {
         setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
       } else if (key === "Enter" || key === "Tab") {
         const selected = suggestions[selectedIndex];
         if (selected) {
            onAccept(selected.command);
         }
       }
    };
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.addEventListener("lazy-term-autocomplete-key", handleKey as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => window.removeEventListener("lazy-term-autocomplete-key", handleKey as any);
  }, [pos.active, suggestions, selectedIndex, onAccept]);

  if (!pos.active || suggestions.length === 0) return null;

  // 保证弹窗在视口内（简单的防溢出）
  const popupWidth = 300;
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1000;
  
  let leftPos = pos.x;
  if (leftPos + popupWidth > viewportWidth - 20) {
      leftPos = viewportWidth - popupWidth - 20;
  }

  return (
    <div 
      className="absolute z-[100] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1e1e24]/95 shadow-2xl shadow-black/50 backdrop-blur-xl"
      style={{
        left: leftPos,
        top: pos.y,
        minWidth: '240px',
        width: popupWidth,
        maxWidth: '400px'
      }}
    >
      <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-widest bg-black/20 border-b border-white/5 flex items-center justify-between">
        <span>智能提示</span>
        <span className="text-[9px] opacity-40 font-mono lowercase">Tab / Enter</span>
      </div>
      <div className="flex flex-col py-1">
        {suggestions.map((item, index) => {
          const isSelected = index === selectedIndex;
          const isHistory = item.type === 'history';
          return (
            <div
              key={item.id}
              onClick={() => onAccept(item.command)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-[13px] cursor-pointer transition-all duration-100",
                isSelected ? "bg-emerald-500/15 text-emerald-400" : "text-zinc-300 hover:bg-white/5"
              )}
            >
              <div className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] transition-colors",
                isSelected ? "bg-emerald-500/20 text-emerald-300" : "bg-black/30 text-zinc-500"
              )}>
                {isHistory ? <Terminal className="h-[12px] w-[12px]" /> : <span className="font-mono text-[11px]">⚡</span>}
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
