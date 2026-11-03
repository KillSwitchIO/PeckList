// Adding an imported plan to the workspace (spec: PL-063), as one change: lists (new ones, or the
// ones of the same name when asked), tags found or made by name, then tasks parents first, each
// in its list's order, closed ones closed as they were. Replacing first moves what I have to the
// Trash (my lists, the Mess Drawer's tasks, my tags; shared lists of others stay), in the same
// change, so one undo brings it all back. Merging the same file again adds only what is not here
// yet (`alreadyHere`).

import { COLOR_FAMILIES } from '../palette.ts';
import { MAX_REMINDERS } from '../reminders.ts';
import { isLive, putEntity } from '../collections.ts';
import { createList, deleteList, inboxList } from '../lists.ts';
import { myRole } from '../sharing.ts';
import type { OpContext } from '../ops.ts';
import { parseRule } from '../recurrence.ts';
import { createTag, deleteTag, findTagByName, normalizeTagName } from '../tags.ts';
import { createTask, deleteTask, MAX_SUBTASK_DEPTH, updateTask } from '../tasks.ts';
import type { Id, Task, WorkspaceFile } from '../types.ts';
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
  /** Tasks left out because an earlier import already brought them */
  skipped: number;
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

/** The lists already here that a plan's lists go into (its inbox, and same-named ones if asked). */
function existingTargets(
  workspace: WorkspaceFile,
  plan: ImportPlan,
  options: ImportOptions,
): Map<string, Id> {
  const replacing = options.mode === 'replace';
  const targets = new Map<string, Id>();
  const existing = workspace.entities.lists.filter((list) => !list.deletedAt && !list.isInbox);
  for (const each of plan.lists) {
    if (each.inbox) {
      targets.set(each.key, inboxList(workspace).id);
      continue;
    }
    const same =
      options.intoSameNamed && !replacing
        ? existing.find((list) => list.name.trim().toLowerCase() === each.name.trim().toLowerCase())
        : undefined;
    if (same) targets.set(each.key, same.id);
  }
  return targets;
}

/** The task a task lands under, by key: its parent, or the deepest ancestor PeckList nests under. */
function landingParent(
  task: ImportedTask,
  byKey: ReadonlyMap<string, ImportedTask>,
  depth: ReadonlyMap<string, number>,
): string | null {
  let parentKey = task.parentKey && byKey.has(task.parentKey) ? task.parentKey : null;
  while (parentKey && (depth.get(parentKey) ?? 0) >= MAX_SUBTASK_DEPTH) {
    parentKey = byKey.get(parentKey)?.parentKey ?? null;
  }
  return parentKey;
}

/** A title as matching compares it: case and spacing aside. */
const matchTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

/** An instant as tasks keep it, or null. */
const isoOrNull = (value: string | null | undefined) =>
  value && !Number.isNaN(Date.parse(value)) ? new Date(Date.parse(value)).toISOString() : null;

/**
 * The plan's tasks that are already here (an earlier import of the same file), by key, with the
 * task each one is. A task is here when a live one sits in the list it would land in, under the
 * parent it would land under (itself here), with the same title and, when the file says when it
 * was made, made then. Each task here stands for one in the file, so two of a name are two.
 * Replacing finds none (what is here goes to the Trash first).
 */
