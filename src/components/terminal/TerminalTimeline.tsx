import { useI18n } from "@/i18n";

interface TerminalTimelineProps {
  width: number;
  railRef: (element: HTMLElement | null) => void;
}

export function getTerminalTimelineWidth(fontSize: number) {
  return Math.ceil(Math.max(112, fontSize * 7.4));
}

export function TerminalTimeline({
  width,
  railRef,
}: TerminalTimelineProps) {
  const { t } = useI18n();

  return (
    <aside
      ref={railRef}
      aria-label={t("命令时间线")}
      className="absolute inset-y-0 left-0 z-10 select-none overflow-hidden border-r border-border/35 bg-background/20"
      style={{ width }}
    >
      <div
        aria-hidden="true"
        className="absolute bottom-0 right-[5px] top-0 w-px bg-border/45"
      />
    </aside>
  );
}
