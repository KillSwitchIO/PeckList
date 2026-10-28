// Full-text search over tasks (spec: PL-017; ranked with BM25, R-FB-142). Built the way Obsidian's
// Omnisearch builds its search: a MiniSearch index (BM25+) over a few weighted fields, the title
// weighed most, then tags, the list's name, the parent task, the notes, comments and file names;
// prefix matches as the words are typed, a little fuzziness for longer words, and a big lift for a
// title that starts with the whole query. Every word must match somewhere; tasks that only hold a
// word inside another ("paint" in "Repaint") still come, after the rest. `"a phrase"` must appear
// as written, `-word` leaves out tasks with it, and `#tag` asks for a tag. Ignoring case and
// accents throughout; open tasks come before closed ones. Matches come back as ranges for
// highlighting.

import MiniSearch, { type Query, type SearchResult } from 'minisearch';
import { isLive } from './collections.ts';
import { inLiveList } from './filters.ts';
import { members } from './ops.ts';
import type { Task, WorkspaceFile } from './types.ts';

/** A half-open range `[start, end)` in the original text. */
export type Range = readonly [number, number];

export interface SearchHit {
  task: Task;
  /** Matches in the title */
  title: Range[];
  /** A short piece of the notes (or else a comment) around the first match, with its matches */
  snippet: { text: string; ranges: Range[] } | null;
}

/**
 * Text folded for matching (lower case, accents off) with, for each folded character, where it
 * came from in the original, so ranges map back exactly.
 */
interface Folded {
  text: string;
  origin: number[];
}

const MARKS = /\p{M}/gu;

function fold(text: string): Folded {
  let folded = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const plain = text[i]!.normalize('NFD').replace(MARKS, '').toLowerCase();
    for (let k = 0; k < plain.length; k += 1) origin.push(i);
    folded += plain;
  }
  return { text: folded, origin };
}

const foldText = (text: string) => text.normalize('NFD').replace(MARKS, '').toLowerCase();

/** Words: runs of letters and digits. */
const WORDS = /[\p{L}\p{N}]+/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const wordsOf = (text: string) => foldText(text).match(WORDS) ?? [];

/** The words of a query, folded; empty when there is nothing to search for. */
export function queryTerms(query: string): string[] {
  return [...new Set(fold(query).text.split(/\s+/).filter(Boolean))];
}

/** A query taken apart: the words to rank by, phrases, words to leave out, tags asked for. */
export interface ParsedQuery {
  words: string[];
  phrases: string[];
  without: string[];
  tags: string[];
}

export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { words: [], phrases: [], without: [], tags: [] };
  const rest = foldText(query).replace(/"([^"]*)"?/g, (_, phrase: string) => {
    const words = phrase.match(WORDS);
    if (words) {
      parsed.phrases.push(words.join(' '));
      parsed.words.push(...words);
    }
    return ' ';
  });
  for (const token of rest.split(/\s+/)) {
    if (token.startsWith('-') && token.length > 1) {
      parsed.without.push(...(token.slice(1).match(WORDS) ?? []));
    } else if (token.startsWith('#') && token.length > 1) {
      const name = token.replace(/^#+/, '');
      if (name) parsed.tags.push(name);
    } else {
      parsed.words.push(...(token.match(WORDS) ?? []));
    }
  }
  parsed.words = [...new Set(parsed.words)];
  return parsed;
}

// Folding is the slow part; entities never change in place, so each folds once.
const cache = new WeakMap<object, { title: Folded; notes: Folded }>();

function foldedTask(task: Task) {
  let entry = cache.get(task);
  if (!entry) {
    entry = { title: fold(task.title), notes: fold(task.notes) };
    cache.set(task, entry);
  }
  return entry;
}

/** Where `terms` appear in `folded`; with `wordStart`, only at the start of a word. */
function rangesOf(folded: Folded, terms: string[], wordStart = false): Range[] {
  const ranges: Range[] = [];
  for (const term of terms) {
    let at = folded.text.indexOf(term);
    while (at !== -1) {
      if (!wordStart || at === 0 || !WORD_CHAR.test(folded.text[at - 1]!)) {
        const start = folded.origin[at]!;
        const end = folded.origin[at + term.length - 1]! + 1;
        ranges.push([start, end]);
      }
      at = folded.text.indexOf(term, at + term.length);
    }
  }
  // Sorted and merged, so highlighting never nests.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1])
      merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
    else merged.push(range);
  }
  return merged;
}

