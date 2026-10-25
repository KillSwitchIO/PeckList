// Google Tasks from Google Takeout (spec: PL-063): Tasks/Tasks.json, its task lists each with
// their tasks (the Tasks API's own shape). A task has a title, notes, status ("needsAction" or
// "completed"), a due day (midnight UTC: Google keeps no time), when it was completed, its parent
// (one level of subtasks) and a position that orders it among its siblings. Deleted ones are
// left out. Google keeps no repeats, priorities or tags in the export.

import { emptyPlan, type ImportedTask, type ImportPlan } from './model.ts';

interface GoogleTask {
  id?: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  completed?: string;
  parent?: string;
  position?: string;
  deleted?: boolean;
}

interface GoogleList {
  id?: string;
  title?: string;
  items?: GoogleTask[];
}

/** The task lists in a Takeout file, whichever way it holds them. */
function listsOf(data: unknown): GoogleList[] {
  if (Array.isArray(data)) return data.flatMap(listsOf);
  if (!data || typeof data !== 'object') return [];
  const value = data as { kind?: string; items?: unknown[] };
  if (value.kind === 'tasks#taskLists' || (value.items ?? []).some(isList)) {
    return (value.items ?? []).filter(isList) as GoogleList[];
  }
  return [value as GoogleList];
}

const isList = (item: unknown) =>
  !!item &&
  typeof item === 'object' &&
  ((item as { kind?: string }).kind === 'tasks#taskList' ||
    Array.isArray((item as { items?: unknown }).items));

/** Google Takeout's Tasks.json as an import plan; `timeZone` dates its due days. */
export function parseGoogleTasks(text: string, options: { timeZone: string }): ImportPlan {
  const plan = emptyPlan('googleTasks');
  listsOf(JSON.parse(text)).forEach((list, listIndex) => {
    const listKey = list.id ?? `list${listIndex}`;
    plan.lists.push({ key: listKey, name: list.title?.trim() || 'Google Tasks' });
    const tasks = (list.items ?? []).filter((task) => !task.deleted);
    const ids = new Set(tasks.map((task) => task.id));
    const made: (ImportedTask & { position: string })[] = tasks.map((task, index) => {
      const done = task.status === 'completed';
      const due = task.due && /^\d{4}-\d{2}-\d{2}/.test(task.due) ? task.due.slice(0, 10) : null;
      const completed = task.completed && Date.parse(task.completed);
      return {
        key: task.id ?? `${listKey}#${index}`,
        listKey,
        parentKey: task.parent && ids.has(task.parent) ? task.parent : null,
        title: task.title?.trim() ?? '',
        notes: task.notes ?? '',
        status: done ? 'done' : 'open',
        completedAt: done && completed ? new Date(completed).toISOString() : null,
        priority: 0,
        schedule: due ? { start: due, end: null, allDay: true, timeZone: options.timeZone } : null,
        position: task.position ?? '',
      };
    });
    made.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
    plan.tasks.push(
      ...made.map((task) => {
        const copy: Partial<typeof task> = { ...task };
        delete copy.position;
        return copy as ImportedTask;
      }),
    );
  });
  return plan;
}
