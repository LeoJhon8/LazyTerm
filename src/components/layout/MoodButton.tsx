import { HoverTooltip } from "@/components/ui/tooltip";
import { Dices } from "lucide-react";
import { useI18n } from "@/i18n";
import { MOOD_PALETTES, pickMoodColors } from "@/lib/mood-colors";
import { useSettingsStore } from "@/store/settings";

export function MoodButton() {
  const { t } = useI18n();
  const visible = useSettingsStore((state) => state.moodButtonVisible);
  const currentMood = useSettingsStore((state) => state.currentMood);

  if (!visible) return null;

  const changeMood = () => {
    const settings = useSettingsStore.getState();
    const colors = pickMoodColors(settings.currentMood);
    settings.setSettings({
      currentMood: colors.mood,
      appBackgroundColor: "custom",
      appColorPalette: { color: colors.app },
      terminalBackgroundMode: "custom",
      terminalBackgroundColor: colors.terminal,
    });
  };

  const mood = MOOD_PALETTES.find(({ id }) => id === currentMood);
  const label = mood ? t("当前心情：{mood} · 点击切换", { mood: t(mood.label) }) : t("换个心情");

  return (
    <HoverTooltip content={label}>
      <button
        type="button"
        className="mood-button inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={label}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={changeMood}
      >
        <Dices className="h-4 w-4" aria-hidden="true" />
      </button>
    </HoverTooltip>
  );
}
