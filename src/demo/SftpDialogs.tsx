import { useEffect, useRef, useState } from 'react';
import type { SessionNode } from '@/store/ssh-profiles';
import type { SSHConfig } from '@/types/terminal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useNotificationsStore } from '@/store/notifications';
import { HOME, filesFor, listDirectory, normalizePath } from './filesystem';
import { useDemoText } from './text';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; targetNode: SessionNode | null }

function SftpDialog({ open, onOpenChange, targetNode, direction }: Props & { direction: 'upload' | 'download' }) {
  const t = useDemoText();
  const host = (targetNode?.config as SSHConfig | undefined)?.host ?? 'web.demo';
  const [path, setPath] = useState(HOME);
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [, refresh] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const notification = useRef<string | null>(null);
  const cancelMessage = useRef(t('cancelled'));
  cancelMessage.current = t('cancelled');
  const cancel = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    if (notification.current) {
      useNotificationsStore.getState().updateNotification(notification.current, { type: 'info', title: cancelMessage.current, message: host });
      notification.current = null;
    }
  };
  useEffect(() => {
    setPath(HOME); setSelected([]); setProgress(null); setMessage('');
    return cancel;
    // Each dialog opening owns its transfer; closing or changing target cancels it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, host, direction]);

  const entries = listDirectory(host, path);
  const busy = progress !== null;
  const unavailable = host === 'auth-failed.demo';
  const navigate = (next: string) => { setPath(next); setSelected([]); setMessage(''); };
  const start = () => {
    if (timer.current !== null || unavailable || (direction === 'download' && !selected.length)) return;
    setProgress(0); setMessage('');
    let value = 0;
    const store = useNotificationsStore.getState();
    notification.current = store.addNotification({ type: 'info', source: 'sftp', title: t('progress'), message: host });
    timer.current = setInterval(() => {
      value += 10; setProgress(value);
      if (notification.current) store.updateNotification(notification.current, { message: `${host} · ${value}%` });
      if (value < 100) return;
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
      if (direction === 'upload') {
        filesFor(host).set(normalizePath('sample-upload.txt', path), { content: 'Uploaded inside LazyTerm Demo.\nThis file exists only in memory.\n' });
      }
      if (notification.current) store.updateNotification(notification.current, { type: 'success', title: t('complete'), message: host });
      notification.current = null;
      setProgress(null); setMessage(t('complete')); refresh((value) => value + 1);
    }, 200);
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) cancel(); onOpenChange(next); }}>
    <DialogContent className="sm:max-w-[620px]">
      <DialogHeader><DialogTitle>{t(direction)} · {host}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">{t('note')}</p>
      {unavailable ? <p role="alert">{t('unavailable')}</p> : <>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={busy || path === '/'} onClick={() => navigate(normalizePath('..', path))}>{t('up')}</Button>
          <code className="min-w-0 flex-1 truncate">{path}</code>
          <Button variant="ghost" disabled={busy} onClick={() => refresh((value) => value + 1)}>{t('refresh')}</Button>
        </div>
        <div className="h-64 overflow-auto rounded-md border p-2">
          {!entries.length && <p>{t('empty')}</p>}
          {entries.map((entry) => <div key={entry.path} className="flex items-center gap-3 rounded p-2 hover:bg-muted">
            {!entry.is_dir && direction === 'download' && <input type="checkbox" aria-label={entry.name} disabled={busy} checked={selected.includes(entry.path)} onChange={() => setSelected((current) => current.includes(entry.path) ? current.filter((item) => item !== entry.path) : [...current, entry.path])} />}
            {entry.is_dir ? <button className="flex-1 text-left" disabled={busy} onClick={() => navigate(entry.path)}>📁 {entry.name}/</button> : <span className="flex-1">{entry.name}</span>}
            <span className="text-sm text-muted-foreground">{entry.is_dir ? '' : `${entry.size} B`}</span>
          </div>)}
        </div>
        {busy && <progress className="w-full" max={100} value={progress} aria-label={t('progress')} />}
        <p className="text-sm" role="status">{message || (busy ? `${t('progress')} · ${progress}%` : '\u00a0')}</p>
        <div className="flex justify-end gap-2">
          {busy ? <Button variant="outline" onClick={() => { cancel(); setProgress(null); setMessage(t('cancelled')); }}>{t('cancel')}</Button>
            : <Button disabled={direction === 'download' && !selected.length} onClick={start}>{t(direction === 'upload' ? 'startUpload' : 'startDownload')}</Button>}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
export function SftpUploadDialog(props: Props) { return <SftpDialog {...props} direction="upload" />; }
export function SftpDownloadDialog(props: Props) { return <SftpDialog {...props} direction="download" />; }
