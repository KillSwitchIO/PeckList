// Things 3 (spec: PL-063): Things imports no file, but its URL scheme adds what a JSON array
// describes (things:///json?data=...), at most 250 to-dos a time. So an export is batches, each a
// link to open on a device with Things: first the projects (a list each; the Mess Drawer's tasks
// go to Things' Inbox), then the open to-dos with their project ("list"), notes, date ("when", with
// "@HH:mm" for a reminder at that time), deadline and tags, and their subtasks as checklist
// items (Things has one level of them). Things keeps no priorities or repeats, and takes a tag
// only if one of that name is already there.

import { datePart, timePart } from '../dates.ts';
import { members } from '../ops.ts';
import type { WorkspaceFile } from '../types.ts';
import { exportName, walkTasks } from './walk.ts';

export const THINGS_BATCH = 250;

export interface ThingsItem {
  type: 'project' | 'to-do';
  attributes: Record<string, unknown>;
}

export interface ThingsExport {
  /** Each a things:///json call, in order */
  batches: ThingsItem[][];
  /** How many to-dos had what Things cannot keep */
  repeatsDropped: number;
  prioritiesDropped: number;
}

/** Open tasks of the lists (all, or those named) as Things JSON batches. */
export function exportThings(
  workspace: WorkspaceFile,
  listIds?: readonly string[] | null,
): ThingsExport {
  const tagNames = new Map(workspace.entities.tags.map((tag) => [tag.id, tag.name]));
  const projects: ThingsItem[] = [];
  const todos: ThingsItem[] = [];
  let current: { attributes: Record<string, unknown>; items: Record<string, unknown>[] } | null =
    null;
  let repeatsDropped = 0;
  let prioritiesDropped = 0;
  const seen = new Set<string>();
  for (const { list, task, depth } of walkTasks(
    workspace,
    listIds,
    (each) => each.status === 'open',
  )) {
    const project = list.isInbox ? null : exportName(list);
    if (project && !seen.has(list.id)) {
      seen.add(list.id);
      projects.push({ type: 'project', attributes: { title: project } });
    }
    if (depth > 0 && current) {
      current.items.push({ type: 'checklist-item', attributes: { title: task.title } });
      continue;
    }
    if (task.recurrence) repeatsDropped += 1;
    if (task.priority > 0) prioritiesDropped += 1;
    const attributes: Record<string, unknown> = { title: task.title };
    if (task.notes) attributes.notes = task.notes.slice(0, 10_000);
    if (project) attributes.list = project;
    const schedule = task.schedule;
    if (schedule) {
      const time = schedule.allDay ? null : timePart(schedule.start);
      attributes.when = time ? `${datePart(schedule.start)}@${time}` : datePart(schedule.start);
    }
    if (task.due) attributes.deadline = datePart(task.due.at);
    const tags = members(task.tags)
      .map((id) => tagNames.get(id))
      .filter((name): name is string => !!name);
    if (tags.length) attributes.tags = tags;
    const items: Record<string, unknown>[] = [];
    attributes['checklist-items'] = items;
    current = { attributes, items };
    todos.push({ type: 'to-do', attributes });
  }
  for (const todo of todos) {
    if (!(todo.attributes['checklist-items'] as unknown[]).length) {
      delete todo.attributes['checklist-items'];
    }
  }
  const batches: ThingsItem[][] = [];
  if (projects.length) batches.push(projects);
  for (let i = 0; i < todos.length; i += THINGS_BATCH) {
    batches.push(todos.slice(i, i + THINGS_BATCH));
  }
  return { batches, repeatsDropped, prioritiesDropped };
}

/** The link that adds a batch to Things. */
export const thingsUrl = (batch: readonly ThingsItem[]) =>
  `things:///json?data=${encodeURIComponent(JSON.stringify(batch))}`;
