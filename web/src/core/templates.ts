// Templates (PL-140): a task or a whole list saved to make again. A template is a shape, not a
// live task: it never shows in views, counts, search or reminders, and its dates are relative to
// the day it is used. The rules for what a template keeps and makes live here and nowhere else.

import { isLive, putEntity, requireEntity } from './collections.ts';
import { addDays, daysBetween, datePart, joinDateTime, timePart } from './dates.ts';
import { createList } from './lists.ts';
import { createEntity, members, softDelete, updateEntity, type OpContext } from './ops.ts';
import { compareOrderKeys, keyBetween } from './ordering.ts';
import { parseRule } from './recurrence.ts';
import { MAX_REMINDERS } from './reminders.ts';
import { createTask, MAX_SUBTASK_DEPTH, siblings, taskDepth, updateTask } from './tasks.ts';
import type {
  Due,
  Id,
  LocalDateOrDateTime,
  Priority,
  Reminder,
  Schedule,
  Task,
  Template,
  TemplateDate,
  TemplateList,
  TemplateReminder,
  TemplateTask,
  WorkspaceFile,
} from './types.ts';

/** The most tasks one template holds, subtasks included: a template is a routine, not an archive. */
export const MAX_TEMPLATE_TASKS = 200;

/** The longest template name. */
export const MAX_TEMPLATE_NAME = 200;

/**
 * The most a body may weigh as JSON, in bytes: the server takes no record over 256 KB
 * (EntityChecks.MaxEntityBytes), and this leaves room for the rest of the template.
 */
export const MAX_TEMPLATE_BYTES = 200 * 1024;

/** Whether a body is small enough to keep: a long list with long notes may not be. */
export function templateFits(body: TemplateTask | TemplateList): boolean {
  return new TextEncoder().encode(JSON.stringify(body)).length <= MAX_TEMPLATE_BYTES;
}

/** The live templates, of one kind or both, in their order. */
export function templatesOf(workspace: WorkspaceFile, kind?: Template['kind']): Template[] {
  return workspace.entities.templates
    .filter((template) => isLive(template) && (kind === undefined || template.kind === kind))
    .sort((a, b) => compareOrderKeys(a.order, b.order));
}

/** For the picker: most used first, then in their order. */
export function templatesByUse(workspace: WorkspaceFile, kind: Template['kind']): Template[] {
  return templatesOf(workspace, kind)
    .map((template, at) => ({ template, at }))
    .sort((a, b) => (b.template.uses ?? 0) - (a.template.uses ?? 0) || a.at - b.at)
    .map((each) => each.template);
}

// Reading a body: it syncs as plain JSON, so it is checked on the way in, never trusted.

// A real time of day: "99:99" would make an impossible date.
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
// What a task's reminder may say (schema/task: a day before the time to a year after).
const BEFORE_MIN = -1439;
const BEFORE_MAX = 525600;

function readDate(value: unknown): TemplateDate | null {
  if (!value || typeof value !== 'object') return null;
  const { inDays, time } = value as Record<string, unknown>;
  if (typeof inDays !== 'number' || !Number.isInteger(inDays) || Math.abs(inDays) > 36500)
    return null;
  return { inDays, time: typeof time === 'string' && TIME.test(time) ? time : null };
}

function readReminder(value: unknown): TemplateReminder | null {
  if (!value || typeof value !== 'object') return null;
  const reminder = value as Record<string, unknown>;
  const { before } = reminder;
  if (typeof before === 'number' && Number.isInteger(before)) {
    return before >= BEFORE_MIN && before <= BEFORE_MAX ? { before } : null;
  }
  const at = readDate(reminder.at);
  return at ? { at } : null;
}

function readTask(value: unknown, budget: { left: number }): TemplateTask | null {
  if (!value || typeof value !== 'object' || budget.left <= 0) return null;
  budget.left -= 1;
  const task = value as Record<string, unknown>;
  const text = (field: unknown, max: number) =>
    typeof field === 'string' ? field.slice(0, max) : '';
  const priority = [0, 1, 2, 3].includes(task.priority as number) ? (task.priority as Priority) : 0;
  const list = (field: unknown) => (Array.isArray(field) ? field : []);
  const start = readDate(task.start);
  const end = readDate(task.end);
  const minutes = (date: TemplateDate) =>
    date.inDays * 1440 +
    (date.time ? Number(date.time.slice(0, 2)) * 60 + Number(date.time.slice(3)) : 0);
  return {
    title: text(task.title, 1000),
    notes: text(task.notes, 100000),
    priority,
    tags: list(task.tags).filter((tag): tag is string => typeof tag === 'string'),
    start,
    // An end only after its start: one before it would make a task the server refuses.
    end: start && end && minutes(end) >= minutes(start) ? end : null,
    due: readDate(task.due),
    reminders: list(task.reminders)
      .map(readReminder)
      .filter((each): each is TemplateReminder => each !== null)
      .slice(0, MAX_REMINDERS),
    // A rule the app can't read is dropped, not made into a task (Security, PL-140).
    recurrence:
      typeof task.recurrence === 'string' && parseRule(task.recurrence) !== null
        ? task.recurrence
        : null,
    constantReminder: task.constantReminder === true,
    subtasks: list(task.subtasks)
      .map((each) => readTask(each, budget))
      .filter((each): each is TemplateTask => each !== null),
  };
}

