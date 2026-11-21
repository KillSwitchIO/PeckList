import { addDays, datePart, timePart, todayIn } from '../../core/dates.ts';
import { ALL_DAY_REMINDER_TIME, type ReminderDate } from '../../core/reminders.ts';
import type { Reminder } from '../../core/types.ts';
import { formatDay, formatTime, formatWhen } from '../format.ts';
import { t } from '../i18n/i18n.ts';

/**
 * A reminder notification's text: the task's own date and time, not the reminder's (Ben,
 * 0.14.0-rc.1), with the day said from where the notification shows (`shownAt` on `timeZone`'s
 * clock). "Due 3:00 PM" today; "Due tomorrow, 6:00 AM" and "Due Thu, Oct 22, 6:00 AM" (the
 * person's date format) other days; "Due today" for a whole day. "Starts" when the reminders count
 * from the task's start. "Reminder" for a task with no date.
 */
export function notificationBody(
  date: ReminderDate | null,
  shownAt: number,
  timeZone: string,
): string {
  if (!date) return t('reminder.undated');
  const today = todayIn(timeZone, shownAt);
  const day = datePart(date.at);
  const time = timePart(date.at);
  const starts = date.kind === 'start';
  if (time !== null && day === today) {
    return t(starts ? 'reminder.starts.time' : 'reminder.due.time', { time: formatTime(time) });
  }
  const dayText =
    day === today
      ? t('reminder.day.today')
      : day === addDays(today, 1)
        ? t('reminder.day.tomorrow')
        : day === addDays(today, -1)
          ? t('reminder.day.yesterday')
          : formatDay(day, today);
  if (time === null)
    return t(starts ? 'reminder.starts.day' : 'reminder.due.day', { day: dayText });
  return t(starts ? 'reminder.starts.dayTime' : 'reminder.due.dayTime', {
    day: dayText,
    time: formatTime(time),
  });
}

/** How many days, as TickTick says it: "On the day", "2 days early", "1 week early". */
export function daysEarlyText(days: number): string {
  if (days === 0) return t('reminder.onTheDay');
  if (days % 7 === 0) {
    const weeks = days / 7;
    return t('reminder.weeksEarly', { weeks });
  }
  return t('reminder.daysEarly', { days });
}

/** Days after the task's day, for a reminder that comes later than the task. */
function daysAfterText(days: number): string {
  return t('reminder.daysAfter', { days });
}

/** A length of time in whole units: "1 day 2 hours", "8 hours 58 minutes". */
function spanText(total: number): string {
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  return [
    days === 0 ? '' : t('reminder.span.days', { days }),
    hours === 0 ? '' : t('reminder.span.hours', { hours }),
    minutes === 0 ? '' : t('reminder.span.minutes', { minutes }),
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
    return t('reminder.daysEarly', { days });
  }
  if (minutes % 60 === 0) return t('reminder.hoursEarly', { hours: minutes / 60 });
  if (minutes < 60) return t('reminder.minutesEarly', { minutes });
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
 * Whether a reminder half a day or more early, not a whole number of days, comes on an earlier day
 * than the task: "1 day early (2:00 PM)" reads better than "16 hours early" on a 6:00 AM task (QA,
 * 0.14.0). Shorter offsets keep their minutes and hours, and whole days stay "1 day early".
 */
function earlierDay(before: number, from: string): boolean {
  const [h, m] = from.split(':').map(Number) as [number, number];
  return before >= 720 && before % 1440 !== 0 && before > h * 60 + m;
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
  if (startTime && (atATime || earlierDay(before, startTime))) return dayAndTime(before, startTime);
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
