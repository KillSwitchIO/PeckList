// iCalendar tasks (RFC 5545 VTODO, spec: PL-063): the open format Nextcloud Tasks, Thunderbird,
// tasks.org and CalDAV apps (Apple Reminders through them) read and write. A calendar is a list
// (X-WR-CALNAME, else the file's name); each VTODO a task: SUMMARY, DESCRIPTION, DTSTART, DUE or
// DURATION, STATUS, COMPLETED, PRIORITY (1 high to 9 low), CATEGORIES, RRULE, RELATED-TO its
// parent, and VALARMs for reminders. Times in UTC or a named zone; floating ones in `timeZone`.

import { datePart, instantOf, isTimeZone, localDateTimeOf, timePart } from '../dates.ts';
import { members } from '../ops.ts';
import { ALL_DAY_REMINDER_TIME } from '../reminders.ts';
import type { Priority, Reminder, Schedule, WorkspaceFile } from '../types.ts';
import { emptyPlan, note, plainRule, type ImportedTask, type ImportPlan } from './model.ts';
import { durationMinutes, reminderFrom } from './ticktick.ts';
import { projectName } from './todoist.ts';
import { exportName, walkTasks } from './walk.ts';

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Component {
  name: string;
  props: Property[];
  children: Component[];
}

/** Unfolded content lines as properties. */
function properties(text: string): Property[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
  const out: Property[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // The value starts at the first colon outside a quoted parameter.
    let colon = -1;
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '"') quoted = !quoted;
      else if (line[i] === ':' && !quoted) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const [name, ...rawParams] = line.slice(0, colon).split(';');
    const params: Record<string, string> = {};
    for (const param of rawParams) {
      const eq = param.indexOf('=');
      if (eq > 0)
        params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
    }
    out.push({ name: name!.toUpperCase(), params, value: line.slice(colon + 1) });
  }
  return out;
}

function components(text: string): Component[] {
  const root: Component = { name: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const prop of properties(text)) {
    const top = stack[stack.length - 1]!;
    if (prop.name === 'BEGIN') {
      const child = { name: prop.value.toUpperCase(), props: [], children: [] };
      top.children.push(child);
      stack.push(child);
    } else if (prop.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      top.props.push(prop);
    }
  }
  return root.children;
}

const unescape = (value: string) =>
  value.replace(/\\([\\;,nN])/g, (_, char: string) => (char.toLowerCase() === 'n' ? '\n' : char));

const escapeText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A DATE or DATE-TIME value as a local date (all day) or date-time in a zone. */
function moment(
  prop: Property | undefined,
  fallbackZone: string,
): { value: string; allDay: boolean; zone: string } | null {
  if (!prop) return null;
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, , utc] = match;
  const date = `${y}-${mo}-${d}`;
  if (!h) return { value: date, allDay: true, zone: fallbackZone };
  const tzid = prop.params.TZID;
  const zone = tzid && isTimeZone(tzid) ? tzid : fallbackZone;
  if (utc) {
    return {
      value: localDateTimeOf(`${date}T${h}:${mi}:00Z`, fallbackZone),
      allDay: false,
      zone: fallbackZone,
    };
  }
  return { value: `${date}T${h}:${mi}`, allDay: false, zone };
}

const PRIORITY_FROM = (value: number): Priority =>
  value >= 1 && value <= 4 ? 3 : value === 5 ? 2 : value >= 6 && value <= 9 ? 1 : 0;
const PRIORITY_TO: Record<Priority, string | null> = { 3: '1', 2: '5', 1: '9', 0: null };

const msOf = (value: string, zone: string) =>
  Date.parse(instantOf(datePart(value), timePart(value) ?? '00:00', zone));

