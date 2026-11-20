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

/** The date a task's reminders count from (its start, else its due date), with the zone it was written on. */
function datedOf(task: Task): { at: string; zone: string | null | undefined } | null {
  if (task.schedule?.start) return { at: task.schedule.start, zone: task.schedule.timeZone };
  if (task.due?.at) return { at: task.due.at, zone: task.due.timeZone };
  return null;
}

/**
 * When a reminder fires (ms since the epoch), or null when it has nothing to count from. A timed
 * date is a moment on its own zone's clock (PL-020), so a reminder counted from it is read there,
 * as the server does for a push and the Android check-in: read on `timeZone` instead, a task
 * written in UTC and seen from Chicago reminded 6 hours late there (0.13.0-rc.2). A whole day
 * reminds from 9:00 on `timeZone`, and a set time is on `timeZone`'s clock, as the server reads
 * both where the person is.
 */
export function reminderInstant(task: Task, reminder: Reminder, timeZone: string): number | null {
  if ('at' in reminder) {
    const time = timePart(reminder.at) ?? ALL_DAY_REMINDER_TIME;
    return Date.parse(instantOf(datePart(reminder.at), time, timeZone));
  }
  const dated = datedOf(task);
  if (!dated) return null;
  const time = timePart(dated.at);
  const before = reminder.before * 60_000;
  if (time !== null && dated.zone && dated.zone !== timeZone) {
    try {
      return Date.parse(instantOf(datePart(dated.at), time, dated.zone)) - before;
    } catch {
      // A zone this browser does not know: on `timeZone`, as the server reads one it does not know.
    }
  }
  return (
    Date.parse(instantOf(datePart(dated.at), time ?? ALL_DAY_REMINDER_TIME, timeZone)) - before
  );
}

/**
 * The first moment the task's current occurrence reminds (ms since the epoch): the earliest of its
 * reminders counted from its date, or a set time before that. Null when none counts from its date
 * (no date, or only set times, which do not move with it). The server's OccurrenceStart.
 */
export function occurrenceStart(task: Task, timeZone: string): number | null {
  let fromDate: number | null = null;
  let setTime: number | null = null;
  for (const reminder of task.reminders ?? []) {
    const when = reminderInstant(task, reminder, timeZone);
    if (when === null || Number.isNaN(when)) continue;
    if ('at' in reminder) setTime = setTime === null ? when : Math.min(setTime, when);
    else fromDate = fromDate === null ? when : Math.min(fromDate, when);
  }
  if (fromDate === null) return null;
  return setTime !== null && setTime < fromDate ? setTime : fromDate;
}

/**
 * Whether a press of the reminder that first came at `first` is for an occurrence already gone (a
 * repeating task completed and moved on, a task put on a later date): more than a minute before the
 * current occurrence's first reminder, as the server reads it (Dev 2's review of the web reminder's
 * Complete). `first` 0 names no reminder, so it is about the task as it is.
 */
