import { t } from '../i18n/i18n.ts';
import type { SyncNotice } from './syncEngine.ts';

/** What to say about what the server took back. */
export function noticeText(notice: SyncNotice): string {
  const parts: string[] = [];
  const [first, ...others] = notice.lostLists;
  if (first !== undefined) {
    parts.push(
      others.length === 0
        ? t('sync.notice.lostList', { name: first })
        : t('sync.notice.lostLists', { name: first, count: others.length }),
    );
  }
  if (notice.refused > 0) {
    parts.push(
      notice.refused === 1
        ? t('sync.notice.refusedOne')
        : t('sync.notice.refused', { count: notice.refused }),
    );
  }
  return parts.join(' ');
}
