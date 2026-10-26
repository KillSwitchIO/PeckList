// What a new task starts with (spec: PL-092): the person's defaults from Settings > New tasks,
// filling only what the place it is added says nothing about. Quick add's own words then win over
// both (core/quickAdd.createFromQuickAdd lays them on top).

import { getEntity, isLive } from './collections.ts';
import { addDays, timePart } from './dates.ts';
import { allDayReminderTimeOf, atAllDayTime } from './reminders.ts';
import type { TaskInput } from './tasks.ts';
import type { Id, NewTaskDefaults, WorkspaceFile } from './types.ts';

export function newTaskDefaultsOf(workspace: WorkspaceFile): NewTaskDefaults {
  return workspace.entities.settings[0]?.newTask ?? {};
}

/** The start date a default date choice means today. */
export function defaultDate(choice: NewTaskDefaults['date'], today: string): string | null {
  switch (choice) {
    case 'today':
      return today;
    case 'tomorrow':
      return addDays(today, 1);
    case 'nextWeek':
      return addDays(today, 7);
    default:
      return null;
  }
}

/**
 * `input` with the defaults filled in. `inList` says the list is where the task is being added (a
 * list page), so it stays; elsewhere the list is only a fallback and the default list replaces it.
 * A date set by the place (Today, a day) stays too.
 */
export function withNewTaskDefaults(
  workspace: WorkspaceFile,
  input: Omit<TaskInput, 'title'>,
  options: { today: string; timeZone: string; inList: boolean },
): Omit<TaskInput, 'title'> {
  const defaults = newTaskDefaultsOf(workspace);
  const next = { ...input };
  const list = defaults.listId ? getEntity(workspace, 'lists', defaults.listId) : undefined;
  if (!options.inList && !input.parentId && list && isLive(list) && !list.archived) {
    next.listId = list.id as Id;
  }
  if (next.priority === undefined && defaults.priority) next.priority = defaults.priority;
  const date = defaultDate(defaults.date, options.today);
  if (next.schedule === undefined && date) {
    const time = defaults.time ?? null;
    next.schedule = {
      start: time ? `${date}T${time}` : date,
      end: null,
      allDay: time === null,
      timeZone: options.timeZone,
    };
  }
  // They wait for a date if the task has none (core/reminders counts from it).
  if (next.reminders === undefined && defaults.reminders?.length) {
    // On an all-day task they come at the person's time for all-day reminders (R-FB-83).
    const anchor = next.schedule?.start ?? next.due?.at ?? null;
    const time = allDayReminderTimeOf(workspace);
    next.reminders =
      anchor !== null && timePart(anchor) === null
        ? defaults.reminders.map((each) =>
            'before' in each ? { before: atAllDayTime(each.before, time) } : each,
          )
        : defaults.reminders;
  }
  return next;
}

/** Whether tasks I add to shared lists start assigned to me (the default). */
export function assignsSelf(workspace: WorkspaceFile): boolean {
  return newTaskDefaultsOf(workspace).assignSelf ?? true;
}
