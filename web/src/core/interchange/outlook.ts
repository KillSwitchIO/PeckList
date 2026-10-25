// Microsoft To Do by way of Outlook (spec: PL-063). To Do keeps its tasks in Outlook's Tasks, and
// classic Outlook exports and imports those as CSV (File > Open & Export > Import/Export). A row a
// task: Subject, Start Date, Due Date, a reminder (on or off, date, time), Date Completed, Notes,
// Categories (";" between), Priority (High, Normal, Low) and Status ("Completed" is done). Dates
// are written the way the computer's region writes them: month first (11/4/2026) unless a day
// above 12 shows the file is day first. To Do's steps are not in the file.

import { localDateTimeOf, timePart } from '../dates.ts';
import { members } from '../ops.ts';
import { reminderInstant } from '../reminders.ts';
import type { Priority, Reminder, WorkspaceFile } from '../types.ts';
import { parseCsv, recordsOf, toCsv } from './csv.ts';
import { emptyPlan, type ImportPlan } from './model.ts';
import { projectName } from './todoist.ts';
import { exportName, walkTasks } from './walk.ts';

const FROM_OUTLOOK: Record<string, Priority> = { high: 3, normal: 0, low: 1 };
const TO_OUTLOOK: Record<Priority, string> = { 3: 'High', 2: 'High', 1: 'Low', 0: 'Normal' };
const SLASHED = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** Whether the file writes days first: some date's first number is above 12. */
function dayFirstIn(rows: Record<string, string>[]): boolean {
  for (const row of rows) {
    for (const column of ['Start Date', 'Due Date', 'Reminder Date', 'Date Completed']) {
      const match = SLASHED.exec(row[column]?.trim() ?? '');
      if (match && Number(match[1]) > 12) return true;
      if (match && Number(match[2]) > 12) return false;
    }
  }
  return false;
}

/** "11/4/2026" (or "2026-11-04") as "2026-11-04", or null. */
function dayOf(text: string | undefined, dayFirst: boolean): string | null {
  const value = text?.trim() ?? '';
  const iso = ISO_DAY.exec(value);
  if (iso) return value;
  const match = SLASHED.exec(value);
  if (!match) return null;
  const [a, b, y] = [Number(match[1]), Number(match[2]), match[3]];
  const [month, day] = dayFirst ? [b, a] : [a, b];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${y}-${pad(month)}-${pad(day)}`;
}

/** "9:30:00 AM" (or "21:30") as "09:30"/"21:30", or null. */
function timeOf(text: string | undefined): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(text?.trim() ?? '');
  if (!match) return null;
  let hour = Number(match[1]);
  const half = match[3]?.toLowerCase();
  if (half === 'pm' && hour < 12) hour += 12;
  if (half === 'am' && hour === 12) hour = 0;
  return hour < 24 ? `${pad(hour)}:${match[2]}` : null;
}

/** An Outlook task CSV as an import plan (one list, named after the file). */
export function parseOutlook(
  file: { name: string; text: string },
  options: { timeZone: string },
): ImportPlan {
  const plan = emptyPlan('microsoftToDo');
  const name = projectName(file.name);
  const listKey = name;
  plan.lists.push({ key: listKey, name });
  const rows = recordsOf(parseCsv(file.text), (row) =>
    row.some((cell) => cell.trim() === 'Subject'),
  );
  const dayFirst = dayFirstIn(rows);
  rows.forEach((row, index) => {
    const start = dayOf(row['Start Date'], dayFirst);
    const due = dayOf(row['Due Date'], dayFirst);
    const done = row.Status?.trim().toLowerCase() === 'completed';
    const completed = dayOf(row['Date Completed'], dayFirst);
    const reminders: Reminder[] = [];
    const remindDay = dayOf(row['Reminder Date'], dayFirst);
    if (/^true$/i.test(row['Reminder On/Off']?.trim() ?? '') && remindDay) {
      const time = timeOf(row['Reminder Time']);
      reminders.push({ at: time ? `${remindDay}T${time}` : remindDay });
    }
    const first = start ?? due;
    plan.tasks.push({
      key: `${listKey}#${index}`,
      listKey,
      title: row.Subject?.trim() ?? '',
      notes: row.Notes?.trim() ?? '',
      status: done ? 'done' : 'open',
      completedAt: done && completed ? new Date(`${completed}T12:00:00Z`).toISOString() : null,
      priority: FROM_OUTLOOK[row.Priority?.trim().toLowerCase() ?? ''] ?? 0,
      schedule: first
        ? { start: first, end: null, allDay: true, timeZone: options.timeZone }
        : null,
      due:
        start && due && due !== start
          ? { at: due, allDay: true, timeZone: options.timeZone }
          : null,
      reminders,
      tags: (row.Categories ?? '')
        .split(';')
        .map((each) => each.trim())
        .filter(Boolean),
    });
  });
  return plan;
}

const HEADER = [
  'Subject',
  'Start Date',
  'Due Date',
  'Reminder On/Off',
  'Reminder Date',
  'Reminder Time',
  'Date Completed',
  '% Complete',
  'Categories',
  'Notes',
  'Priority',
  'Status',
];

/** "2026-11-04" as Outlook writes it in the US: "11/4/2026". */
const outlookDay = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${m}/${d}/${y}`;
};

/** "14:30" as "2:30:00 PM". */
const outlookTime = (time: string) => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${pad(m)}:00 ${h < 12 ? 'AM' : 'PM'}`;
};

/** Each list's tasks (subtasks too, flat) as an Outlook task CSV, for To Do through Outlook. */
export function exportOutlook(
  workspace: WorkspaceFile,
  listIds?: readonly string[] | null,
): { name: string; text: string }[] {
  const tagNames = new Map(workspace.entities.tags.map((tag) => [tag.id, tag.name]));
  const byList = new Map<string, { name: string; rows: string[][] }>();
  for (const { list, task } of walkTasks(workspace, listIds)) {
    const entry = byList.get(list.id) ?? { name: exportName(list), rows: [] };
    byList.set(list.id, entry);
    const zone = task.schedule?.timeZone ?? task.due?.timeZone ?? 'UTC';
    const start = task.schedule?.start ?? null;
    const due = task.due?.at ?? task.schedule?.end ?? start;
    // To Do keeps one reminder: the first that fires.
    const fires = (task.reminders ?? [])
      .map((each) => reminderInstant(task, each, zone))
      .filter((each): each is number => each !== null)
      .sort((a, b) => a - b)[0];
    const remind =
      fires !== undefined ? localDateTimeOf(new Date(fires).toISOString(), zone) : null;
    const closed = task.status !== 'open';
    entry.rows.push([
      task.title,
      start ? outlookDay(start) : '',
      due ? outlookDay(due) : '',
      remind ? 'True' : 'False',
      remind ? outlookDay(remind) : '',
      remind ? outlookTime(timePart(remind) ?? '09:00') : '',
      closed && task.completedAt ? outlookDay(localDateTimeOf(task.completedAt, zone)) : '',
      closed ? '100%' : '0%',
      members(task.tags)
        .map((id) => tagNames.get(id))
        .filter(Boolean)
        .join(';'),
      task.notes,
      TO_OUTLOOK[task.priority],
      closed ? 'Completed' : 'Not Started',
    ]);
  }
  return [...byList.values()].map((entry) => ({
    name: `${entry.name}.csv`,
    text: toCsv([HEADER, ...entry.rows]),
  }));
}
