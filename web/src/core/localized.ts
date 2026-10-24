// Time zones (spec: PL-020): a timed start or due date is a moment, written as the wall clock
// where it was set. Shown somewhere else (travel, a shared list across zones), it moves to that
// wall clock; all-day dates are the same day everywhere and never move.

import { shiftZone } from './dates.ts';
import type { Due, Schedule, Task, WorkspaceFile } from './types.ts';

function scheduleIn(schedule: Schedule | null, zone: string): Schedule | null {
  if (!schedule || schedule.allDay || schedule.timeZone === zone) return schedule;
  return {
    ...schedule,
    start: shiftZone(schedule.start, schedule.timeZone, zone),
    end: schedule.end ? shiftZone(schedule.end, schedule.timeZone, zone) : null,
    timeZone: zone,
  };
}

function dueIn(due: Due | null, zone: string): Due | null {
  if (!due || due.allDay || due.timeZone === zone) return due;
  return { ...due, at: shiftZone(due.at, due.timeZone, zone), timeZone: zone };
}

/** A task with its timed dates on `zone`'s wall clock (the same object when nothing moves). */
export function localized(task: Task, zone: string): Task {
  const schedule = scheduleIn(task.schedule, zone);
  const due = dueIn(task.due, zone);
  return schedule === task.schedule && due === task.due ? task : { ...task, schedule, due };
}

const cache = new WeakMap<WorkspaceFile, { zone: string; result: WorkspaceFile }>();

/**
 * The workspace as seen in `zone`: what views, filters and date states read. The same object when
 * no task's dates move (the usual case), and worked out once per workspace.
 */
export function localizedWorkspace(workspace: WorkspaceFile, zone: string): WorkspaceFile {
  const hit = cache.get(workspace);
  if (hit && hit.zone === zone) return hit.result;
  let changed = false;
  const tasks = workspace.entities.tasks.map((task) => {
    const shown = localized(task, zone);
    if (shown !== task) changed = true;
    return shown;
  });
  const result = changed ? { ...workspace, entities: { ...workspace.entities, tasks } } : workspace;
  cache.set(workspace, { zone, result });
  return result;
}