/** A task template's body, checked; null when it holds no task. */
export function taskBody(template: Template): TemplateTask | null {
  if (template.kind !== 'task') return null;
  return readTask(template.body, { left: MAX_TEMPLATE_TASKS });
}

/** A list template's body, checked; null when it is not a list template. */
export function listBody(template: Template): TemplateList | null {
  if (template.kind !== 'list') return null;
  const body = template.body;
  const budget = { left: MAX_TEMPLATE_TASKS };
  return {
    name: typeof body.name === 'string' ? body.name.slice(0, 200) : template.name,
    color:
      typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)
        ? body.color
        : '#808080',
    icon: typeof body.icon === 'string' && body.icon ? body.icon.slice(0, 64) : null,
    tasks: (Array.isArray(body.tasks) ? body.tasks : [])
      .map((each) => readTask(each, budget))
      .filter((each): each is TemplateTask => each !== null),
  };
}

/** How many tasks a template makes, subtasks included: for its summary line. */
export function taskCount(template: Template): number {
  const count = (tasks: TemplateTask[]): number =>
    tasks.reduce((sum, task) => sum + 1 + count(task.subtasks), 0);
  const task = taskBody(template);
  if (task) return count(task.subtasks);
  return count(listBody(template)?.tasks ?? []);
}

// Saving: a task or list as it is now, its dates turned into days from today.

function toTemplateDate(value: LocalDateOrDateTime, today: string): TemplateDate {
  return { inDays: daysBetween(today, datePart(value)), time: timePart(value) };
}

function toTemplateTask(
  workspace: WorkspaceFile,
  task: Task,
  today: string,
  budget: { left: number },
): TemplateTask {
  budget.left -= 1;
  const reminders = (task.reminders ?? []).map((reminder): TemplateReminder =>
    'before' in reminder ? { before: reminder.before } : { at: toTemplateDate(reminder.at, today) },
  );
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    tags: members(task.tags),
    start: task.schedule ? toTemplateDate(task.schedule.start, today) : null,
    end: task.schedule?.end ? toTemplateDate(task.schedule.end, today) : null,
    due: task.due ? toTemplateDate(task.due.at, today) : null,
    reminders,
    recurrence: task.recurrence,
    constantReminder: task.constantReminder === true,
    // Open subtasks only, in their order: done ones are history, not part of the routine.
    subtasks: siblings(workspace, task.listId, task.id)
      .filter((child) => child.status === 'open' && budget.left > 0)
      .map((child) => toTemplateTask(workspace, child, today, budget)),
  };
}

function templateDates(task: TemplateTask): TemplateDate[] {
  return [
    ...[task.start, task.end, task.due].filter((date): date is TemplateDate => date !== null),
    ...task.reminders.flatMap((reminder) => ('at' in reminder ? [reminder.at] : [])),
    ...task.subtasks.flatMap(templateDates),
  ];
}

function shiftTask(task: TemplateTask, days: number): TemplateTask {
  const shift = (date: TemplateDate | null) => date && { ...date, inDays: date.inDays + days };
  return {
    ...task,
    start: shift(task.start),
    end: shift(task.end),
    due: shift(task.due),
    reminders: task.reminders.map((reminder) =>
      'at' in reminder ? { at: shift(reminder.at)! } : reminder,
    ),
    subtasks: task.subtasks.map((child) => shiftTask(child, days)),
  };
}

/**
 * Dates in the past (an overdue task saved as a template) move forward together, so the earliest
 * is the day the template is used and the rest keep their distance from it.
 */
function fromNowOn(tasks: TemplateTask[]): TemplateTask[] {
  const earliest = Math.min(0, ...tasks.flatMap(templateDates).map((date) => date.inDays));
  return earliest < 0 ? tasks.map((task) => shiftTask(task, -earliest)) : tasks;
}

