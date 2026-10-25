// Adding an imported plan to the workspace (spec: PL-063), as one change: lists (new ones, or the
// ones of the same name when asked), tags found or made by name, then tasks parents first, each
// in its list's order, closed ones closed as they were. Replacing first moves what I have to the
// Trash (my lists, the Mess Drawer's tasks, my tags; shared lists of others stay), in the same
// change, so one undo brings it all back.

import { COLOR_FAMILIES } from '../palette.ts';
import { isLive, putEntity } from '../collections.ts';
import { createList, deleteList, inboxList } from '../lists.ts';
import { myRole } from '../sharing.ts';
import type { OpContext } from '../ops.ts';
import { parseRule } from '../recurrence.ts';
import { createTag, deleteTag, findTagByName } from '../tags.ts';
import { createTask, deleteTask, MAX_SUBTASK_DEPTH, updateTask } from '../tasks.ts';
import type { Id, WorkspaceFile } from '../types.ts';
import type { ImportedTask, ImportNote, ImportPlan } from './model.ts';

export interface ImportOptions {
  /** Add to what is here, or put what is here in the Trash first */
  mode?: 'merge' | 'replace';
  /** Merging: lists named like one already here go into it, rather than a new list beside it */
  intoSameNamed: boolean;
}

export interface ImportOutcome {
  workspace: WorkspaceFile;
  lists: number;
  tasks: number;
  tags: number;
  /** What replacing put in the Trash */
  trashed: { lists: number; tasks: number; tags: number };
}

/** What replacing would put in the Trash: my lists (with their tasks), the Mess Drawer's, my tags. */
export function replaceable(workspace: WorkspaceFile, me: Id) {
  const lists = workspace.entities.lists.filter(
    (list) => isLive(list) && !list.isInbox && myRole(workspace, me, list.id) === 'owner',
  );
  const listIds = new Set(lists.map((list) => list.id));
  const inbox = inboxList(workspace).id;
  const tasks = workspace.entities.tasks.filter(
    (task) => isLive(task) && (listIds.has(task.listId) || task.listId === inbox),
  );
  const tags = workspace.entities.tags.filter((tag) => isLive(tag) && tag.createdBy === me);
  return { lists, tasks, tags };
}

/** Everything replaceable() names, in the Trash (an import's Replace, and Settings' Start over). */
export function trashMine(ctx: OpContext, workspace: WorkspaceFile) {
  const doomed = replaceable(workspace, ctx.userId);
  let ws = workspace;
  for (const list of doomed.lists) ws = deleteList(ctx, ws, list.id);
  const inbox = inboxList(ws).id;
  for (const task of ws.entities.tasks.filter(
    (each) => isLive(each) && each.listId === inbox && each.parentId === null,
  )) {
    ws = deleteTask(ctx, ws, task.id);
  }
  for (const tag of doomed.tags) {
    const current = ws.entities.tags.find((each) => each.id === tag.id);
    if (current && isLive(current)) ws = deleteTag(ctx, ws, tag.id);
  }
  return {
    workspace: ws,
    trashed: { lists: doomed.lists.length, tasks: doomed.tasks.length, tags: doomed.tags.length },
  };
}

/** A color for a new list: the families' middle tones, in turn. */
const colorFor = (index: number) => {
  const swatches = COLOR_FAMILIES.find((each) => each.id === 'muted')!.colors;
  return swatches[index % swatches.length]!.hex;
};

/** Each task's depth under its parents within the plan (0 for top level). */
function depths(tasks: readonly ImportedTask[]): Map<string, number> {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const found = new Map<string, number>();
  const depthOf = (task: ImportedTask, seen: Set<string>): number => {
    const known = found.get(task.key);
    if (known !== undefined) return known;
    const parent = task.parentKey ? byKey.get(task.parentKey) : undefined;
    // A parent missing from the file, or a loop: top level.
    const depth =
      parent && !seen.has(parent.key) ? depthOf(parent, new Set(seen).add(task.key)) + 1 : 0;
    found.set(task.key, depth);
    return depth;
  };
  for (const task of tasks) depthOf(task, new Set());
  return found;
}

/**
 * Each task's status as it lands: its own, but closed with its nearest closed ancestor when it is
 * open under one (TickTick keeps a done checklist's unticked items; done means all of it).
 */
function statuses(tasks: readonly ImportedTask[]) {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const found = new Map<string, Pick<ImportedTask, 'status' | 'completedAt'>>();
  const statusOf = (
    task: ImportedTask,
    seen: Set<string>,
  ): Pick<ImportedTask, 'status' | 'completedAt'> => {
    const known = found.get(task.key);
    if (known) return known;
    let result: Pick<ImportedTask, 'status' | 'completedAt'> = {
      status: task.status,
      completedAt: task.completedAt ?? null,
    };
    const parent = task.parentKey ? byKey.get(task.parentKey) : undefined;
    if (task.status === 'open' && parent && !seen.has(parent.key)) {
      const above = statusOf(parent, new Set(seen).add(task.key));
      if (above.status !== 'open') result = above;
    }
    found.set(task.key, result);
    return result;
  };
  for (const task of tasks) statusOf(task, new Set());
  return found;
}

/** A title for a task that has none: its notes' first line. */
const titleOf = (task: ImportedTask) =>
  task.title.trim() ||
  (task.notes ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?/, '').trim())
    .find(Boolean)
    ?.slice(0, 200) ||
  'Untitled';

