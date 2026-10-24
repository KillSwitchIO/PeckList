// Reminders (spec: PL-061): when each fires, and whose it is. A reminder is minutes before the
// task's date (its start, else its due date; an all-day date counts from 9:00 that day) or a set
// local date-time. Delivery is the app's job (app/reminders); this is plain data in, data out.

import { isLive } from './collections.ts';
import { datePart, instantOf, timePart } from './dates.ts';
import { groupMembersOf } from './groups.ts';
import { assigneesOf } from './sharing.ts';
import type { Id, Reminder, Task, WorkspaceFile } from './types.ts';

/** When an all-day task's reminders count from. */
export const ALL_DAY_REMINDER_TIME = '09:00';

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
  taskId: Id;
  title: string;
  at: number;
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
      const at = reminderInstant(task, reminder, timeZone);
      if (at === null || at < from || at >= to) continue;
      found.push({ key: `${task.id}@${at}`, taskId: task.id, title: task.title, at });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** The same reminder twice is one. */
export function sameReminder(a: Reminder, b: Reminder): boolean {
  return 'at' in a ? 'at' in b && a.at === b.at : 'before' in b && a.before === b.before;
}
