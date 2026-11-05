import { t } from '../i18n/i18n.ts';

/** A clean-up time in words: days up to 30, then months, then a year. */
export function purgePeriod(days: number): string {
  if (days >= 365) return t('settings.data.purge.year');
  return days > 30
    ? t('settings.data.purge.months', { months: days / 30 })
    : t('settings.data.purge.days', { days });
}