/** What Save as template keeps of a task (and its open subtasks), with `today` the day it is saved. */
export function templateOfTask(workspace: WorkspaceFile, taskId: Id, today: string): TemplateTask {
  const task = toTemplateTask(workspace, requireEntity(workspace, 'tasks', taskId), today, {
    left: MAX_TEMPLATE_TASKS,
  });
  return fromNowOn([task])[0]!;
}

/** What Save as template keeps of a list: its look and its open top-level tasks with their subtasks. */
export function templateOfList(workspace: WorkspaceFile, listId: Id, today: string): TemplateList {
  const list = requireEntity(workspace, 'lists', listId);
  const budget = { left: MAX_TEMPLATE_TASKS };
  return {
    name: list.name,
    color: list.color,
    icon: list.icon,
    tasks: fromNowOn(
      siblings(workspace, listId, null)
        .filter((task) => task.status === 'open' && budget.left > 0)
        .map((task) => toTemplateTask(workspace, task, today, budget)),
    ),
  };
}

// Keeping templates.

export function createTemplate(
  ctx: OpContext,
  workspace: WorkspaceFile,
  input:
    | { name: string; kind: 'task'; body: TemplateTask }
    | { name: string; kind: 'list'; body: TemplateList },
): { workspace: WorkspaceFile; template: Template } {
  if (!templateFits(input.body)) throw new Error('template too large');
  const last = templatesOf(workspace).at(-1);
  const template = createEntity<Template>(ctx, {
    name: input.name.trim().slice(0, MAX_TEMPLATE_NAME),
    kind: input.kind,
    order: keyBetween(last?.order ?? null, null),
    body: input.body as unknown as Record<string, unknown>,
    uses: 0,
  });
  return { workspace: putEntity(workspace, 'templates', template), template };
}

export function renameTemplate(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  name: string,
): WorkspaceFile {
  const template = requireEntity(workspace, 'templates', id);
  const trimmed = name.trim().slice(0, MAX_TEMPLATE_NAME);
  if (!trimmed) return workspace;
  return putEntity(workspace, 'templates', updateEntity(ctx, template, { name: trimmed }));
}

export function updateTemplateBody(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  body: TemplateTask | TemplateList,
): WorkspaceFile {
  if (!templateFits(body)) throw new Error('template too large');
  const template = requireEntity(workspace, 'templates', id);
  return putEntity(
    workspace,
    'templates',
    updateEntity(ctx, template, { body: body as unknown as Record<string, unknown> }),
  );
}

/** A copy right after it, named "<name> (copy)" by the caller. */
export function duplicateTemplate(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  name: string,
): { workspace: WorkspaceFile; template: Template } {
  const original = requireEntity(workspace, 'templates', id);
  const all = templatesOf(workspace);
  const after = all[all.findIndex((each) => each.id === id) + 1];
  const template = createEntity<Template>(ctx, {
    name: name.trim().slice(0, MAX_TEMPLATE_NAME),
    kind: original.kind,
    order: keyBetween(original.order, after?.order ?? null),
    body: structuredClone(original.body),
    uses: 0,
  });
  return { workspace: putEntity(workspace, 'templates', template), template };
}

export function deleteTemplate(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  return putEntity(
    workspace,
    'templates',
    softDelete(ctx, requireEntity(workspace, 'templates', id)),
  );
}

/** Move a template to sit between two others (null: the start or the end). */
export function moveTemplate(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  afterId: Id | null,
): WorkspaceFile {
  const template = requireEntity(workspace, 'templates', id);
  const others = templatesOf(workspace).filter((each) => each.id !== id);
  const at = afterId === null ? -1 : others.findIndex((each) => each.id === afterId);
  const order = keyBetween(others[at]?.order ?? null, others[at + 1]?.order ?? null);
  return putEntity(workspace, 'templates', updateEntity(ctx, template, { order }));
}

// Using: new tasks, all open, with the dates worked out from `day` in `timeZone`.

interface UseOptions {
  /** The day the dates count from: today, or the day picked in the calendar */
  day: string;
  timeZone: string;
}

function fromTemplateDate(date: TemplateDate, day: string): LocalDateOrDateTime {
  return joinDateTime(addDays(day, date.inDays), date.time);
}