/** iCalendar files (each a list) as an import plan. */
export function parseIcal(
  files: readonly { name: string; text: string }[],
  options: { timeZone: string },
): ImportPlan {
  const plan = emptyPlan('ical');
  files.forEach((file, fileIndex) => {
    for (const calendar of components(file.text).filter((each) => each.name === 'VCALENDAR')) {
      const todos = calendar.children.filter((each) => each.name === 'VTODO');
      if (!todos.length) continue;
      const calName = calendar.props.find((prop) => prop.name === 'X-WR-CALNAME')?.value;
      const name = calName
        ? unescape(calName).trim()
        : projectName(file.name.replace(/\.ics$/i, ''));
      const listKey = `${fileIndex}:${plan.lists.length}:${name}`;
      plan.lists.push({ key: listKey, name });
      todos.forEach((todo, index) => {
        const get = (key: string) => todo.props.find((prop) => prop.name === key);
        const all = (key: string) => todo.props.filter((prop) => prop.name === key);
        const start = moment(get('DTSTART'), options.timeZone);
        const dueAt = moment(get('DUE'), options.timeZone);
        const first = start ?? dueAt;
        let schedule: Schedule | null = null;
        let due: ImportedTask['due'] = null;
        if (first) {
          let end: string | null = null;
          const length = get('DURATION') ? durationMinutes(get('DURATION')!.value) : null;
          if (start && !start.allDay && length && length > 0) {
            end = localDateTimeOf(
              new Date(msOf(start.value, start.zone) + length * 60_000).toISOString(),
              start.zone,
            );
          }
          schedule = { start: first.value, end, allDay: first.allDay, timeZone: first.zone };
          if (start && dueAt && dueAt.value !== start.value) {
            due = { at: dueAt.value, allDay: dueAt.allDay, timeZone: dueAt.zone };
          }
        }
        const status = get('STATUS')?.value.trim().toUpperCase();
        const closed = status === 'COMPLETED' ? 'done' : status === 'CANCELLED' ? 'wontdo' : null;
        const completed = moment(get('COMPLETED'), 'UTC');
        const reminders: Reminder[] = [];
        for (const alarm of todo.children.filter((each) => each.name === 'VALARM')) {
          const trigger = alarm.props.find((prop) => prop.name === 'TRIGGER');
          if (!trigger) continue;
          if (trigger.params.VALUE === 'DATE-TIME') {
            const at = moment(trigger, schedule?.timeZone ?? options.timeZone);
            if (at) reminders.push({ at: at.value });
            continue;
          }
          const minutes = durationMinutes(trigger.value);
          // Counted from the due time, when that is not the start: a set time.
          const fromEnd = trigger.params.RELATED === 'END' && due;
          const made =
            !fromEnd && schedule && minutes !== null
              ? reminderFrom(trigger.value, schedule.allDay)
              : null;
          if (made) {
            reminders.push(made);
          } else if (minutes !== null && (fromEnd || schedule)) {
            const anchor = fromEnd ? due!.at : schedule!.start;
            const zone = fromEnd ? due!.timeZone : schedule!.timeZone;
            const base = msOf(anchor, zone);
            reminders.push({
              at: localDateTimeOf(new Date(base + minutes * 60_000).toISOString(), zone),
            });
          } else {
            note(plan, 'reminderDropped');
          }
        }
        const parent = all('RELATED-TO').find(
          (prop) => !prop.params.RELTYPE || prop.params.RELTYPE.toUpperCase() === 'PARENT',
        );
        const uid = get('UID')?.value.trim();
        const rrule = get('RRULE')?.value.trim();
        plan.tasks.push({
          key: uid || `${listKey}#${index}`,
          listKey,
          parentKey: parent?.value.trim() || null,
          title: unescape(get('SUMMARY')?.value ?? '').trim(),
          notes: unescape(get('DESCRIPTION')?.value ?? '').trim(),
          status: closed ?? 'open',
          completedAt:
            closed && completed ? new Date(msOf(completed.value, 'UTC')).toISOString() : null,
          priority: PRIORITY_FROM(Number(get('PRIORITY')?.value ?? 0)),
          schedule,
          due,
          reminders,
          recurrence: rrule || null,
          tags: all('CATEGORIES')
            .flatMap((prop) => prop.value.split(/(?<!\\),/))
            .map((each) => unescape(each).trim())
            .filter(Boolean),
        });
      });
    }
  });
  return plan;
}

/** Content lines folded at 75 octets. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    const limit = parts.length ? 74 : 75;
    if (bytes.encode(current + char).length > limit) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const utcStamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** A local value as iCalendar: a DATE, or the instant in UTC. */
function icalValue(name: string, value: string, zone: string): string {
  if (!timePart(value)) return `${name};VALUE=DATE:${value.replace(/-/g, '')}`;
  return `${name}:${utcStamp(msOf(value, zone))}`;
}

