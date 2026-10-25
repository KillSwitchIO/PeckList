// TickTick's backup CSV (Settings > Account > Backup), read and written (spec: PL-063). After a few
// lines about the file, a header row ("Folder Name", "List Name", "Title", ...) and a row a task.
// Dates are UTC instants with the task's time zone beside them; "Is All Day" says whether only the
// day counts. Status 0 open, 2 done, -1 won't do. Priority 0, 1, 3, 5. Reminders are ISO
// durations, one a line: for a timed task before the time ("-PT5M"), for an all-day task from the
// day's midnight ("P0DT9H0M0S" is 9:00 that day, "-P0DT15H0M0S" 9:00 the day before). A checklist
// task's items sit in its content, "▪" done and "▫" not; they come in as subtasks.

import { ALL_DAY_REMINDER_TIME } from '../reminders.ts';
import { datePart, instantOf, localDateTimeOf, timePart } from '../dates.ts';
import { members } from '../ops.ts';
import type { Priority, Reminder, Schedule, Task, WorkspaceFile } from '../types.ts';
import { parseCsv, recordsOf, toCsv } from './csv.ts';
import { emptyPlan, note, type ImportedTask, type ImportPlan } from './model.ts';

const FROM_TICKTICK: Record<string, Priority> = { '0': 0, '1': 1, '3': 2, '5': 3 };
const TO_TICKTICK: Record<Priority, string> = { 0: '0', 1: '1', 2: '3', 3: '5' };
const DONE_ITEM = '▪';

/** "2026-11-04T06:00:00+0000" as a parseable instant. */
const instant = (value: string) => value.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');

/**
 * Signed minutes of an ISO duration ("-P1DT15H0M0S" is -2340), or null. TickTick sometimes writes
 * an iCalendar trigger's parameters first (";RELATED=START:-PT5M"), and sometimes days twice
 * ("-P14D5DT15H0M0S", 19 days and 15 hours): they add up.
 */
export function durationMinutes(text: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?((?:\d+D)*)(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    text
      .trim()
      .replace(/^TRIGGER/i, '')
      .replace(/^(?:;[^:]*)?:/, ''),
  );
  if (!match) return null;
  const [, sign, w, d, h, m, s] = match;
  const days = (d ?? '').split('D').reduce((sum, part) => sum + Number(part || 0), 0);
  const minutes =
    Number(w ?? 0) * 10080 +
    days * 1440 +
    Number(h ?? 0) * 60 +
    Number(m ?? 0) +
    Math.round(Number(s ?? 0) / 60);
  return sign === '-' ? -minutes : minutes;
}

/** A TickTick reminder as ours: minutes before the time (timed), or before 9:00 that day (all day). */
export function reminderFrom(text: string, allDay: boolean): Reminder | null {
  const minutes = durationMinutes(text);
  if (minutes === null) return null;
  if (!allDay) return minutes <= 0 ? { before: -minutes } : null;
  const [h, m] = ALL_DAY_REMINDER_TIME.split(':').map(Number) as [number, number];
  const before = h * 60 + m - minutes;
  return before >= -1439 && before <= 525600 ? { before } : null;
}

/** Ours as TickTick writes it. */
export function reminderTo(reminder: Reminder, allDay: boolean): string | null {
  if ('at' in reminder) return null;
  const [h, m] = ALL_DAY_REMINDER_TIME.split(':').map(Number) as [number, number];
  const minutes = allDay ? h * 60 + m - reminder.before : -reminder.before;
  if (minutes === 0) return allDay ? 'PT0S' : '-PT0S';
  const sign = minutes < 0 ? '-' : '';
  const total = Math.abs(minutes);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  return allDay || days > 0 ? `${sign}P${days}DT${hours}H${mins}M0S` : `${sign}PT${total}M`;
}

export interface TickTickOptions {
  /** Time zone for rows that name none */
  timeZone: string;
}

/** A task without the sort key it was read with. */
function withoutOrder(task: ImportedTask & { order: bigint }): ImportedTask {
  const copy: Partial<ImportedTask & { order: bigint }> = { ...task };
  delete copy.order;
  return copy as ImportedTask;
}

