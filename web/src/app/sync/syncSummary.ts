import { t } from '../i18n/i18n.ts';
import type { SyncState } from './syncEngine.ts';

/** "just now", "3 minutes ago", ... */
function ago(time: number, now = Date.now()): string {
  const seconds = Math.round((time - now) / 1000);
  if (seconds > -45) return t('sync.justNow');
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (seconds > -3600) return format.format(Math.round(seconds / 60), 'minute');
  if (seconds > -86400) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86400), 'day');
}

/** One line on how syncing stands. */
export function syncSummary(state: Pick<SyncState, 'status' | 'lastSynced' | 'error'>): string {
  switch (state.status) {
    case 'syncing':
      return t('sync.syncing');
    case 'offline':
      return t('sync.offline');
    case 'error':
      return t('sync.error', { message: state.error ?? '' });
    case 'app-update':
      return t('sync.appUpdate');
    case 'server-behind':
      return t('sync.serverBehind');
    default:
      return state.lastSynced === null
        ? t('sync.notYet')
        : t('sync.synced', { when: ago(state.lastSynced) });
  }
}