export function applyImport(
  ctx: OpContext,
  workspace: WorkspaceFile,
  plan: ImportPlan,
  options: ImportOptions,
): ImportOutcome {
  const replacing = options.mode === 'replace';
  const cleared = replacing ? trashMine(ctx, workspace) : null;
  let ws = cleared?.workspace ?? workspace;
  let lists = 0;
  let tags = 0;
  const listIds = new Map<string, Id>();
  const existing = ws.entities.lists.filter((list) => !list.deletedAt && !list.isInbox);
  plan.lists.forEach((each, index) => {
    if (each.inbox) {
      listIds.set(each.key, inboxList(ws).id);
      return;
    }
    const same =
      options.intoSameNamed && !replacing
        ? existing.find((list) => list.name.trim().toLowerCase() === each.name.trim().toLowerCase())
        : undefined;
    if (same) {
      listIds.set(each.key, same.id);
      return;
    }
    const made = createList(ctx, ws, {
      name: each.name.trim() || 'Imported',
      color: each.color ?? colorFor(index),
    });
    ws = made.workspace;
    listIds.set(each.key, made.list.id);
    lists += 1;
  });

  const tagIds = new Map<string, Id>();
  const tagId = (name: string): Id | null => {
    const clean = name.trim().replace(/^#/, '');
    if (!clean) return null;
    const key = clean.toLowerCase();
    const known = tagIds.get(key);
    if (known) return known;
    const found = findTagByName(ws, clean);
    if (found) {
      tagIds.set(key, found.id);
      return found.id;
    }
    const made = createTag(ctx, ws, clean);
    ws = made.workspace;
    tags += 1;
    tagIds.set(key, made.tag.id);
    return made.tag.id;
  };

  // Parents before their subtasks; each list's own order kept among equals.
  const depth = depths(plan.tasks);
  const ordered = [...plan.tasks].sort((a, b) => depth.get(a.key)! - depth.get(b.key)!);
  const taskIds = new Map<string, Id>();
  const levels = new Map<string, number>();
  const fallback = inboxList(ws).id;
  const closed = statuses(plan.tasks);
  for (const task of ordered) {
    let parentKey = task.parentKey ?? null;
    // Deeper than Punchlist nests: under the deepest one it can go under.
    while (parentKey && (levels.get(parentKey) ?? 0) >= MAX_SUBTASK_DEPTH) {
      parentKey = plan.tasks.find((each) => each.key === parentKey)?.parentKey ?? null;
    }
    const parentId = parentKey ? taskIds.get(parentKey) : undefined;
    const recurrence = task.recurrence && parseRule(task.recurrence) ? task.recurrence : null;
    // Tags first: making one changes `ws`, which createTask must see.
    const taskTags = (task.tags ?? []).map(tagId).filter((id): id is Id => id !== null);
    const made = createTask(ctx, ws, {
      title: titleOf(task),
      listId: listIds.get(task.listKey) ?? fallback,
      ...(parentId ? { parentId } : {}),
      notes: task.notes ?? '',
      priority: task.priority,
      schedule: task.schedule ?? null,
      due: task.due ?? null,
      tags: taskTags,
      ...(task.reminders?.length ? { reminders: task.reminders } : {}),
      recurrence,
    });
    ws = made.workspace;
    // Made when the other app made it, not now.
    if (task.createdAt && !Number.isNaN(Date.parse(task.createdAt))) {
      ws = putEntity(ws, 'tasks', {
        ...made.task,
        createdAt: new Date(Date.parse(task.createdAt)).toISOString(),
      });
    }
    taskIds.set(task.key, made.task.id);
    levels.set(task.key, parentId ? (levels.get(parentKey!) ?? 0) + 1 : 0);
    const landed = closed.get(task.key)!;
    if (landed.status !== 'open') {
      // Closed as it was (not through completing, which would start a repeat's next one).
      ws = updateTask(ctx, ws, made.task.id, {
        status: landed.status,
        completedAt: landed.completedAt ?? new Date().toISOString(),
        completedBy: ctx.userId,
      });
    }
  }
  return {
    workspace: ws,
    lists,
    tasks: taskIds.size,
    tags,
    trashed: cleared?.trashed ?? { lists: 0, tasks: 0, tags: 0 },
  };
}

/** What a plan holds, for the preview: lists, tasks (open and closed), tag names, and notes. */
export function planSummary(plan: ImportPlan) {
  const depth = depths(plan.tasks);
  const notes: Partial<Record<ImportNote, number>> = { ...plan.notes };
  const add = (what: ImportNote) => {
    notes[what] = (notes[what] ?? 0) + 1;
  };
  for (const task of plan.tasks) {
    if (depth.get(task.key)! > MAX_SUBTASK_DEPTH) add('tooDeep');
    if (task.recurrence && !parseRule(task.recurrence)) add('repeatDropped');
  }
  const closed = statuses(plan.tasks);
  const tags = new Set(
    plan.tasks.flatMap((task) => (task.tags ?? []).map((tag) => tag.toLowerCase())),
  );
  return {
    lists: plan.lists.length,
    open: plan.tasks.filter((task) => closed.get(task.key)!.status === 'open').length,
    closed: plan.tasks.filter((task) => closed.get(task.key)!.status !== 'open').length,
    tags: tags.size,
    notes,
  };
}