/** A TickTick backup CSV as an import plan. */
export function parseTickTick(text: string, options: TickTickOptions): ImportPlan {
  const plan = emptyPlan('ticktick');
  const records = recordsOf(parseCsv(text), (row) => row[0]?.trim() === 'Folder Name');
  const lists = new Map<string, { key: string; name: string; inbox: boolean }>();
  let folders = false;
  const tasks: (ImportedTask & { order: bigint })[] = [];
  for (const row of records) {
    const listName = row['List Name']?.trim() || 'Inbox';
    if (!lists.has(listName)) {
      lists.set(listName, {
        key: listName,
        name: listName,
        inbox: listName.toLowerCase() === 'inbox',
      });
    }
    if (row['Folder Name']?.trim()) folders = true;
    if (row.projectKind === 'NOTE' || row.Kind === 'NOTE') note(plan, 'notesAsTasks');
    const zone = row.Timezone?.trim() || options.timeZone;
    const allDay = row['Is All Day']?.trim().toLowerCase() === 'true';
    const local = (value: string | undefined): string | null => {
      if (!value?.trim()) return null;
      const at = instant(value);
      if (Number.isNaN(Date.parse(at))) return null;
      const wall = localDateTimeOf(at, zone);
      return allDay ? wall.slice(0, 10) : wall;
    };
    const start = local(row['Start Date']);
    const end = local(row['Due Date']);
    let schedule: Schedule | null = null;
    const first = start ?? end;
    if (first) {
      schedule = {
        start: first,
        end: end && start && end > start ? end : null,
        allDay: allDay || timePart(first) === null,
        timeZone: zone,
      };
    }
    const reminders = (row.Reminder ?? '')
      .split(/[\n,]+/)
      .map((each) => each.trim())
      .filter(Boolean)
      .map((each): Reminder | null => {
        const made = reminderFrom(each, allDay);
        if (made) return made;
        // After a timed task's time: a set time instead.
        const minutes = durationMinutes(each);
        if (minutes !== null && minutes > 0 && schedule && !schedule.allDay) {
          const time = timePart(schedule.start) ?? '00:00';
          const at = Date.parse(instantOf(datePart(schedule.start), time, zone)) + minutes * 60_000;
          return { at: localDateTimeOf(new Date(at).toISOString(), zone) };
        }
        note(plan, 'reminderDropped');
        return null;
      })
      .filter((each): each is Reminder => each !== null);
    const status =
      row.Status?.trim() === '2' ? 'done' : row.Status?.trim() === '-1' ? 'wontdo' : 'open';
    const completed = row['Completed Time']?.trim();
    const key = row.taskId?.trim() || `row${tasks.length}`;
    // A checklist's items: text before the first is the description.
    let notes = row.Content ?? '';
    const items: { title: string; done: boolean }[] = [];
    if (row.Kind === 'CHECKLIST' || row['Is Check list'] === 'Y') {
      const parts = notes.split(/([▪▫])/);
      notes = parts[0]!.trim();
      for (let i = 1; i < parts.length; i += 2) {
        const title = (parts[i + 1] ?? '').trim();
        if (title) items.push({ title, done: parts[i] === DONE_ITEM });
      }
      if (items.length) note(plan, 'checklistAsSubtasks', items.length);
    }
    const repeat = row.Repeat?.trim();
    const task = {
      key,
      listKey: listName,
      parentKey: row.parentId?.trim() || null,
      title: row.Title?.trim() ?? '',
      notes,
      status,
      completedAt:
        status !== 'open' && completed && !Number.isNaN(Date.parse(instant(completed)))
          ? new Date(Date.parse(instant(completed))).toISOString()
          : null,
      priority: FROM_TICKTICK[row.Priority?.trim() ?? '0'] ?? 0,
      schedule,
      reminders,
      recurrence: repeat ? repeat.replace(/^RRULE:/i, '') : null,
      tags: (row.Tags ?? '')
        .split(',')
        .map((each) => each.trim())
        .filter(Boolean),
      order: BigInt(/^-?\d+$/.test(row.Order?.trim() ?? '') ? row.Order!.trim() : '0'),
    } satisfies ImportedTask & { order: bigint };
    tasks.push(task);
    items.forEach((item, index) => {
      tasks.push({
        key: `${key}.${index}`,
        listKey: listName,
        parentKey: key,
        title: item.title,
        status: item.done ? 'done' : 'open',
        completedAt: item.done ? task.completedAt : null,
        priority: 0,
        order: BigInt(index),
      });
    });
  }
  if (folders) note(plan, 'foldersDropped');
  plan.lists = [...lists.values()];
  // TickTick's order: smaller first, within each list and parent.
  plan.tasks = tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) =>
      a.task.listKey === b.task.listKey && (a.task.parentKey ?? '') === (b.task.parentKey ?? '')
        ? a.task.order < b.task.order
          ? -1
          : a.task.order > b.task.order
            ? 1
            : a.index - b.index
        : a.index - b.index,
    )
    .map(({ task }) => withoutOrder(task));
  return plan;
}

