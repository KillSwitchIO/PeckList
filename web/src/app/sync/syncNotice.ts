import { t } from '../i18n/i18n.ts';
import type { SyncNotice } from './syncEngine.ts';

/** What to say about what the server took back. */
export function noticeText(notice: SyncNotice): string {
  const parts: string[] = [];
  const [first, ...others] = notice.lostLists;
  if (first !== undefined) {
    parts.push(t('sync.notice.lostLists', { name: first, count: others.length }));
  }
  if (notice.refused > 0) {
    parts.push(t('sync.notice.refused', { count: notice.refused }));
  }
  const [file, ...moreFiles] = notice.filesKept ?? [];
  if (file !== undefined) {
    parts.push(t('sync.notice.filesKept', { name: file, count: moreFiles.length }));
  }
  const [waits, ...moreWaiting] = notice.filesWaiting ?? [];
  if (waits !== undefined) {
    parts.push(t('sync.notice.filesWaiting', { name: waits, count: moreWaiting.length }));
  }
  if (notice.setAside) {
    parts.push(t('sync.notice.setAside', { count: notice.setAside }));
  }
  if (notice.clock) {
    parts.push(t(notice.clock === 'ahead' ? 'sync.notice.clockAhead' : 'sync.notice.clockBehind'));
  }
  return parts.join(' ');
}
