// Quick add (spec: PL-022, R-ENTRY-01): one line of text becomes a task. Dates and times
// ("tomorrow 3pm", "fri 9-11am") set the start; "due ..." sets the due date; #tag, ^list,
// !priority and @person pick those, and "every ..." makes it repeat. Everything recognised comes back as tokens (for the chips
// shown while typing) and is taken out of the title.

import { addDays, weekday } from './dates.ts';
import { visibleLists } from './lists.ts';
import { formatRule, type Recurrence } from './recurrence.ts';
import { createTag, leafName, normalizeTagName, visibleTags } from './tags.ts';
import { createTask, type TaskInput } from './tasks.ts';
import { setAssignee, type AssigneeOption } from './sharing.ts';
import type { DateParser, ParsedMoment } from '../ports/dateParser.ts';
import type { OpContext } from './ops.ts';
import type { Id, List, Priority, Tag, WorkspaceFile } from './types.ts';

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
  /** Now, as the person's wall clock (`wallClock`): "today" and "9am" count from its local parts. */
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
const DAY_LIST = String.raw`${DAY_WORD}(?:(?:\s*,\s*|\s*,?\s+(?:and|&)\s+)${DAY_WORD})*`;
const REPEAT = new RegExp(
  String.raw`(^|\s)every\s+(?:(other)\s+|(\d{1,3})\s+)?` +
    String.raw`(weekdays?|weeks?\s+(?:on\s+)?${DAY_LIST}|(?:day|week|month|year)s?|${DAY_LIST})` +
    String.raw`(?=$|[\s,.;!?])`,
  'i',
);

/**
 * "every day", "every 3 weeks", "every other monday", "every mon, wed and fri", "every weekday",
 * and weeks with their days: "every 2 weeks tue" (as Todoist writes it), "every 3 weeks on monday".
 */
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
  const dayList = what.replace(/^weeks?\s+(?:on\s+)?/, '');
  const days = [...new Set(dayList.split(/\s*,\s*|\s+(?:and|&)\s+|\s+/).filter(Boolean))]
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

/** Lazily built once: the first value per key keeps the earliest item, as `find` would. */
function firstBy<T>(
  items: readonly T[],
  keys: (item: T) => (string | undefined)[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    for (const key of keys(item)) if (key !== undefined && !map.has(key)) map.set(key, item);
  }
  return map;
}

/** ^word: the first list whose compacted name is the word, else the first it starts. */
function listFinder(workspace: WorkspaceFile) {
  let named: { key: string; list: List }[] | null = null;
  let exact: Map<string, { key: string; list: List }> | null = null;
  const seen = new Map<string, List | undefined>();
  return (wanted: string): List | undefined => {
    if (seen.has(wanted)) return seen.get(wanted);
    named ??= visibleLists(workspace).map((list) => ({ key: compact(list.name), list }));
    exact ??= firstBy(named, (each) => [each.key]);
    const found =
      exact.get(wanted)?.list ?? named.find((each) => each.key.startsWith(wanted))?.list;
    seen.set(wanted, found);
    return found;
  };
}

/** #name: a full path, else a unique leaf name ("#yard" for home/yard), else nothing (a new tag). */
function tagFinder(workspace: WorkspaceFile) {
  let byName: Map<string, Tag> | null = null;
  let byLeaf: Map<string, Tag[]> | null = null;
  return (name: string): Tag | undefined => {
    if (!byName || !byLeaf) {
      const known = visibleTags(workspace);
      byName = firstBy(known, (tag) => [tag.name.toLowerCase()]);
      byLeaf = new Map();
      for (const tag of known) {
        const leaf = leafName(tag.name).toLowerCase();
        byLeaf.set(leaf, [...(byLeaf.get(leaf) ?? []), tag]);
      }
    }
    const wanted = name.toLowerCase();
    const leaves = byLeaf.get(wanted) ?? [];
    return (
      byName.get(normalizeTagName(name).toLowerCase()) ??
      (leaves.length === 1 ? leaves[0] : undefined)
    );
  };
}

/**
 * @word: the first person (not an open invite) whose name is the word, ignoring case, spaces,
 * dashes and underscores, or whose handle (or its part before @) is the word.
 */
function personFinder(people: readonly AssigneeOption[]) {
  let plain: Map<string, number> | null = null;
  let compacted: Map<string, number> | null = null;
  return (word: string): AssigneeOption | undefined => {
    if (!plain || !compacted) {
      plain = new Map();
      compacted = new Map();
      people.forEach((each, index) => {
        if (each.principal.startsWith('invite:')) return;
        const handle = each.user?.handle.toLowerCase();
        for (const key of [each.name.toLowerCase(), handle, handle?.split('@')[0]]) {
          if (key !== undefined && !plain!.has(key)) plain!.set(key, index);
        }
        const key = compact(each.name);
        if (!compacted!.has(key)) compacted!.set(key, index);
      });
    }
    const first = Math.min(
      plain.get(word.toLowerCase()) ?? Infinity,
      compacted.get(compact(word)) ?? Infinity,
    );
    return Number.isFinite(first) ? people[first] : undefined;
  };
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

  // The lookups below are built once per reading, only when the line has that kind of word: a
  // long line against a big workspace (1,000 lists or people) must not redo the whole list for
  // every word. The server reads with a memory limit that counts every string made (PL-118).
  let listId: Id | null = null;
  const findList = listFinder(workspace);
  for (const { start, end, word } of sigilWords(text, '^')) {
    if (listId !== null) break;
    const list = findList(compact(word));
    if (list && take('list', start, end)) listId = list.id;
  }

  const tags: QuickAdd['tags'] = [];
  const findTag = tagFinder(workspace);
  for (const { start, end, word } of sigilWords(text, '#')) {
    const name = normalizeTagName(word);
    if (!name || tags.some((tag) => tag.name === name)) continue;
    const tag = findTag(name);
    if (take('tag', start, end))
      tags.push(tag ? { id: tag.id, name: tag.name } : { id: null, name });
  }

  const assignees: string[] = [];
  const findPerson = personFinder(context.people ?? []);
  for (const { start, end, word } of sigilWords(text, '@')) {
    const person = findPerson(word);
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