const HEADER = [
  'Folder Name',
  'List Name',
  'Title',
  'Kind',
  'Tags',
  'Content',
  'Is Check list',
  'Start Date',
  'Due Date',
  'Reminder',
  'Repeat',
  'Priority',
  'Status',
  'Created Time',
  'Completed Time',
  'Order',
  'Timezone',
  'Is All Day',
  'Is Floating',
  'Column Name',
  'Column Order',
  'View Mode',
  'taskId',
  'parentId',
  'projectKind',
];

/** A UTC instant as TickTick writes it: "2026-11-04T06:00:00+0000". */
const tickInstant = (iso: string) => `${new Date(Date.parse(iso)).toISOString().slice(0, 19)}+0000`;

/** Tasks (all, or the lists named) as a TickTick backup CSV, which TickTick imports. */
export function exportTickTick(
  workspace: WorkspaceFile,
  options: { listIds?: readonly string[]; now?: Date } = {},
): string {
  const now = options.now ?? new Date();
  const lists = new Map(workspace.entities.lists.map((list) => [list.id, list]));
  const tagNames = new Map(workspace.entities.tags.map((tag) => [tag.id, tag.name]));
  const wanted = options.listIds ? new Set(options.listIds) : null;
  const tasks = workspace.entities.tasks.filter(
    (task) => !task.deletedAt && (!wanted || wanted.has(task.listId)),
  );
  const ids = new Map(tasks.map((task, index) => [task.id, String(index + 1)]));
  const at = (task: Task, value: string) => {
    const zone = task.schedule?.timeZone ?? 'UTC';
    return tickInstant(instantOf(datePart(value), timePart(value) ?? '00:00', zone));
  };
  const rows = tasks.map((task, index) => {
    const list = lists.get(task.listId);
    const allDay = task.schedule
      ? task.schedule.allDay || timePart(task.schedule.start) === null
      : false;
    const start = task.schedule ? at(task, task.schedule.start) : '';
    const end = task.schedule ? at(task, task.schedule.end ?? task.schedule.start) : '';
    // A set-time reminder as minutes from the time (timed) or 9:00 that day (all day).
    const zone = task.schedule?.timeZone ?? 'UTC';
    const anchor = task.schedule
      ? Date.parse(
          instantOf(
            datePart(task.schedule.start),
            allDay ? ALL_DAY_REMINDER_TIME : (timePart(task.schedule.start) ?? '00:00'),
            zone,
          ),
        )
      : null;
    const relative = (reminder: Reminder): Reminder | null => {
      if (!('at' in reminder)) return reminder;
      if (anchor === null) return null;
      const fires = Date.parse(
        instantOf(datePart(reminder.at), timePart(reminder.at) ?? ALL_DAY_REMINDER_TIME, zone),
      );
      return { before: Math.round((anchor - fires) / 60_000) };
    };
    return [
      '',
      list ? (list.isInbox ? 'Inbox' : list.name) : 'Inbox',
      task.title,
      'TEXT',
      members(task.tags)
        .map((id) => tagNames.get(id))
        .filter(Boolean)
        .join(','),
      task.notes,
      'N',
      start,
      end,
      (task.reminders ?? [])
        .map(relative)
        .map((each) => (each ? reminderTo(each, allDay) : null))
        .filter(Boolean)
        .join('\n'),
      task.recurrence ? `RRULE:${task.recurrence}` : '',
      TO_TICKTICK[task.priority],
      task.status === 'done' ? '2' : task.status === 'wontdo' ? '-1' : '0',
      tickInstant(task.createdAt),
      task.completedAt ? tickInstant(task.completedAt) : '',
      String((index + 1) * 1024),
      task.schedule?.timeZone ?? '',
      task.schedule ? String(allDay) : 'false',
      'false',
      '',
      '',
      'list',
      ids.get(task.id)!,
      task.parentId ? (ids.get(task.parentId) ?? '') : '',
      'TASK',
    ];
  });
  const stamp = now.toISOString().slice(0, 10);
  return toCsv([
    [`Date: ${stamp}+0000`],
    ['Version: 7.2'],
    ['Status: \n0 Normal\n-1 Abandoned \n2 Completed'],
    HEADER,
    ...rows,
  ]);
}
