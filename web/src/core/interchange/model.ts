// What any app's export becomes before it lands in Punchlist (spec: PL-063): lists, and tasks
// with their place, dates, repeat, reminders, priority, status and tags by name. Each format reads
// its own file into this; one importer adds it to the workspace.

import type { Due, Priority, Reminder, Schedule } from '../types.ts';

export type InterchangeSource =
  'ticktick' | 'todoist' | 'googleTasks' | 'microsoftToDo' | 'ical' | 'things';

export interface ImportedList {
  /** The export's own name for it (to tie tasks to it) */
  key: string;
  name: string;
  color?: string;
  /** The app's inbox: it goes into the Mess Drawer */
  inbox?: boolean;
}

export interface ImportedTask {
  key: string;
  listKey: string;
  /** The task it sits under, by key */
  parentKey?: string | null;
  title: string;
  notes?: string;
  status: 'open' | 'done' | 'wontdo';
  /** When it was closed (an ISO instant) */
  completedAt?: string | null;
  priority: Priority;
  schedule?: Schedule | null;
  due?: Due | null;
  reminders?: Reminder[];
  /** RRULE text */
  recurrence?: string | null;
  /** Tag names (nested ones with "/") */
  tags?: string[];
}

/** Something the import changed or left out, and how often. */
export type ImportNote =
  | 'repeatDropped'
  | 'reminderDropped'
  | 'foldersDropped'
  | 'notesAsTasks'
  | 'checklistAsSubtasks'
  | 'tooDeep'
  | 'dateUnread'
  | 'commentsAsNotes'
  | 'sectionsDropped';

export interface ImportPlan {
  source: InterchangeSource;
  lists: ImportedList[];
  tasks: ImportedTask[];
  notes: Partial<Record<ImportNote, number>>;
}

/** Count one more of a note. */
export function note(plan: ImportPlan, what: ImportNote, by = 1): void {
  plan.notes[what] = (plan.notes[what] ?? 0) + by;
}

/** An empty plan for `source`. */
export const emptyPlan = (source: InterchangeSource): ImportPlan => ({
  source,
  lists: [],
  tasks: [],
  notes: {},
});

/** Priorities 0 (none) to 3 (high). */
export const clampPriority = (value: number): Priority =>
  Math.max(0, Math.min(3, Math.round(value))) as Priority;
