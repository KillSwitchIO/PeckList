// Todoist's project CSV (spec: PL-063): a project's "Export as a CSV file", or a backup (Settings >
// Backups, a zip of them). Each file is one project, named after it. A row is a task, a section
// or a note (a comment on the task above). INDENT 1 is top level, 2 under the task above, and
// so on. Priority 1 is Todoist's p1 (highest) and 4 its p4 (none); an empty one is p1. Labels sit
// in the content as "@label". DATE is words Todoist reads ("every monday at 9am", "Nov 4 2026").
// Sections become nothing (Punchlist has none: PL-011); their tasks stay in the list.

import { datePart, instantOf, isTimeZone, localDateTimeOf, timePart } from '../dates.ts';
import { members } from '../ops.ts';
import type { Priority, WorkspaceFile } from '../types.ts';
import { parseCsv, recordsOf, toCsv } from './csv.ts';
import { dateWords, scheduleWords, type DateReader } from './dateText.ts';
import {
  emptyPlan,
  note,
  withoutAttachments,
  type ImportedTask,
  type ImportPlan,
} from './model.ts';
import { exportName, walkTasks } from './walk.ts';

const FROM_TODOIST: Record<string, Priority> = { '1': 3, '2': 2, '3': 1, '4': 0, '': 3 };
const TO_TODOIST: Record<Priority, string> = { 3: '1', 2: '2', 1: '3', 0: '4' };
const LABEL = /(^|\s)@([^\s@]+)/g;

/** A project's name from its file: "Garden.csv", "Garden [2203306141].csv", "backup/Garden.csv". */
export function projectName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return (
    base
      .replace(/\.csv$/i, '')
      .replace(/\s*\[\d+\]$/, '')
      .trim() || 'Imported'
  );
}

export interface TodoistOptions {
  readDate: DateReader;
}

/** Todoist project CSVs (one a project) as an import plan. */
export function parseTodoist(
  files: readonly { name: string; text: string }[],
  options: TodoistOptions,
): ImportPlan {
  const plan = emptyPlan('todoist');
  files.forEach((file, fileIndex) => {
    const name = projectName(file.name);
    const listKey = `${fileIndex}:${name}`;
    plan.lists.push({ key: listKey, name, inbox: name.toLowerCase() === 'inbox' });
    const records = recordsOf(parseCsv(file.text), (row) => row[0]?.trim() === 'TYPE');
    // The task last seen at each indent, for subtasks and notes.
    const parents: ImportedTask[] = [];
    let last: ImportedTask | null = null;
    records.forEach((row, index) => {
      const type = row.TYPE?.trim().toLowerCase();
      const content = row.CONTENT ?? '';
      if (type === 'section') {
        note(plan, 'sectionsDropped');
        parents.length = 0;
        last = null;
        return;
      }
      if (type === 'note') {
        if (last && content.trim()) {
          const comment = withoutAttachments(plan, content.trim());
          last.notes = last.notes ? `${last.notes}\n\n${comment}` : comment;
          note(plan, 'commentsAsNotes');
        }
        return;
      }
      if (type !== 'task') return;
      const tags: string[] = [];
      const title = content
        .replace(LABEL, (_, lead: string, label: string) => {
          tags.push(label);
          return lead;
        })
        .replace(/\s+/g, ' ')
        .trim();
      const indent = Math.max(1, Number(row.INDENT?.trim() || '1') || 1);
      const parent = indent > 1 ? parents[Math.min(indent - 1, parents.length) - 1] : undefined;
      const dateText = row.DATE?.trim() ?? '';
      const read = dateText ? options.readDate(dateText) : null;
      if (dateText && !read) note(plan, 'dateUnread');
      let schedule = read?.schedule ?? null;
      // A task kept in one time zone names it: its date and time are that zone's.
      const zone = row.TIMEZONE?.trim();
      if (schedule && zone && isTimeZone(zone)) schedule = { ...schedule, timeZone: zone };
      // A timed task's duration is its end.
      const minutes = Number(row.DURATION?.trim() || '0');
      if (schedule && !schedule.allDay && minutes > 0) {
        const unit = row.DURATION_UNIT?.trim().toLowerCase();
        const length = unit === 'day' ? minutes * 1440 : minutes;
        const begins = Date.parse(
          instantOf(datePart(schedule.start), timePart(schedule.start)!, schedule.timeZone),
        );
        schedule = {
          ...schedule,
          end: localDateTimeOf(new Date(begins + length * 60_000).toISOString(), schedule.timeZone),
        };
      }
      const deadline = row.DEADLINE?.trim() ? options.readDate(row.DEADLINE.trim()) : null;
      const task: ImportedTask = {
        key: `${listKey}#${index}`,
        listKey,
        parentKey: parent?.key ?? null,
        title,
        notes: withoutAttachments(plan, row.DESCRIPTION?.trim() ?? ''),
        status: 'open',
        priority: FROM_TODOIST[row.PRIORITY?.trim() ?? ''] ?? 0,
        schedule,
        due: deadline?.schedule
          ? {
              at: datePart(deadline.schedule.start),
              allDay: true,
              timeZone: deadline.schedule.timeZone,
            }
          : null,
        recurrence: read?.recurrence ?? null,
        tags,
      };
      plan.tasks.push(task);
      // Its own level (one under its parent, however far the file indents it).
      const level = parent ? parents.indexOf(parent) + 1 : 0;
      parents.length = level;
      parents[level] = task;
      last = task;
    });
  });
  return plan;
}