function makeTask(
  ctx: OpContext,
  workspace: WorkspaceFile,
  body: TemplateTask,
  where: {
    listId: Id;
    parentId: Id | null;
    afterId?: Id | null;
    title?: string;
    assignees?: string[];
  },
  options: UseOptions,
  made: Id[],
): WorkspaceFile {
  const liveTags = new Set(workspace.entities.tags.filter(isLive).map((tag) => tag.id));
  const schedule: Schedule | null = body.start
    ? {
        start: fromTemplateDate(body.start, options.day),
        end: body.end ? fromTemplateDate(body.end, options.day) : null,
        allDay: body.start.time === null,
        timeZone: options.timeZone,
      }
    : null;
  const due: Due | null = body.due
    ? {
        at: fromTemplateDate(body.due, options.day),
        allDay: body.due.time === null,
        timeZone: options.timeZone,
      }
    : null;
  const reminders = body.reminders.map((reminder): Reminder =>
    'before' in reminder
      ? { before: reminder.before }
      : { at: fromTemplateDate(reminder.at, options.day) },
  );
  const created = createTask(ctx, workspace, {
    title: where.title?.trim() || body.title,
    listId: where.listId,
    parentId: where.parentId,
    afterId: where.afterId ?? null,
    notes: body.notes,
    priority: body.priority,
    schedule,
    due,
    // A tag deleted since the template was saved is skipped, not made again.
    tags: body.tags.filter((tag) => liveTags.has(tag)),
    reminders,
    recurrence: body.recurrence,
    ...(where.assignees ? { assignees: where.assignees } : {}),
  });
  made.push(created.task.id);
  let ws = created.workspace;
  if (body.constantReminder) ws = updateTask(ctx, ws, created.task.id, { constantReminder: true });
  // Subtasks nest only so deep: a body from elsewhere may go deeper, and those levels are left out.
  if (taskDepth(ws, created.task.id) + 1 > MAX_SUBTASK_DEPTH) return ws;
  for (const child of body.subtasks) {
    ws = makeTask(
      ctx,
      ws,
      child,
      { listId: where.listId, parentId: created.task.id },
      options,
      made,
    );
  }
  return ws;
}

function countUse(ctx: OpContext, workspace: WorkspaceFile, template: Template): WorkspaceFile {
  return putEntity(
    workspace,
    'templates',
    updateEntity(ctx, template, { uses: (template.uses ?? 0) + 1 }),
  );
}

/**
 * Make a task template's task (and its subtasks) in `listId`. `title`, when given, is the title
 * typed in quick add before the template was picked. `schedule` is the place's own date (the
 * calendar day it was added to), used only when the template has no start and no due date.
 * `assignees` are the new task's own (Settings > New tasks); its subtasks get none.
 * Returns the new top-level task's id.
 */
export function fromTaskTemplate(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  where: {
    listId: Id;
    parentId?: Id | null;
    title?: string;
    schedule?: Schedule | null;
    assignees?: string[];
  },
  options: UseOptions,
): { workspace: WorkspaceFile; taskId: Id } {
  const template = requireEntity(workspace, 'templates', id);
  const body = taskBody(template);
  if (!body) throw new Error('not a task template');
  const made: Id[] = [];
  let ws = makeTask(
    ctx,
    workspace,
    body,
    {
      listId: where.listId,
      parentId: where.parentId ?? null,
      ...(where.title ? { title: where.title } : {}),
      ...(where.assignees ? { assignees: where.assignees } : {}),
    },
    options,
    made,
  );
  if (where.schedule && !body.start && !body.due) {
    ws = updateTask(ctx, ws, made[0]!, { schedule: where.schedule });
  }
  ws = countUse(ctx, ws, template);
  return { workspace: ws, taskId: made[0]! };
}

/** Make a new private list from a list template, named `name`. Returns the new list's id. */
export function fromListTemplate(
  ctx: OpContext,
  workspace: WorkspaceFile,
  id: Id,
  name: string,
  options: UseOptions,
): { workspace: WorkspaceFile; listId: Id } {
  const template = requireEntity(workspace, 'templates', id);
  const body = listBody(template);
  if (!body) throw new Error('not a list template');
  const list = createList(ctx, workspace, {
    name: name.trim() || body.name,
    color: body.color,
    icon: body.icon,
  });
  let ws = list.workspace;
  const made: Id[] = [];
  for (const task of body.tasks) {
    ws = makeTask(ctx, ws, task, { listId: list.list.id, parentId: null }, options, made);
  }
  ws = countUse(ctx, ws, template);
  return { workspace: ws, listId: list.list.id };
}

/** A blank template of a kind, for "New template" on the Templates page. */
export function blankTask(title = ''): TemplateTask {
  return {
    title,
    notes: '',
    priority: 0,
    tags: [],
    start: null,
    end: null,
    due: null,
    reminders: [],
    recurrence: null,
    constantReminder: false,
    subtasks: [],
  };
}

export function blankList(name: string, color: string): TemplateList {
  return { name, color, icon: null, tasks: [] };
}
