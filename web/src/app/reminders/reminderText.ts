import { ALL_DAY_REMINDER_TIME } from '../../core/reminders.ts';
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

/** Days after the task's day, for a reminder that comes later than the task. */
function daysAfterText(days: number): string {
  return days === 1 ? t('reminder.dayAfter') : t('reminder.daysAfter', { days });
}

/** A length of time in whole units: "1 day 2 hours", "8 hours 58 minutes". */
function spanText(total: number): string {
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  return [
    days === 0 ? '' : days === 1 ? t('reminder.span.day') : t('reminder.span.days', { days }),
    hours === 0 ? '' : hours === 1 ? t('reminder.span.hour') : t('reminder.span.hours', { hours }),
    minutes === 0
      ? ''
      : minutes === 1
        ? t('reminder.span.minute')
        : t('reminder.span.minutes', { minutes }),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Minutes before a timed task: "On time", "5 minutes early", "1 hour early", "2 days early",
 * "8 hours 58 minutes early". A reminder after the task's time (negative) says so: "2 hours
 * after", never a negative "early" (Ben, 0.13.0-rc.3).
 */
export function minutesEarlyText(minutes: number): string {
  if (minutes === 0) return t('reminder.onTime');
  if (minutes < 0) return t('reminder.spanAfter', { span: spanText(-minutes) });
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? t('reminder.dayEarly') : t('reminder.daysEarly', { days });
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? t('reminder.hourEarly') : t('reminder.hoursEarly', { hours });
  }
  if (minutes < 60) {
    return minutes === 1 ? t('reminder.minuteEarly') : t('reminder.minutesEarly', { minutes });
  }
  return t('reminder.spanEarly', { span: spanText(minutes) });
}

/**
 * A reminder `before` minutes ahead of `from` ("HH:mm") as its day, counted from the task's day,
 * and its time of day: "1 day early" at 16:00, "On the day" at 14:58, "1 day after" at 01:00.
 */
function dayAndTime(before: number, from: string): { text: string; time: string } {
  const [h, m] = from.split(':').map(Number) as [number, number];
  const fromMidnight = h * 60 + m - before;
  const day = Math.floor(fromMidnight / 1440);
  const minutes = fromMidnight - day * 1440;
  const two = (n: number) => String(n).padStart(2, '0');
  const time = formatTime(`${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`);
  if (day < 0) return { text: daysEarlyText(-day), time };
  return { text: day === 0 ? t('reminder.onTheDay') : daysAfterText(day), time };
}

/**
 * A reminder as words and the time of day it comes at: always for an all-day task; for a timed
 * one (its start time `startTime`) when it is set at a time of day rather than minutes or hours
 * early (Custom's Day and Week tabs, R-FB-91): days early, on the task's day, or after it, with
 * the clock time. For an all-day task `startTime` is what it counts from (9:00 unless said
 * otherwise: Settings counts new tasks' reminders from the person's all-day time, R-FB-92).
 */
export function reminderParts(
  reminder: Reminder,
  allDay: boolean,
  today: string,
  startTime: string | null = null,
): { text: string; time?: string } {
  if ('at' in reminder) return { text: formatWhen(reminder.at, today) };
  if (allDay) return dayAndTime(reminder.before, startTime ?? ALL_DAY_REMINDER_TIME);
  const before = reminder.before;
  // Not a whole number of minutes or hours early (as the Minute and Hour tabs make): at a time.
  const atATime =
    before < 0 || (before % 1440 !== 0 && (before >= 1440 || (before > 60 && before % 60 !== 0)));
  if (startTime && atATime) return dayAndTime(before, startTime);
  return { text: minutesEarlyText(before) };
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
