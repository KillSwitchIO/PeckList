// What any app's export becomes before it lands in PeckList (spec: PL-063): lists, and tasks
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
  /** When the other app made it (an ISO instant) */
  createdAt?: string | null;
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
  | 'tooDeep'
  | 'dateUnread'
  | 'commentsAsNotes'
  | 'sectionsDropped'
  | 'repeatStartGuessed'
  | 'attachmentsLeft';

export interface ImportPlan {
  source: InterchangeSource;
  lists: ImportedList[];
  tasks: ImportedTask[];
  notes: Partial<Record<ImportNote, number>>;
  /**
   * Repeating tasks (their keys) whose file gave a rule but no next date, so they start on the
   * day of the import: every 2 days, every 6 months, every! 2 weeks, every 2 weeks tue.
   */
  guessedStarts?: string[];
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

/** RRULE text without PeckList's own parts (X-PL-...), for another app. */
export const plainRule = (rule: string) =>
  rule
    .replace(/^RRULE:/i, '')
    .replace(/;?X-PL-[^;]*/g, '')
    .replace(/^;/, '');

/** Priorities 0 (none) to 3 (high). */
export const clampPriority = (value: number): Priority =>
  Math.max(0, Math.min(3, Math.round(value))) as Priority;

/** TickTick's attachment as its backup writes it: `![image](<24 hex digits>/receipt.jpg)`. */
const TICKTICK_FILE = /!\[[^\]\n]*\]\([0-9a-f]{24}\/([^)\s]+)\)/gi;
/** Todoist's, in a comment: `[[file {"file_name": "receipt.pdf", ...}]]`. */
const TODOIST_FILE = /\[\[file\s+(\{[^\n]*?\})\]\]/g;

/**
 * Text with the other app's attachments (which the export does not hold) as a line saying so,
 * rather than a broken image or a blob of JSON; each one counted on the plan.
 */
export function withoutAttachments(plan: ImportPlan, text: string): string {
  const left = (name: string) => {
    note(plan, 'attachmentsLeft');
    return `📎 ${name} (attachment not imported)`;
  };
  return text
    .replace(TICKTICK_FILE, (_, file: string) => {
      try {
        return left(decodeURIComponent(file));
      } catch {
        return left(file);
      }
    })
    .replace(TODOIST_FILE, (whole, json: string) => {
      try {
        const name = (JSON.parse(json) as { file_name?: unknown }).file_name;
        return left(typeof name === 'string' && name.trim() ? name.trim() : 'file');
      } catch {
        return whole;
      }
    });
}
