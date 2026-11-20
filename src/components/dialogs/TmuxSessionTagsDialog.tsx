import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { useTmuxSessionTagsStore, type TmuxSessionTagTarget } from "@/store/tmux-session-tags";

function TmuxSessionTagsForm({ target, onClose }: { target: TmuxSessionTagTarget; onClose: () => void }) {
  const { t } = useI18n();
  const tags = useTmuxSessionTagsStore((state) => state.tagsBySession[target.key]);
  const setTags = useTmuxSessionTagsStore((state) => state.setTags);
  const [draft, setDraft] = useState(() => tags?.join("\n") ?? "");

  const handleSave = () => {
    const nextTags = draft.split("\n").map((tag) => tag.trim()).filter(Boolean);
    setTags(target.key, [...new Set(nextTags)]);
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("编辑 tmux 会话标签")}</DialogTitle>
        <DialogDescription>
          <span className="block break-all font-mono">{t("tmux 会话：{name}", { name: target.name })}</span>
          {t("每行输入一个标签。清空后保存可移除所有标签。")}
        </DialogDescription>
      </DialogHeader>
      <Textarea aria-label={t("输入标签")} value={draft} onChange={(event) => setDraft(event.target.value)} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("取消")}</Button>
        <Button onClick={handleSave}>{t("保存")}</Button>
      </DialogFooter>
    </>
  );
}

export function TmuxSessionTagsDialog({
  target,
  loading = false,
  onClose,
}: {
  target: TmuxSessionTagTarget | null;
  loading?: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent className="max-w-md">
        {target ? (
          <TmuxSessionTagsForm key={target.key} target={target} onClose={onClose} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("编辑 tmux 会话标签")}</DialogTitle>
              <DialogDescription role="status">
                {loading ? t("正在读取 tmux 会话…") : t("无法读取此 tmux 会话。")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t("关闭")}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