const HEADER = [
  'TYPE',
  'CONTENT',
  'DESCRIPTION',
  'PRIORITY',
  'INDENT',
  'AUTHOR',
  'RESPONSIBLE',
  'DATE',
  'DATE_LANG',
  'TIMEZONE',
  'DURATION',
  'DURATION_UNIT',
  'DEADLINE',
  'DEADLINE_LANG',
];

/** A label as Todoist takes it: no spaces. */
const labelOf = (name: string) => name.trim().replace(/\s+/g, '_');

/** Each list's open tasks as a Todoist project CSV (Todoist imports one into a project). */
export function exportTodoist(
  workspace: WorkspaceFile,
  listIds?: readonly string[] | null,
): { name: string; text: string }[] {
  const tagNames = new Map(workspace.entities.tags.map((tag) => [tag.id, tag.name]));
  const byList = new Map<string, { name: string; rows: string[][] }>();
  for (const { list, task, depth } of walkTasks(
    workspace,
    listIds,
    (each) => each.status === 'open',
  )) {
    const entry = byList.get(list.id) ?? { name: exportName(list), rows: [] };
    byList.set(list.id, entry);
    const labels = members(task.tags)
      .map((id) => tagNames.get(id))
      .filter((name): name is string => !!name)
      .map((name) => ` @${labelOf(name)}`)
      .join('');
    const schedule = task.schedule;
    let duration = '';
    if (schedule && !schedule.allDay && schedule.end && timePart(schedule.end)) {
      const at = (value: string) =>
        Date.parse(instantOf(datePart(value), timePart(value)!, schedule.timeZone));
      const minutes = Math.round((at(schedule.end) - at(schedule.start)) / 60_000);
      if (minutes > 0) duration = String(minutes);
    }
    entry.rows.push([
      'task',
      `${task.title}${labels}`,
      task.notes,
      TO_TODOIST[task.priority],
      String(Math.min(depth + 1, 4)),
      '',
      '',
      scheduleWords(schedule, task.recurrence),
      'en',
      schedule?.timeZone ?? '',
      duration,
      duration ? 'minute' : '',
      task.due ? dateWords(datePart(task.due.at)) : '',
      task.due ? 'en' : '',
    ]);
  }
  return [...byList.values()].map((entry) => ({
    name: `${entry.name}.csv`,
    text: toCsv([HEADER, ...entry.rows]),
  }));
}
