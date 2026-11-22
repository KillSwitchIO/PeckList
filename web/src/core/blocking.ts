// Blocked-by links (spec: PL-055): a task can't start until the tasks it waits on are finished.
// The link lives on the waiting task, `blockedBy`, a set of the ids it waits on. The server sends
// each person only what they may see, so an id this device doesn't hold is a task they cannot see:
// counted, never named. A link to a task in the trash stays stored and shows again once the task
// is restored; a purged task is gone, and so is any link to it. Both have a deletedAt, so "live"
// (deletedAt null) is the one test the walks need; neither is ever shown.

import { getEntity } from './collections.ts';
import { datePart } from './dates.ts';
import { localized } from './localized.ts';
import { members, setElement, type OpContext } from './ops.ts';
import { updateTask } from './tasks.ts';
import type { Id, Task, WorkspaceFile } from './types.ts';

/** The tasks a task waits on: the ones this device can show, and how many it cannot. */
export interface Blockers {
  shown: Task[];
  hidden: number;
}

/** What a task waits on (live tasks only; a trashed or purged one counts as neither). */
export function blockersOf(workspace: WorkspaceFile, task: Task): Blockers {
  const shown: Task[] = [];
  let hidden = 0;
  for (const id of members(task.blockedBy)) {
    const other = getEntity(workspace, 'tasks', id);
    if (other === undefined) hidden += 1;
    else if (other.deletedAt === null && other.id !== task.id) shown.push(other);
  }
  return { shown, hidden };
}

/** The live tasks waiting on `task` (what it blocks). */
export function blockedByTask(workspace: WorkspaceFile, task: Task): Task[] {
  return workspace.entities.tasks.filter(
    (other) =>
      other.deletedAt === null && other.id !== task.id && other.blockedBy[task.id]?.in === true,
  );
}

/**
 * The blockers still open, for the chain mark: it shows until each is done or won't do. Ones this
 * device can't see aren't counted, since it can't know when they are done (the details show them).
 */
export function waitingOn(workspace: WorkspaceFile, task: Task): Task[] {
  if (task.status !== 'open') return [];
  return blockersOf(workspace, task).shown.filter((other) => other.status === 'open');
}

/**
 * Whether `blockedId` waiting on `blockerId` would make a loop: the same task, or the blocker
 * already waits on it, directly or down the chain. Walks what this device holds; a loop through a
 * task it can't see goes unnoticed here, and every walk keeps a visited set for that reason (and
 * for two devices merging links that make one).
 */
export function wouldLoop(workspace: WorkspaceFile, blockedId: Id, blockerId: Id): boolean {
  if (blockedId === blockerId) return true;
  const seen = new Set<Id>();
  const next: Id[] = [blockerId];
  while (next.length > 0) {
    const id = next.pop()!;
    if (id === blockedId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const task = getEntity(workspace, 'tasks', id);
    if (task) next.push(...members(task.blockedBy));
  }
  return false;
}

/** Where a task sits in time: its schedule, or its due date when it has no schedule. */
function span(task: Task): { start: string; end: string } | null {
  if (task.schedule) {
    const { start, end } = task.schedule;
    return { start, end: end && end > start ? end : start };
  }
  return task.due ? { start: task.due.at, end: task.due.at } : null;
}

const hasTime = (value: string) => value.length > 10;

/**
 * Whether `blocked` starts before `blocker` ends (the red arrow and the warning). Counted in days
 * on the wall clock of `zone`, the viewer's, as the views show them (a timed date set in another
 * zone moves there first): starting the day the blocker ends is fine, unless both have a time that
 * day, then the times decide. Either one without a date: no conflict.
 */
export function startsTooSoon(blocked: Task, blocker: Task, zone: string): boolean {
  const waiting = span(localized(blocked, zone));
  const first = span(localized(blocker, zone));
  if (!waiting || !first) return false;
  const startDay = datePart(waiting.start);
  const endDay = datePart(first.end);
  if (startDay !== endDay) return startDay < endDay;
  return hasTime(waiting.start) && hasTime(first.end) && waiting.start < first.end;
}

/** The shown blockers `blocked` starts too soon after. */
export function conflictsOf(workspace: WorkspaceFile, blocked: Task, zone: string): Task[] {
  return blockersOf(workspace, blocked).shown.filter((blocker) =>
    startsTooSoon(blocked, blocker, zone),
  );
}

/** Make `blockedId` wait on `blockerId`. A link that would make a loop is refused (no change). */
export function addBlocker(
  ctx: OpContext,
  workspace: WorkspaceFile,
  blockedId: Id,
  blockerId: Id,
): WorkspaceFile {
  if (wouldLoop(workspace, blockedId, blockerId)) return workspace;
  const task = getEntity(workspace, 'tasks', blockedId);
  if (!task || task.blockedBy[blockerId]?.in === true) return workspace;
  return updateTask(ctx, workspace, blockedId, {
    blockedBy: setElement(ctx, task.blockedBy, blockerId, true),
  });
}

/** Stop `blockedId` waiting on `blockerId`. */
export function removeBlocker(
  ctx: OpContext,
  workspace: WorkspaceFile,
  blockedId: Id,
  blockerId: Id,
): WorkspaceFile {
  const task = getEntity(workspace, 'tasks', blockedId);
  if (!task || task.blockedBy[blockerId]?.in !== true) return workspace;
  return updateTask(ctx, workspace, blockedId, {
    blockedBy: setElement(ctx, task.blockedBy, blockerId, false),
  });
}
