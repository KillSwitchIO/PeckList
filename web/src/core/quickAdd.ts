// Quick add (spec: PL-022, R-ENTRY-01): one line of text becomes a task. Dates and times
// ("tomorrow 3pm", "fri 9-11am") set the start; "due ..." sets the due date; #tag, ^list,
// !priority and @person pick those, and "every ..." makes it repeat. Everything recognised comes back as tokens (for the chips
// shown while typing) and is taken out of the title.

import { addDays, weekday } from './dates.ts';
import { visibleLists } from './lists.ts';
import { formatRule, type Recurrence } from './recurrence.ts';
import { createTag, findTagByName, leafName, normalizeTagName, visibleTags } from './tags.ts';
import { createTask, type TaskInput } from './tasks.ts';
import { setAssignee, type AssigneeOption } from './sharing.ts';
import type { DateParser, ParsedMoment } from '../ports/dateParser.ts';
import type { OpContext } from './ops.ts';
import type { Id, Priority, WorkspaceFile } from './types.ts';

export type TokenKind = 'date' | 'due' | 'tag' | 'list' | 'priority' | 'person' | 'repeat';

export interface Token {
  kind: TokenKind;
  /** Where it sits in the text (`end` exclusive), and the text itself */
  start: number;
  end: number;
  text: string;
}

export interface QuickAdd {
  title: string;
  tokens: Token[];
  schedule: { start: ParsedMoment; end: ParsedMoment | null } | null;
  due: ParsedMoment | null;
  priority: Priority | null;
  listId: Id | null;
  /** Existing tags by id; new ones by name (made when the task is saved) */
  tags: { id: Id | null; name: string }[];
  assignees: string[];
  /** How it repeats (RRULE text), from "every day", "every other week", "every mon and thu" */
  recurrence: string | null;
}

export interface QuickAddContext {
  workspace: WorkspaceFile;
  parser: DateParser;
  /** "Now", for relative dates */
  reference: Date;
  /** Who @ can name (the assignee picker's people); none without a server */
  people?: readonly AssigneeOption[];
  /** Token texts the user turned back into plain words (clicked a chip off) */
  ignore?: ReadonlySet<string>;
}

const PRIORITY_WORDS: Record<string, Priority> = {
  high: 3,
  h: 3,
  '1': 3,
  medium: 2,
  med: 2,
  m: 2,
  '2': 2,
  low: 1,
  l: 1,
  '3': 1,
  none: 0,
  '0': 0,
};

const compact = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, '');

/** Words that start at a space (or the beginning) and begin with `sigil`. */
function sigilWords(text: string, sigil: string): { start: number; end: number; word: string }[] {
  const found: { start: number; end: number; word: string }[] = [];
  const pattern = new RegExp(`(^|\\s)\\${sigil}(\\S+)`, 'g');
  for (const match of text.matchAll(pattern)) {
    const start = match.index + match[1]!.length;
    found.push({ start, end: start + 1 + match[2]!.length, word: match[2]! });
  }
  return found;
}

const UNIT_FREQ = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' } as const;
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_WORD = String.raw`(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?s?`;
const REPEAT = new RegExp(
  String.raw`(^|\s)every\s+(?:(other)\s+|(\d{1,3})\s+)?` +
    String.raw`(weekdays?|(?:day|week|month|year)s?|${DAY_WORD}(?:(?:\s*,\s*|\s*,?\s+(?:and|&)\s+)${DAY_WORD})*)` +
    String.raw`(?=$|[\s,.;!?])`,
  'i',
);

