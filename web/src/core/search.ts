// Full-text search over tasks (spec: PL-017): every word of the query must appear in the task's
// title, notes or tag names, ignoring case and accents. Title hits rank first, then notes, then
// tags; open tasks come before closed ones. Matches come back as ranges for highlighting.

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
  /** A short piece of the notes around the first match, with its matches; null if none there */
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

/** The words of a query, folded; empty when there is nothing to search for. */
export function queryTerms(query: string): string[] {
  return [...new Set(fold(query).text.split(/\s+/).filter(Boolean))];
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

function rangesOf(folded: Folded, terms: string[]): Range[] {
  const ranges: Range[] = [];
  for (const term of terms) {
    let at = folded.text.indexOf(term);
    while (at !== -1) {
      const start = folded.origin[at]!;
      const end = folded.origin[at + term.length - 1]! + 1;
      ranges.push([start, end]);
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

/** About a line of the notes around the first match, on one line, with the matches in it. */
function snippetOf(notes: string, ranges: Range[]): SearchHit['snippet'] {
  const first = ranges[0];
  if (!first) return null;
  let start = Math.max(0, first[0] - SNIPPET_BEFORE);
  // Start at a word boundary when one is near.
  const space = notes.lastIndexOf(' ', first[0]);
  if (space >= start) start = space + 1;
  const end = Math.min(notes.length, start + SNIPPET_LENGTH);
  const lead = start > 0 ? '…' : '';
  // Each line break becomes one space, so ranges keep their offsets (HTML collapses the runs).
  const body = notes.slice(start, end).replace(/\s/g, ' ');
  const inside = ranges
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]): Range => [a - start + lead.length, b - start + lead.length]);
  return { text: lead + body + (end < notes.length ? '…' : ''), ranges: inside };
}

const SCORE_TITLE = 4;
const SCORE_TITLE_START = 2;
const SCORE_NOTES = 1;

/**
 * Tasks matching every word of `query`, best first. Tasks in deleted lists and deleted tasks are
 * left out; `limit` caps the result.
 */
export function searchTasks(workspace: WorkspaceFile, query: string, limit = 200): SearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const tagNames = new Map(workspace.entities.tags.map((tag) => [tag.id, fold(tag.name).text]));
  const listed = inLiveList(workspace);
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const task of workspace.entities.tasks) {
    if (!isLive(task) || !listed(task)) continue;
    const { title, notes } = foldedTask(task);
    const tags = members(task.tags)
      .map((id) => tagNames.get(id) ?? '')
      .join(' ');
    let score = 0;
    let all = true;
    for (const term of terms) {
      const inTitle = title.text.indexOf(term);
      if (inTitle !== -1) {
        score +=
          SCORE_TITLE + (inTitle === 0 || title.text[inTitle - 1] === ' ' ? SCORE_TITLE_START : 0);
      } else if (notes.text.includes(term)) {
        score += SCORE_NOTES;
      } else if (!tags.includes(term)) {
        all = false;
        break;
      }
    }
    if (!all) continue;
    const noteRanges = rangesOf(notes, terms);
    scored.push({
      score: score + (task.status === 'open' ? 100 : 0),
      hit: { task, title: rangesOf(title, terms), snippet: snippetOf(task.notes, noteRanges) },
    });
  }
  scored.sort(
    (a, b) => b.score - a.score || b.hit.task.createdAt.localeCompare(a.hit.task.createdAt),
  );
  return scored.slice(0, limit).map((each) => each.hit);
}
