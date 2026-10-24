import { ALL_DAY_REMINDER_TIME } from '../../core/reminders.ts';
import type { Reminder } from '../../core/types.ts';
import { formatTime, formatWhen } from '../format.ts';
import { t } from '../i18n/i18n.ts';

/** "30 minutes before", "1 day before (9:00 AM)", "On the day (9:00 AM)", or the set time. */
export function reminderLabel(reminder: Reminder, allDay: boolean, today: string): string {
  if ('at' in reminder) return formatWhen(reminder.at, today);
  const minutes = reminder.before;
  if (allDay) {
    const time = formatTime(ALL_DAY_REMINDER_TIME);
    if (minutes === 0) return t('reminder.onTheDay', { time });
    const days = Math.round(minutes / 1440);
    if (days === 7) return t('reminder.weekBefore', { time });
    return days === 1
      ? t('reminder.dayBefore', { time })
      : t('reminder.daysBefore', { days, time });
  }
  if (minutes === 0) return t('reminder.onTime');
  if (minutes < 60) return t('reminder.minutesBefore', { minutes });
  if (minutes < 1440) {
    const hours = minutes / 60;
    return hours === 1 ? t('reminder.hourBefore') : t('reminder.hoursBefore', { hours });
  }
  const days = minutes / 1440;
  return days === 1 ? t('reminder.dayBeforeTimed') : t('reminder.daysBeforeTimed', { days });
}