/** "every day", "every 3 weeks", "every other monday", "every mon, wed and fri", "every weekday". */
function findRepeat(text: string): { start: number; end: number; rule: Recurrence } | null {
  const match = REPEAT.exec(text);
  if (!match) return null;
  const interval = match[2] ? 2 : match[3] ? Number(match[3]) : 1;
  if (interval < 1) return null;
  const what = match[4]!.toLowerCase();
  const start = match.index + match[1]!.length;
  const end = match.index + match[0].length;
  if (/^weekdays?$/.test(what)) {
    const byDay = [1, 2, 3, 4, 5].map((day) => ({ weekday: day }));
    return { start, end, rule: { freq: 'WEEKLY', interval, byDay } };
  }
  const unit = /^(day|week|month|year)s?$/.exec(what);
  if (unit) {
    return { start, end, rule: { freq: UNIT_FREQ[unit[1] as keyof typeof UNIT_FREQ], interval } };
  }
  const days = [...new Set(what.split(/\s*,\s*|\s+(?:and|&)\s+|\s+/).filter(Boolean))]
    .map((word) => DAY_NAMES.indexOf(word.slice(0, 3)))
    .filter((day) => day >= 0);
  if (!days.length) return null;
  return {
    start,
    end,
    rule: { freq: 'WEEKLY', interval, byDay: [...new Set(days)].map((day) => ({ weekday: day })) },
  };
}

/** The local date of `reference`. */
const localDate = (reference: Date) =>
  `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, '0')}-${String(reference.getDate()).padStart(2, '0')}`;

/** The first of a weekly rule's days on or after `date` (any date for other rules). */
function firstOn(rule: Recurrence, date: string): string {
  if (rule.freq !== 'WEEKLY' || !rule.byDay?.length) return date;
  let at = date;
  while (!rule.byDay.some((day) => day.weekday === weekday(at))) at = addDays(at, 1);
  return at;
}

export function parseQuickAdd(text: string, context: QuickAddContext): QuickAdd {
  const { workspace, ignore = new Set<string>() } = context;
  const tokens: Token[] = [];
  const take = (kind: TokenKind, start: number, end: number) => {
    const piece = text.slice(start, end);
    if (ignore.has(piece)) return false;
    tokens.push({ kind, start, end, text: piece });
    return true;
  };

  let priority: Priority | null = null;
  for (const { start, end, word } of sigilWords(text, '!')) {
    const value = PRIORITY_WORDS[word.toLowerCase()];
    if (value !== undefined && priority === null && take('priority', start, end)) priority = value;
  }

  let listId: Id | null = null;
  const lists = visibleLists(workspace);
  for (const { start, end, word } of sigilWords(text, '^')) {
    const wanted = compact(word);
    const list =
      lists.find((each) => compact(each.name) === wanted) ??
      lists.find((each) => compact(each.name).startsWith(wanted));
    if (list && listId === null && take('list', start, end)) listId = list.id;
  }

  const tags: QuickAdd['tags'] = [];
  const known = visibleTags(workspace);
  for (const { start, end, word } of sigilWords(text, '#')) {
    const name = normalizeTagName(word);
    if (!name || tags.some((tag) => tag.name === name)) continue;
    // A full path, else a unique leaf name ("#yard" for home/yard), else a new tag.
    const exact = findTagByName(workspace, name);
    const leaves = known.filter((tag) => leafName(tag.name).toLowerCase() === name.toLowerCase());
    const tag = exact ?? (leaves.length === 1 ? leaves[0] : undefined);
    if (take('tag', start, end))
      tags.push(tag ? { id: tag.id, name: tag.name } : { id: null, name });
  }

  const assignees: string[] = [];
  for (const { start, end, word } of sigilWords(text, '@')) {
    const wanted = word.toLowerCase();
    const person = context.people?.find(
      (each) =>
        !each.principal.startsWith('invite:') &&
        (each.name.toLowerCase() === wanted ||
          compact(each.name) === compact(word) ||
          each.user?.handle.toLowerCase() === wanted ||
          each.user?.handle.toLowerCase().split('@')[0] === wanted),
    );
    if (person && !assignees.includes(person.principal) && take('person', start, end)) {
      assignees.push(person.principal);
    }
  }

  // "every ...", before the dates so "every monday" is not just next Monday.
  let rule: Recurrence | null = null;
  const repeat = findRepeat(text);
  if (repeat && !tokens.some((token) => token.start < repeat.end && repeat.start < token.end)) {
    if (take('repeat', repeat.start, repeat.end)) rule = repeat.rule;
  }

  // Dates, in the text with the tokens above blanked out (positions stay the same).
  let masked = text;
  for (const token of tokens) {
    masked =
      masked.slice(0, token.start) + ' '.repeat(token.end - token.start) + masked.slice(token.end);
  }
  let schedule: QuickAdd['schedule'] = null;
  let due: ParsedMoment | null = null;
  for (const match of context.parser.find(masked, context.reference)) {
    // "due fri", "due by friday": the word belongs to the token.
    const before = masked.slice(0, match.index);
    const lead = /(^|\s)(due(\s+(by|on))?)\s+$/i.exec(before);
    if (lead && due === null) {
      const start = lead.index + lead[1]!.length;
      if (take('due', start, match.index + match.length)) due = match.start;
    } else if (!lead && schedule === null) {
      if (take('date', match.index, match.index + match.length)) {
        schedule = { start: match.start, end: match.end };
      }
    }
  }

  // A repeat counts from a date: the one given, moved to the first of its weekdays, else today.
  if (rule) {
    if (schedule) {
      const date = firstOn(rule, schedule.start.date);
      schedule = {
        start: { ...schedule.start, date },
        end:
          schedule.end && schedule.start.date === schedule.end.date
            ? { ...schedule.end, date }
            : schedule.end,
      };
    } else if (!due) {
      schedule = {
        start: { date: firstOn(rule, localDate(context.reference)), time: null },
        end: null,
      };
    }
  }

  tokens.sort((a, b) => a.start - b.start);
  let title = '';
  let at = 0;
  for (const token of tokens) {
    title += text.slice(at, token.start);
    at = token.end;
  }
  title += text.slice(at);
  title = title.replace(/\s+/g, ' ').trim();

  const recurrence = rule ? formatRule(rule) : null;
  return { title, tokens, schedule, due, priority, listId, tags, assignees, recurrence };
}