const SNIPPET_BEFORE = 30;
const SNIPPET_LENGTH = 140;

/** About a line of `text` around the first match, on one line, with the matches in it. */
function snippetOf(text: string, ranges: Range[]): SearchHit['snippet'] {
  const first = ranges[0];
  if (!first) return null;
  let start = Math.max(0, first[0] - SNIPPET_BEFORE);
  // Start at a word boundary when one is near.
  const space = text.lastIndexOf(' ', first[0]);
  if (space >= start) start = space + 1;
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const lead = start > 0 ? '…' : '';
  // Each line break becomes one space, so ranges keep their offsets (HTML collapses the runs).
  const body = text.slice(start, end).replace(/\s/g, ' ');
  const inside = ranges
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]): Range => [a - start + lead.length, b - start + lead.length]);
  return { text: lead + body + (end < text.length ? '…' : ''), ranges: inside };
}

// --- The index -------------------------------------------------------------------------------

/** What is indexed for one task. */
interface TaskDoc {
  id: string;
  title: string;
  tags: string;
  list: string;
  parent: string;
  notes: string;
  comments: string;
  files: string;
}

const FIELDS = ['title', 'tags', 'list', 'parent', 'notes', 'comments', 'files'] as const;

/** How much a match in each field counts (Omnisearch weighs a note's name and tags most). */
const BOOST: Record<(typeof FIELDS)[number], number> = {
  title: 3,
  tags: 2,
  list: 1.5,
  parent: 1,
  notes: 1,
  comments: 0.7,
  files: 0.7,
};

/** A title that starts with the whole query is very likely the one (Omnisearch does the same). */
const TITLE_START_LIFT = 10;
/** Tasks that only hold the words inside others come after every ranked one. */
const INSIDE_SCORE = 0.001;

function newIndex() {
  return new MiniSearch<TaskDoc>({
    fields: [...FIELDS],
    storeFields: [],
    tokenize: (text) => text.match(WORDS) ?? [],
    processTerm: (term) => foldText(term),
  });
}

const index = newIndex();
const indexed = new Map<string, TaskDoc>();
/** Each indexed task's fields, folded and joined: for words inside words, phrases, -words. */
const foldedDocs = new Map<string, string>();

const sameDoc = (a: TaskDoc, b: TaskDoc) => FIELDS.every((field) => a[field] === b[field]);

// The comments and files of each task, gathered once per version of those collections.
const byTaskCache = new WeakMap<object, Map<string, string>>();
function textByTask<T extends { taskId: string; deletedAt: string | null }>(
  entities: readonly T[],
  text: (entity: T) => string,
): Map<string, string> {
  let map = byTaskCache.get(entities);
  if (!map) {
    const parts = new Map<string, string[]>();
    for (const entity of entities) {
      if (entity.deletedAt !== null) continue;
      const list = parts.get(entity.taskId) ?? [];
      list.push(text(entity));
      parts.set(entity.taskId, list);
    }
    map = new Map([...parts].map(([id, list]) => [id, list.join('\n')]));
    byTaskCache.set(entities, map);
  }
  return map;
}