export function occurrenceGone(task: Task, first: number, timeZone: string): boolean {
  if (first <= 0) return false;
  const start = occurrenceStart(task, timeZone);
  return start !== null && first < start - 60_000;
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

/**
 * A constant reminder comes again this often, this many times in all (30 minutes, PL-115), where
 * the notification cannot keep sounding by itself; the Android app makes it insistent instead.
 */
export const CONSTANT_EVERY_MINUTES = 5;
export const CONSTANT_TIMES = 6;

/**
 * A reminder as days early and a time that day (spec: R-FB-60): `before` counts from `from` on
 * the task's day (9:00 for an all-day task, else its start time), so later that day is negative.
 */
export function allDayParts(
  before: number,
  from: string = ALL_DAY_REMINDER_TIME,
): { days: number; time: string } {
  const [h, m] = from.split(':').map(Number) as [number, number];
  const fromMidnight = h * 60 + m - before;
  const days = fromMidnight >= 0 ? 0 : Math.ceil(-fromMidnight / 1440);
  const minutes = fromMidnight + days * 1440;
  const two = (n: number) => String(n).padStart(2, '0');
  return { days, time: `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}` };
}

/**
 * The reminder `days` early at `time` ("HH:mm"), counted from `from`: 9:00 for an all-day task,
 * a timed task's own start time ("60 days early at 16:00", R-FB-91).
 */
export function allDayReminder(
  days: number,
  time: string,
  from: string = ALL_DAY_REMINDER_TIME,
): Reminder {
  const [h, m] = from.split(':').map(Number) as [number, number];
  const [th, tm] = time.split(':').map(Number) as [number, number];
  return { before: days * 1440 + (h * 60 + m) - (th * 60 + tm) };
}

/**
 * A reminder this person snoozed from a notification on a server (audit B3): it comes again for
 * them alone at `at` (ms since the epoch). The server keeps it apart from the task, so nobody
 * else on the task gets it.
 */
export interface Snooze {
  taskId: Id;
  at: number;
  /**
   * The occurrence the snooze is for ({@link occurrenceOf} when it was snoozed). Absent or null
   * from an older server, and on a task with no date: any.
   */
  occurrence?: string | null;
  /**
   * The reminder it was pressed on, by its first time (0.14.0): the task's own, or an earlier
   * snooze's. That one is put off by it. Absent from an older server, or a press that named none.
   */
  first?: number | null;
}

/**
 * The occurrence a snooze is for: the moment the task's reminders count from (its start, else its
 * due date), as the server keeps it. A timed date is a moment, and this app shows it on the
 * viewer's clock (localized), not the clock it was written on, so it is compared as UTC
 * ("YYYY-MM-DDTHH:mmZ"); a whole day is the same date everywhere.
 *
 * Where this and the server could read a time apart (a time in the hour the clocks repeat or skip,
 * a zone only one of them knows), the two differ and this app drops the snooze: it then still comes
 * as a push or from the Android check-in, which use the server's own reading. Rare by design.
 */
export function occurrenceOf(task: Task): string | null {
  const dated = datedOf(task);
  if (!dated) return null;
  const time = timePart(dated.at);
  if (time === null || !dated.zone) return dated.at;
  try {
    return `${instantOf(datePart(dated.at), time, dated.zone).slice(0, 16)}Z`;
  } catch {
    // A zone this browser does not know: as written, as the server keeps it then.
    return dated.at;
  }
}

/**
 * Whether a snooze still comes back (Ben, 0.13.0-rc.2): the task still has a reminder, and is on
 * the occurrence that was snoozed. Completing a repeating task here moves it on at once, before the
 * server hears, and its next date must not get the last one's snooze; nor does a task moved to
 * another date, or whose reminders were taken off. (Open and mine is checked apart.)
 */
export function snoozeHolds(task: Task, snooze: Snooze): boolean {
  if (!task.reminders?.length) return false;
  return snooze.occurrence == null || snooze.occurrence === occurrenceOf(task);
}

/** The same list of snoozes (the app keeps what it has then, so nothing hands over again). */
export function sameSnoozes(a: readonly Snooze[], b: readonly Snooze[]): boolean {
  return (
    a.length === b.length &&
    // The occurrence too: the next one snoozed to the same minute replaces the last (rc.2). And
    // the reminder it was pressed on, which it puts off (0.14.0).
    a.every(
      (each, i) =>
        each.taskId === b[i]?.taskId &&
        each.at === b[i]?.at &&
        (each.occurrence ?? null) === (b[i]?.occurrence ?? null) &&
        (each.first ?? null) === (b[i]?.first ?? null),
    )
  );
}

/**
 * My reminders that fire in [from, to), soonest first. `snoozes` (mine, from the server) come as
 * a reminder set for their time would, while the task is open and mine and the snooze holds
 * ({@link snoozeHolds}); one at a time the task already reminds at is that reminder. A snooze puts
 * off the reminder it was pressed on (`first`: the task's own, or an earlier snooze come back), and
 * of snoozes of one reminder only the latest comes (0.14.0, as on the server): a snooze made before
 * its reminder came, or made again before the last came back, would otherwise ring twice.
 */
export function remindersBetween(
  workspace: WorkspaceFile,
  me: Id,
  from: number,
  to: number,
  timeZone: string,
  snoozes: readonly Snooze[] = [],
): DueReminder[] {
  const found = new Map<string, DueReminder>();
  const add = (task: Task, first: number) => {
    const constant = task.constantReminder === true;
    const times = constant ? CONSTANT_TIMES : 1;
    for (let again = 0; again < times; again += 1) {
      const at = first + again * CONSTANT_EVERY_MINUTES * 60_000;
      if (at < from || at >= to) continue;
      const tag = `${task.id}@${first}`;
      const key = again === 0 ? tag : `${tag}#${again}`;
      found.set(key, { key, tag, taskId: task.id, title: task.title, at, constant });
    }
  };
  const mine = (task: Task | undefined): task is Task =>
    task !== undefined && isLive(task) && task.status === 'open' && remindsMe(workspace, task, me);
  // The snoozes that come: of one reminder's, the latest; those that name none each.
  const coming = new Map<string, { task: Task; snooze: Snooze }>();
  snoozes.forEach((snooze, index) => {
    const task = workspace.entities.tasks.find((each) => each.id === snooze.taskId);
    if (!mine(task) || !snoozeHolds(task, snooze)) return;
    const key = snooze.first == null ? `#${index}` : `${task.id}@${snooze.first}`;
    const before = coming.get(key);
    if (!before || snooze.at > before.snooze.at) coming.set(key, { task, snooze });
  });
  const pressed = new Map<Id, Set<number>>();
  for (const { task, snooze } of coming.values()) {
    if (snooze.first == null) continue;
    pressed.set(task.id, (pressed.get(task.id) ?? new Set()).add(snooze.first));
  }
  const putOff = (task: Task, first: number) => pressed.get(task.id)?.has(first) === true;
  for (const task of workspace.entities.tasks) {
    if (!task.reminders?.length || !mine(task)) continue;
    for (const reminder of task.reminders) {
      const first = reminderInstant(task, reminder, timeZone);
      if (first !== null && !putOff(task, first)) add(task, first);
    }
  }
  for (const { task, snooze } of coming.values()) {
    if (!putOff(task, snooze.at)) add(task, snooze.at);
  }
  return [...found.values()].sort((a, b) => a.at - b.at);
}

/** The same reminder twice is one. */
export function sameReminder(a: Reminder, b: Reminder): boolean {
  return 'at' in a ? 'at' in b && a.at === b.at : 'before' in b && a.before === b.before;
}

/** The most reminders a task keeps (the schema's limit). */
export const MAX_REMINDERS = 10;

/** How long Snooze puts a constant reminder off. */
export const SNOOZE_MINUTES = 10;

/**
 * Snooze (spec: R-FB-70) with no server: the task gets a one-time reminder at `at` (local
 * "YYYY-MM-DDTHH:mm"), and set times already past (earlier snoozes) go, so they do not pile up.
 * On a server a snooze is the person's own instead ({@link Snooze}), and the task stays as it is.
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
