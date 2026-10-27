import { allDayParts } from '../../core/reminders.ts';
import type { Reminder } from '../../core/types.ts';
import { formatTime, formatWhen } from '../format.ts';
import { t } from '../i18n/i18n.ts';

/** How many days, as TickTick says it: "On the day", "2 days early", "1 week early". */
export function daysEarlyText(days: number): string {
  if (days === 0) return t('reminder.onTheDay');
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? t('reminder.weekEarly') : t('reminder.weeksEarly', { weeks });
  }
  return days === 1 ? t('reminder.dayEarly') : t('reminder.daysEarly', { days });
}

/** Minutes before a timed task: "On time", "5 minutes early", "1 hour early", "2 days early". */
export function minutesEarlyText(minutes: number): string {
  if (minutes === 0) return t('reminder.onTime');
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? t('reminder.dayEarly') : t('reminder.daysEarly', { days });
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? t('reminder.hourEarly') : t('reminder.hoursEarly', { hours });
  }
  return minutes === 1 ? t('reminder.minuteEarly') : t('reminder.minutesEarly', { minutes });
}

/**
 * A reminder as words and the time of day it comes at: always for an all-day task; for a timed
 * one (its start time `startTime`) when it is days early at a time of its own (R-FB-91).
 */
export function reminderParts(
  reminder: Reminder,
  allDay: boolean,
  today: string,
  startTime: string | null = null,
): { text: string; time?: string } {
  if ('at' in reminder) return { text: formatWhen(reminder.at, today) };
  if (allDay) {
    const { days, time } = allDayParts(reminder.before);
    return { text: daysEarlyText(days), time: formatTime(time) };
  }
  if (startTime && reminder.before >= 1440 && reminder.before % 1440 !== 0) {
    const { days, time } = allDayParts(reminder.before, startTime);
    return { text: daysEarlyText(days), time: formatTime(time) };
  }
  return { text: minutesEarlyText(reminder.before) };
}

/** "30 minutes early", "1 day early (9:00 AM)", "On the day (9:00 AM)", or the set time. */
export function reminderLabel(
  reminder: Reminder,
  allDay: boolean,
  today: string,
  startTime: string | null = null,
): string {
  const { text, time } = reminderParts(reminder, allDay, today, startTime);
  return time ? `${text} (${time})` : text;
}
