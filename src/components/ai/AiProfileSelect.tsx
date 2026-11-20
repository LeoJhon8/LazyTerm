import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n";
import { useAiConfigStore } from "@/store/ai";

export function AiProfileSelect({ disabled = false }: { disabled?: boolean }) {
  const { t } = useI18n();
  const profiles = useAiConfigStore((state) => state.profiles);
  const activeProfileId = useAiConfigStore((state) => state.activeProfileId);
  const selectConfiguration = useAiConfigStore((state) => state.selectConfiguration);

  return (
    <Select value={activeProfileId} onValueChange={selectConfiguration} disabled={disabled || !profiles.length}>
      <SelectTrigger className="h-8 text-xs" aria-label={t("当前启用接口")}>
        <SelectValue placeholder={t("当前启用接口")} />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>{profile.name} · {profile.model}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
