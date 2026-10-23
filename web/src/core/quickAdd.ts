// Quick add (spec: PL-022, R-ENTRY-01): one line of text becomes a task. Dates and times
// ("tomorrow 3pm", "fri 9-11am") set the start; "due ..." sets the due date; #tag, ^list,
// !priority and @person pick those. Everything recognised comes back as tokens (for the chips
// shown while typing) and is taken out of the title.

import { visibleLists } from './lists.ts';
import { createTag, findTagByName, leafName, normalizeTagName, visibleTags } from './tags.ts';
import { createTask, type TaskInput } from './tasks.ts';
import { setAssignee, type AssigneeOption } from './sharing.ts';
import type { DateParser, ParsedMoment } from '../ports/dateParser.ts';
import type { OpContext } from './ops.ts';
import type { Id, Priority, WorkspaceFile } from './types.ts';

export type TokenKind = 'date' | 'due' | 'tag' | 'list' | 'priority' | 'person';

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

  tokens.sort((a, b) => a.start - b.start);
  let title = '';
  let at = 0;
  for (const token of tokens) {
    title += text.slice(at, token.start);
    at = token.end;
  }
  title += text.slice(at);
  title = title.replace(/\s+/g, ' ').trim();

  return { title, tokens, schedule, due, priority, listId, tags, assignees };
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
