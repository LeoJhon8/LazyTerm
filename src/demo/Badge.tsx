import { useDemoText } from './text';

export function DemoBadge() {
  const t = useDemoText();
  return <aside className="fixed bottom-3 right-3 z-[100] flex items-center gap-3 rounded-lg border border-amber-400 bg-background px-3 py-2 text-xs text-foreground shadow-lg" title={t('hint')}>
    <span>LazyTerm {t('label')}</span>
    <button className="rounded border px-2 py-1 hover:bg-muted" onClick={() => window.location.reload()}>{t('reset')}</button>
  </aside>;
}
