import { useI18n } from "@/i18n";
import type { TerminalSession } from "@/store/tabs";
import {
  getConnectedTmuxTagTarget,
  isConnectedTmuxSession,
  loadConnectedTmuxTagTarget,
  useTmuxSessionTagsStore,
} from "@/store/tmux-session-tags";

export function useTmuxTabTags(sessions: TerminalSession[]) {
  const { t } = useI18n();
  const tagsBySession = useTmuxSessionTagsStore((state) => state.tagsBySession);
  const connectedSessions = sessions.filter(isConnectedTmuxSession);
  const lines = connectedSessions.flatMap((session) => {
    const target = getConnectedTmuxTagTarget(session);
    const tags = target && tagsBySession[target.key];
    if (!target || !tags?.length) return [];

    const summary = t("标签：{tags}", { tags: tags.join(" · ") });
    return [connectedSessions.length > 1 ? `${target.name} · ${summary}` : summary];
  });

  const loadTags = () => {
    if (Object.keys(tagsBySession).length === 0) return;
    for (const session of connectedSessions) void loadConnectedTmuxTagTarget(session.id);
  };

  return { lines, loadTags, hasConnectedTmux: connectedSessions.length > 0 };
}