/** Brings the index up to `workspace`, adding, replacing and dropping only what changed. */
function syncIndex(workspace: WorkspaceFile, live: Task[]) {
  const tagNames = new Map(workspace.entities.tags.map((tag) => [tag.id, tag.name]));
  const listNames = new Map(workspace.entities.lists.map((list) => [list.id, list.name]));
  const titles = new Map(workspace.entities.tasks.map((task) => [task.id, task.title]));
  const comments = textByTask(workspace.entities.comments, (comment) => comment.body);
  const files = textByTask(workspace.entities.attachments, (file) => file.name);
  const seen = new Set<string>();
  for (const task of live) {
    seen.add(task.id);
    const doc: TaskDoc = {
      id: task.id,
      title: task.title,
      tags: members(task.tags)
        .map((id) => (tagNames.get(id) ?? '').replace(/\//g, ' '))
        .join(' '),
      list: listNames.get(task.listId) ?? '',
      parent: task.parentId ? (titles.get(task.parentId) ?? '') : '',
      notes: task.notes,
      comments: comments.get(task.id) ?? '',
      files: files.get(task.id) ?? '',
    };
    const before = indexed.get(task.id);
    if (before && sameDoc(before, doc)) continue;
    if (before) index.replace(doc);
    else index.add(doc);
    indexed.set(task.id, doc);
    foldedDocs.set(task.id, foldText(FIELDS.map((field) => doc[field]).join('\n')));
  }
  for (const id of [...indexed.keys()]) {
    if (seen.has(id)) continue;
    index.discard(id);
    indexed.delete(id);
    foldedDocs.delete(id);
  }
}

/** Prefix matches as a word is typed; fuzziness only for longer words (as Omnisearch). */
const prefix = (term: string) => term.length >= 2;
const fuzzy = (term: string) => (term.length <= 3 ? 0 : term.length <= 5 ? 0.1 : 0.2);

/**
 * Tasks matching every word of `query`, best first. Tasks in deleted lists and deleted tasks are
 * left out; `limit` caps the result.
 */
export function searchTasks(workspace: WorkspaceFile, query: string, limit = 200): SearchHit[] {
  const parsed = parseQuery(query);
  if (parsed.words.length === 0 && parsed.tags.length === 0) return [];
  // Search finds archived lists' tasks too.
  const listed = inLiveList(workspace, 'all');
  const live = workspace.entities.tasks.filter((task) => isLive(task) && listed(task));
  syncIndex(workspace, live);
  const byId = new Map(live.map((task) => [task.id, task]));

  const queries: Query[] = [];
  if (parsed.words.length > 0) {
    queries.push({ queries: parsed.words, combineWith: 'AND', prefix, fuzzy, boost: BOOST });
  }
  for (const tag of parsed.tags) {
    queries.push({ queries: wordsOf(tag), combineWith: 'AND', fields: ['tags'], prefix });
  }
  const ranked: SearchResult[] = index.search({ queries, combineWith: 'AND' });

  // Every word somewhere, if only inside another word: after the ranked ones.
  const found = new Set(ranked.map((result) => result.id as string));
  const inside = new Set<string>();
  if (parsed.tags.length === 0) {
    for (const task of live) {
      if (found.has(task.id)) continue;
      const text = foldedDocs.get(task.id)!;
      if (parsed.words.every((word) => text.includes(word))) inside.add(task.id);
    }
  }
  const results = [
    ...ranked.map((result) => ({
      id: result.id as string,
      score: result.score,
      terms: result.terms,
    })),
    ...[...inside].map((id) => ({ id, score: INSIDE_SCORE, terms: [] as string[] })),
  ];

  const whole = foldText(query.replace(/(^|\s)[-#]\S*/g, ' ').replace(/"/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
  const scored: { task: Task; terms: string[]; score: number }[] = [];
  for (const result of results) {
    const task = byId.get(result.id);
    if (!task) continue;
    if (parsed.phrases.length > 0 || parsed.without.length > 0) {
      const words = ` ${(foldedDocs.get(task.id)!.match(WORDS) ?? []).join(' ')} `;
      if (!parsed.phrases.every((phrase) => words.includes(` ${phrase} `))) continue;
      if (parsed.without.some((word) => words.includes(` ${word}`))) continue;
    }
    let score = result.score;
    if (whole && foldText(task.title).startsWith(whole)) score *= TITLE_START_LIFT;
    scored.push({ task, terms: [...new Set([...result.terms, ...parsed.words])], score });
  }
  scored.sort(
    (a, b) =>
      Number(b.task.status === 'open') - Number(a.task.status === 'open') ||
      b.score - a.score ||
      b.task.createdAt.localeCompare(a.task.createdAt),
  );

  return scored.slice(0, limit).map(({ task, terms }) => {
    const { title, notes } = foldedTask(task);
    // Matches inside words are marked where they are; the rest at the start of words.
    const wordStart = !inside.has(task.id);
    const longestFirst = [...terms].sort((a, b) => b.length - a.length);
    let snippet = snippetOf(task.notes, rangesOf(notes, longestFirst, wordStart));
    if (!snippet) {
      const said = indexed.get(task.id)!.comments;
      if (said) snippet = snippetOf(said, rangesOf(fold(said), longestFirst, wordStart));
    }
    return { task, title: rangesOf(title, longestFirst, wordStart), snippet };
  });
}
