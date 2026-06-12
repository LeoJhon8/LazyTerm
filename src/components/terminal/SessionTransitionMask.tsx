import { cn } from "@/lib/utils";

export function SessionTransitionMask({ visible, text }: { visible: boolean; text: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/60 backdrop-blur-md transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-popover/80 px-5 py-3 text-sm text-foreground shadow-2xl backdrop-blur-md">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-500" />
        <span>{text}</span>
      </div>
    </div>
  );
}
