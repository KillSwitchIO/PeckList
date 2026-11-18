// What got done, day by day (spec: PL-144): the Completed page's heatmap and totals, and the
// calendar's "Show completed".

import { heatScale, weekStartOf, type HeatScale } from './calendarLayout.ts';
import { addDays, daysBetween, localDayOf, monthOf } from './dates.ts';
import { purgeDaysOf } from './settings.ts';
import { isPurged } from './trash.ts';
import type { Id, Task, WorkspaceFile } from './types.ts';

/**
 * Whether a task counts as done on the day it was completed: done (won't do does not count), a
 * task rather than a subtask (completing a task completes its subtasks with it), and still on the
 * device. Done tasks the keep setting moved to the Trash still count, for they were done; erased
 * ones are gone. Each completed time of a repeating task is a closed copy of its own (PL-060), so
 * each counts.
 */
export function countsAsDone(task: Task): boolean {
  return (
    task.status === 'done' && task.completedAt !== null && task.parentId === null && !isPurged(task)
  );
}

/** Done tasks per local day (`YYYY-MM-DD` to a count), optionally only those one person completed. */
export function doneByDay(
  tasks: readonly Task[],
  timeZone: string,
  completedBy?: Id | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (!countsAsDone(task)) continue;
    if (completedBy && task.completedBy !== completedBy) continue;
    const day = localDayOf(task.completedAt!, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

export interface DoneTotals {
  today: number;
  week: number;
  month: number;
  /** Days in a row with something done, up to today (or up to yesterday while today has none yet) */
  streak: number;
}

/** The totals over a day's counts: today, this week (from `weekStart`, 0 Sunday), this month, the streak. */
export function doneTotals(
  counts: ReadonlyMap<string, number>,
  today: string,
  weekStart: number,
): DoneTotals {
  const weekFrom = weekStartOf(today, weekStart);
  const month = monthOf(today);
  let week = 0;
  let inMonth = 0;
  for (const [day, count] of counts) {
    if (day > today) continue;
    if (day >= weekFrom) week += count;
    if (monthOf(day) === month) inMonth += count;
  }
  let streak = 0;
  let day = (counts.get(today) ?? 0) > 0 ? today : addDays(today, -1);
  while ((counts.get(day) ?? 0) > 0) {
    streak += 1;
    day = addDays(day, -1);
  }
  return { today: counts.get(today) ?? 0, week, month: inMonth, streak };
}

/**
 * How done days shade: split in three as the calendar's busy days are (`heatScale`), except that
 * the busiest day is always the darkest, even while only a day or two have anything done.
 */
export function doneScale(counts: Iterable<number>): HeatScale {
  const all = [...counts];
  const scale = heatScale(all);
  const most = Math.max(0, ...all);
  if (most === 0 || scale.some < most) return scale;
  const some = most - 1;
  return { few: Math.min(scale.few, some), some };
}

/** The fewest and most weeks the heatmap shows: a quarter, and a year. */
export const HEAT_MIN_WEEKS = 13;
export const HEAT_MAX_WEEKS = 53;

/**
 * The weeks the heatmap spans: as far back as completed tasks can still be on the device. They go
 * to the Trash after the person's keep time and are erased as long after that, so twice that time,
 * at least a quarter and at most a year.
 */
export function heatWeeks(workspace: WorkspaceFile): number {
  const days = purgeDaysOf(workspace) * 2;
  return Math.min(HEAT_MAX_WEEKS, Math.max(HEAT_MIN_WEEKS, Math.ceil(days / 7) + 1));
}

/**
 * The heatmap's columns: `weeks` weeks of seven days each, oldest first, the last one holding
 * `today`. Days after today are left out of the last week (null).
 */
export function heatColumns(today: string, weeks: number, weekStart: number): (string | null)[][] {
  const last = weekStartOf(today, weekStart);
  const first = addDays(last, -7 * (weeks - 1));
  const columns: (string | null)[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const from = addDays(first, week * 7);
    columns.push(
      Array.from({ length: 7 }, (_, index) => {
        const day = addDays(from, index);
        return daysBetween(day, today) < 0 ? null : day;
      }),
    );
  }
  return columns;
}