const asValue = (moment: ParsedMoment) =>
  moment.time ? `${moment.date}T${moment.time}` : moment.date;

/**
 * Make the task a quick add describes: new tags first, then the task in its list (or the
 * defaults' list), then its assignees.
 */
export function createFromQuickAdd(
  ctx: OpContext,
  workspace: WorkspaceFile,
  parsed: QuickAdd,
  defaults: Omit<TaskInput, 'title'>,
  timeZone: string,
): { workspace: WorkspaceFile; id: Id } {
  let next = workspace;
  const tagIds: Id[] = [...(defaults.tags ?? [])];
  for (const tag of parsed.tags) {
    if (tag.id) {
      tagIds.push(tag.id);
    } else {
      const made = createTag(ctx, next, tag.name);
      next = made.workspace;
      tagIds.push(made.tag.id);
    }
  }
  const input: TaskInput = {
    ...defaults,
    title: parsed.title,
    ...(parsed.listId ? { listId: parsed.listId, sectionId: null } : {}),
    ...(parsed.priority !== null ? { priority: parsed.priority } : {}),
    ...(tagIds.length ? { tags: [...new Set(tagIds)] } : {}),
    ...(parsed.recurrence ? { recurrence: parsed.recurrence } : {}),
  };
  if (parsed.schedule) {
    input.schedule = {
      start: asValue(parsed.schedule.start),
      end: parsed.schedule.end ? asValue(parsed.schedule.end) : null,
      allDay: parsed.schedule.start.time === null,
      timeZone,
    };
  }
  if (parsed.due) {
    input.due = { at: asValue(parsed.due), allDay: parsed.due.time === null, timeZone };
  }
  // People named with @ take the place of the default assignee.
  if (parsed.assignees.length > 0) delete input.assignees;
  const made = createTask(ctx, next, input);
  next = made.workspace;
  for (const principal of parsed.assignees) {
    next = setAssignee(ctx, next, made.task.id, principal, true);
  }
  return { workspace: next, id: made.task.id };
}
