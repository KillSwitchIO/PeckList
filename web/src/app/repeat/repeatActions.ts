// Deleting a task, or changing its date, with a repeating task's question first (thisOrAll):
// just the date shown, or the whole series. Shared by the details, the task menu, a swipe and
// the keyboard, so every way of doing it asks the same.

import {
  addDays,
  datePart,
  daysBetween,
  localTimeZone,
  timePart,
  todayIn,
} from '../../core/dates.ts';
import { detachOccurrence, skipOccurrence } from '../../core/occurrences.ts';
import { advance, parseRule } from '../../core/recurrence.ts';
import { deleteTask, updateTask } from '../../core/tasks.ts';
import type { Id, Schedule, Task } from '../../core/types.ts';
import { formatDay } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import type { useApply } from '../store/hooks.ts';
import { askThisOrAll, asksThisOrAll, shownOccurrence } from './thisOrAll.ts';

type Apply = ReturnType<typeof useApply>;

const dayOf = (date: string) => formatDay(date, todayIn(localTimeZone(), Date.now()));

/**
 * Delete a task. A repeating one asks: just the date shown (`on`, or its own date; the series
 * goes on without it), or all of it. Resolves to whether anything was deleted.
 */
export async function deleteAsking(
  apply: Apply,
  task: Task,
  on: string | null = null,
): Promise<boolean> {
  const date = asksThisOrAll(task) ? shownOccurrence(task, on) : null;
  if (!date) {
    apply((ctx, ws) => deleteTask(ctx, ws, task.id), t('undo.deleted'));
    return true;
  }
  const day = dayOf(date);
  const choice = await askThisOrAll({
    title: t('thisOrAll.deleteTitle'),
    message: t('thisOrAll.deleteMessage', { title: task.title || t('task.untitled'), day }),
    thisLabel: t('thisOrAll.deleteThis', { day }),
    allLabel: t('thisOrAll.deleteAll'),
  });
  if (choice === 'all') apply((ctx, ws) => deleteTask(ctx, ws, task.id), t('undo.deleted'));
  if (choice === 'this') {
    const current = datePart(task.schedule?.start ?? task.due!.at);
    const rule = parseRule(task.recurrence)!;
    // The last one of the series: deleting it deletes the task.
    const last = date === current && !advance(rule, current, current);
    apply(
      (ctx, ws) => (last ? deleteTask(ctx, ws, task.id) : skipOccurrence(ctx, ws, task.id, date)),
      t('undo.occurrenceDeleted', { day }),
    );
  }
  return choice !== null;
}

/** A schedule moved by `days`, times kept. */
function moved(schedule: Schedule, days: number): Schedule {
  const shift = (value: string) => {
    const time = timePart(value);
    const date = addDays(datePart(value), days);
    return time ? `${date}T${time}` : date;
  };
  return {
    ...schedule,
    start: shift(schedule.start),
    end: schedule.end ? shift(schedule.end) : null,
  };
}

/**
 * Give a task a new date. A repeating one asks: move just the date shown (it becomes a task of
 * its own on the new date, and the series skips the old one), or all of them (the series moves
 * by as many days). Resolves to the task to show afterwards (the new one, for just this date),
 * or null when nothing changed.
 */
export async function scheduleAsking(
  apply: Apply,
  task: Task,
  schedule: Schedule | null,
  on: string | null = null,
): Promise<Id | null> {
  const date = schedule && task.schedule && asksThisOrAll(task) ? shownOccurrence(task, on) : null;
  if (!date || !schedule || !task.schedule) {
    apply((ctx, ws) => updateTask(ctx, ws, task.id, { schedule }));
    return task.id;
  }
  const day = dayOf(date);
  const choice = await askThisOrAll({
    title: t('thisOrAll.moveTitle'),
    message: t('thisOrAll.moveMessage', {
      title: task.title || t('task.untitled'),
      day,
      to: dayOf(datePart(schedule.start)),
    }),
    thisLabel: t('thisOrAll.moveThis', { day }),
    allLabel: t('thisOrAll.moveAll'),
  });
  if (choice === 'all') {
    // Picked for the date shown: the series' own date moves as many days.
    const current = datePart(task.schedule.start);
    const series = moved(schedule, -daysBetween(current, date));
    apply((ctx, ws) => updateTask(ctx, ws, task.id, { schedule: series }), t('undo.seriesMoved'));
    return task.id;
  }
  if (choice === 'this') {
    let made: Id | null = null;
    apply(
      (ctx, ws) => {
        const detached = detachOccurrence(ctx, ws, task.id, date, { schedule });
        made = detached?.task.id ?? null;
        return detached?.workspace ?? ws;
      },
      t('undo.occurrenceMoved', { day }),
    );
    return made;
  }
  return null;
}
