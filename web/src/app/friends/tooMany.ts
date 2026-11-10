import { t } from '../i18n/i18n.ts';

/** "Too many lookups. Try again in a minute." (or in N minutes): the server's 429 (audit S13). */
export function tooManyText(minutes: number): string {
  return minutes <= 1 ? t('friends.tooMany') : t('friends.tooManyMinutes', { minutes });
}