/** A trigger for one of our reminders. */
function trigger(reminder: Reminder, allDay: boolean, zone: string, fromDue: boolean): string {
  if ('at' in reminder) {
    const time = timePart(reminder.at) ?? ALL_DAY_REMINDER_TIME;
    return `TRIGGER;VALUE=DATE-TIME:${utcStamp(msOf(`${datePart(reminder.at)}T${time}`, zone))}`;
  }
  const [h, m] = ALL_DAY_REMINDER_TIME.split(':').map(Number) as [number, number];
  const minutes = allDay ? h * 60 + m - reminder.before : -reminder.before;
  const sign = minutes < 0 ? '-' : '';
  // With no DTSTART, a relative trigger counts from DUE.
  return `TRIGGER${fromDue ? ';RELATED=END' : ''}:${sign}PT${Math.abs(minutes)}M`;
}

/** Each list as an iCalendar file of VTODOs. */
export function exportIcal(
  workspace: WorkspaceFile,
  listIds?: readonly string[] | null,
  options: { now?: Date } = {},
): { name: string; text: string }[] {
  const now = utcStamp((options.now ?? new Date()).getTime());
  const tagNames = new Map(workspace.entities.tags.map((tag) => [tag.id, tag.name]));
  const byList = new Map<string, { name: string; lines: string[] }>();
  for (const { list, task } of walkTasks(workspace, listIds)) {
    const entry = byList.get(list.id) ?? { name: exportName(list), lines: [] };
    byList.set(list.id, entry);
    const zone = task.schedule?.timeZone ?? task.due?.timeZone ?? 'UTC';
    const lines = [
      'BEGIN:VTODO',
      `UID:${task.id}@punchlist`,
      `DTSTAMP:${now}`,
      `CREATED:${utcStamp(Date.parse(task.createdAt))}`,
      `SUMMARY:${escapeText(task.title)}`,
    ];
    if (task.notes) lines.push(`DESCRIPTION:${escapeText(task.notes)}`);
    const schedule = task.schedule;
    if (schedule) {
      lines.push(icalValue('DTSTART', schedule.start, schedule.timeZone));
      if (!schedule.allDay && schedule.end && timePart(schedule.end)) {
        const minutes = Math.round(
          (msOf(schedule.end, schedule.timeZone) - msOf(schedule.start, schedule.timeZone)) /
            60_000,
        );
        if (minutes > 0 && !task.due) lines.push(`DURATION:PT${minutes}M`);
      }
    }
    if (task.due) lines.push(icalValue('DUE', task.due.at, task.due.timeZone));
    else if (schedule && !lines.some((line) => line.startsWith('DURATION'))) {
      lines.push(icalValue('DUE', schedule.start, schedule.timeZone));
    }
    lines.push(
      `STATUS:${task.status === 'done' ? 'COMPLETED' : task.status === 'wontdo' ? 'CANCELLED' : 'NEEDS-ACTION'}`,
    );
    if (task.status !== 'open' && task.completedAt) {
      lines.push(`COMPLETED:${utcStamp(Date.parse(task.completedAt))}`);
    }
    const priority = PRIORITY_TO[task.priority];
    if (priority) lines.push(`PRIORITY:${priority}`);
    const tags = members(task.tags)
      .map((id) => tagNames.get(id))
      .filter((name): name is string => !!name);
    if (tags.length) lines.push(`CATEGORIES:${tags.map(escapeText).join(',')}`);
    if (task.recurrence) lines.push(`RRULE:${plainRule(task.recurrence)}`);
    if (task.parentId) lines.push(`RELATED-TO;RELTYPE=PARENT:${task.parentId}@punchlist`);
    const allDay = schedule ? schedule.allDay : task.due ? task.due.allDay : false;
    for (const reminder of task.reminders ?? []) {
      if (!('at' in reminder) && !schedule && !task.due) continue;
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(task.title)}`,
        trigger(reminder, allDay, zone, !schedule),
        'END:VALARM',
      );
    }
    lines.push('END:VTODO');
    entry.lines.push(...lines);
  }
  return [...byList.values()].map((entry) => ({
    name: `${entry.name}.ics`,
    text:
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Punchlist//Punchlist//EN',
        `X-WR-CALNAME:${escapeText(entry.name)}`,
        ...entry.lines,
        'END:VCALENDAR',
      ]
        .map(fold)
        .join('\r\n') + '\r\n',
  }));
}