export function alreadyHere(
  workspace: WorkspaceFile,
  plan: ImportPlan,
  options: ImportOptions,
): Map<string, Id> {
  const found = new Map<string, Id>();
  if (options.mode === 'replace') return found;
  const targets = existingTargets(workspace, plan, options);
  const lists = new Set(targets.values());
  if (!lists.size) return found;
  const pool = new Map<string, Task[]>();
  for (const task of workspace.entities.tasks) {
    if (!isLive(task) || !lists.has(task.listId)) continue;
    const key = `${task.listId}|${task.parentId ?? ''}|${matchTitle(task.title)}`;
    const bucket = pool.get(key);
    if (bucket) bucket.push(task);
    else pool.set(key, [task]);
  }
  const byKey = new Map(plan.tasks.map((task) => [task.key, task]));
  const depth = depths(plan.tasks);
  const ordered = [...plan.tasks].sort((a, b) => depth.get(a.key)! - depth.get(b.key)!);
  for (const task of ordered) {
    const listId = targets.get(task.listKey);
    if (!listId) continue;
    const parentKey = landingParent(task, byKey, depth);
    const parentId = parentKey ? found.get(parentKey) : null;
    // Under a parent that is new, it is new too.
    if (parentId === undefined) continue;
    const bucket = pool.get(`${listId}|${parentId ?? ''}|${matchTitle(titleOf(task))}`);
    if (!bucket?.length) continue;
    const made = isoOrNull(task.createdAt);
    const index = made ? bucket.findIndex((each) => each.createdAt === made) : 0;
    if (index < 0) continue;
    found.set(task.key, bucket[index]!.id);
    bucket.splice(index, 1);
  }
  return found;
}

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
  const tagsBefore = ws.entities.tags.filter(isLive).length;
  const targets = existingTargets(ws, plan, options);
  // What an earlier import of the same file brought stays as it is, and is not added again.
  const already = alreadyHere(ws, plan, options);
  const listIds = new Map<string, Id>();
  plan.lists.forEach((each, index) => {
    const target = targets.get(each.key);
    if (target) {
      listIds.set(each.key, target);
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
    // A name of only slashes is no tag.
    if (!normalizeTagName(clean)) return null;
    const made = createTag(ctx, ws, clean);
    ws = made.workspace;
    tagIds.set(key, made.tag.id);
    return made.tag.id;
  };

  // Parents before their subtasks; each list's own order kept among equals.
  const depth = depths(plan.tasks);
  const byKey = new Map(plan.tasks.map((task) => [task.key, task]));
  const ordered = [...plan.tasks].sort((a, b) => depth.get(a.key)! - depth.get(b.key)!);
  const taskIds = new Map<string, Id>();
  const fallback = inboxList(ws).id;
  const closed = statuses(plan.tasks);
  let added = 0;
  for (const task of ordered) {
    const here = already.get(task.key);
    if (here) {
      taskIds.set(task.key, here);
      continue;
    }
    // Deeper than PeckList nests: under the deepest one it can go under.
    const parentKey = landingParent(task, byKey, depth);
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
      ...(task.reminders?.length ? { reminders: task.reminders.slice(0, MAX_REMINDERS) } : {}),
      recurrence,
    });
    ws = made.workspace;
    // Made when the other app made it, not now.
    const createdAt = isoOrNull(task.createdAt);
    if (createdAt) ws = putEntity(ws, 'tasks', { ...made.task, createdAt });
    taskIds.set(task.key, made.task.id);
    added += 1;
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
    tasks: added,
    // Nested names make their parents too.
    tags: ws.entities.tags.filter(isLive).length - tagsBefore,
    skipped: already.size,
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
    const extra = (task.reminders?.length ?? 0) - MAX_REMINDERS;
    if (extra > 0) notes.reminderDropped = (notes.reminderDropped ?? 0) + extra;
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

/**
 * Schema errors ("/entities/tasks/8/reminders must NOT have more than 10 items") as a person can
 * find them: the task, list or tag by name, then what is wrong with which field.
 */
export function describeErrors(workspace: WorkspaceFile, errors: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const error of errors) {
    const match = /^\/entities\/(tasks|lists|tags)\/(\d+)(\/\S*)?\s+(.*)$/.exec(error);
    const entity = match
      ? (workspace.entities[match[1] as 'tasks' | 'lists' | 'tags'][Number(match[2])] as
          { title?: string; name?: string } | undefined)
      : undefined;
    const name = entity?.title ?? entity?.name;
    const field = match?.[3]?.split('/').filter(Boolean)[0];
    const text =
      match && name !== undefined ? `"${name}": ${field ? `${field} ` : ''}${match[4]}` : error;
    // ajv reports one bad value several ways ("must match exactly one schema", ...): once each.
    const key = match && name !== undefined ? `${match[1]}/${match[2]}/${field ?? ''}` : error;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
