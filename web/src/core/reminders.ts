// Reminders (spec: PL-061): when each fires, and whose it is. A reminder is minutes before the
// task's date (its start, else its due date; an all-day date counts from 9:00 that day) or a set
// local date-time. Delivery is the app's job (app/reminders); this is plain data in, data out.

import { isLive, putEntity } from './collections.ts';
import { updateEntity, type OpContext } from './ops.ts';
import { datePart, instantOf, timePart } from './dates.ts';
import { groupMembersOf } from './groups.ts';
import { assigneesOf } from './sharing.ts';
import type { Id, Reminder, Task, WorkspaceFile } from './types.ts';

/**
 * When an all-day task's reminders count from. Fixed, so a reminder keeps its time; the time new
 * ones come at is the person's (allDayReminderTimeOf).
 */
export const ALL_DAY_REMINDER_TIME = '09:00';

/** The time of day new all-day reminders come at: the person's setting, else 9:00 (R-FB-83). */
export function allDayReminderTimeOf(workspace: WorkspaceFile): string {
  return workspace.entities.settings[0]?.allDayReminderTime ?? ALL_DAY_REMINDER_TIME;
}

/**
 * A reminder made for an all-day task from a choice counted from the day's start time (the quick
 * choices, the new-task reminder: "on time", "1 day early"), at the person's time instead.
 */
export function atAllDayTime(before: number, time: string): number {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number];
    return h * 60 + m;
  };
  return before + minutes(ALL_DAY_REMINDER_TIME) - minutes(time);
}

/** The picker's choices, minutes before: a timed task, and an all-day one (from 9:00). */
export const TIMED_PRESETS = [0, 5, 30, 60, 1440] as const;
export const ALL_DAY_PRESETS = [0, 1440, 2880, 10080] as const;

/** The date a task's reminders count from: its start, else its due date. */
export function reminderAnchor(task: Task): string | null {
  return task.schedule?.start ?? task.due?.at ?? null;
}

/** Whether the task's date is a whole day (so its reminders count from 9:00). */
export function remindsAllDay(task: Task): boolean {
  const anchor = reminderAnchor(task);
  return anchor !== null && timePart(anchor) === null;
}

/** When a reminder fires (ms since the epoch), or null when it has nothing to count from. */
export function reminderInstant(task: Task, reminder: Reminder, timeZone: string): number | null {
  if ('at' in reminder) {
    const time = timePart(reminder.at) ?? ALL_DAY_REMINDER_TIME;
    return Date.parse(instantOf(datePart(reminder.at), time, timeZone));
  }
  const anchor = reminderAnchor(task);
  if (!anchor) return null;
  const time = timePart(anchor) ?? ALL_DAY_REMINDER_TIME;
  return Date.parse(instantOf(datePart(anchor), time, timeZone)) - reminder.before * 60_000;
}

/**
 * Whether a task's reminders are mine: I am assigned (myself or through a group I am in), or
 * nobody is and I made it. So a shared list does not ping everyone on it.
 */
export function remindsMe(workspace: WorkspaceFile, task: Task, me: Id): boolean {
  const assignees = assigneesOf(task);
  if (assignees.length === 0) return task.createdBy === me;
  return assignees.some((principal) => {
    if (principal === `user:${me}`) return true;
    if (!principal.startsWith('group:')) return false;
    return groupMembersOf(workspace, principal.slice(6)).some(
      (member) => member.userId === me && member.state === 'active',
    );
  });
}

export interface DueReminder {
  /** Stable for one task, reminder and time: tells a fired reminder from a new one. */
  key: string;
  /** The notification's tag: a constant reminder's repeats share it, so each replaces the last */
  tag: string;
  taskId: Id;
  title: string;
  at: number;
  /** A constant reminder: it stays on screen */
  constant: boolean;
}

/** A constant reminder comes again this often, this many times in all (an hour). */
export const CONSTANT_EVERY_MINUTES = 5;
export const CONSTANT_TIMES = 12;

/**
 * An all-day task's reminder as days early and a time that day (spec: R-FB-60): `before` counts
 * from 9:00 on the task's day, so later that day is negative.
 */
export function allDayParts(before: number): { days: number; time: string } {
  const [h, m] = ALL_DAY_REMINDER_TIME.split(':').map(Number) as [number, number];
  const fromMidnight = h * 60 + m - before;
  const days = fromMidnight >= 0 ? 0 : Math.ceil(-fromMidnight / 1440);
  const minutes = fromMidnight + days * 1440;
  const two = (n: number) => String(n).padStart(2, '0');
  return { days, time: `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}` };
}

/** The reminder `days` early at `time` ("HH:mm") for an all-day task. */
export function allDayReminder(days: number, time: string): Reminder {
  const [h, m] = ALL_DAY_REMINDER_TIME.split(':').map(Number) as [number, number];
  const [th, tm] = time.split(':').map(Number) as [number, number];
  return { before: days * 1440 + (h * 60 + m) - (th * 60 + tm) };
}

/** My reminders that fire in [from, to), soonest first. */
export function remindersBetween(
  workspace: WorkspaceFile,
  me: Id,
  from: number,
  to: number,
  timeZone: string,
): DueReminder[] {
  const found: DueReminder[] = [];
  for (const task of workspace.entities.tasks) {
    if (!task.reminders?.length || !isLive(task) || task.status !== 'open') continue;
    if (!remindsMe(workspace, task, me)) continue;
    for (const reminder of task.reminders) {
      const first = reminderInstant(task, reminder, timeZone);
      if (first === null) continue;
      const constant = task.constantReminder === true;
      const times = constant ? CONSTANT_TIMES : 1;
      for (let again = 0; again < times; again += 1) {
        const at = first + again * CONSTANT_EVERY_MINUTES * 60_000;
        if (at < from || at >= to) continue;
        const tag = `${task.id}@${first}`;
        found.push({
          key: again === 0 ? tag : `${tag}#${again}`,
          tag,
          taskId: task.id,
          title: task.title,
          at,
          constant,
        });
      }
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** The same reminder twice is one. */
export function sameReminder(a: Reminder, b: Reminder): boolean {
  return 'at' in a ? 'at' in b && a.at === b.at : 'before' in b && a.before === b.before;
}

/** How long Snooze puts a constant reminder off. */
export const SNOOZE_MINUTES = 10;

/**
 * Snooze (spec: R-FB-70): the task gets a one-time reminder at `at` (local "YYYY-MM-DDTHH:mm"),
 * and set times already past (earlier snoozes) go, so they do not pile up.
 */
export function snoozeReminder(
  ctx: OpContext,
  workspace: WorkspaceFile,
  taskId: Id,
  at: string,
  now: string,
): WorkspaceFile {
  const task = workspace.entities.tasks.find((each) => each.id === taskId);
  if (!task || !isLive(task)) return workspace;
  const kept = (task.reminders ?? []).filter((each) => !('at' in each) || each.at > now);
  return putEntity(workspace, 'tasks', updateEntity(ctx, task, { reminders: [...kept, { at }] }));
}
