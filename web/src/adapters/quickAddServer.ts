// Quick add as the server runs it (PL-137): scripts/build-quick-add.mjs bundles this file, the
// app's own quickAdd.ts and its chrono date parser into one script, which the server runs in Jint.
// So the app and the task API read a line the same way. Nothing in the app imports this file.
//
// One call: JSON in, JSON out.
//   in:  { text, reference: "2026-11-09T14:30" (the person's wall clock), lists: [{ id, name, isInbox }],
//          tags: [{ id, name }], people: [{ principal, name, handle }],
//          language: "de" (optional: the person's picked language; English is always read too) }
//   out: { title, tokens, schedule, due, priority, listId, tags, assignees, recurrence }

import * as german from 'chrono-node/de';
import * as spanish from 'chrono-node/es';
import * as french from 'chrono-node/fr';
import { createChronoDateParser } from './chrono-date-parser.ts';
import { parseQuickAdd } from '../core/quickAdd.ts';
import { quickAddLanguage } from '../core/quickAddWords.ts';
import type { DateParser } from '../ports/dateParser.ts';
import type { AssigneeOption } from '../core/sharing.ts';
import type { WorkspaceFile } from '../core/types.ts';

interface Request {
  text: string;
  reference: string;
  lists: { id: string; name: string; isInbox: boolean }[];
  tags: { id: string; name: string }[];
  people: { principal: string; name: string; handle: string | null }[];
  language?: string | null;
}

// Every language's parser is in the bundle (PL-148), each made the first time it is wanted.
const LOCALES = { de: german.casual, es: spanish.casual, fr: french.casual } as const;
const parsers = new Map<string, DateParser>();
function parserFor(language: string): DateParser {
  let parser = parsers.get(language);
  if (!parser) {
    const casual = LOCALES[language as keyof typeof LOCALES];
    parser = casual ? createChronoDateParser({ language, casual }) : createChronoDateParser();
    parsers.set(language, parser);
  }
  return parser;
}

function quickAdd(input: string): string {
  const request = JSON.parse(input) as Request;
  // The wall clock, read as local time; the server runs the engine with UTC as its local zone, so
  // no daylight saving gap moves it.
  const [day = '', time = ''] = request.reference.split('T');
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const reference = new Date(year, month - 1, date, hour, minute);
  // Only what quick add reads: lists in the order given (the inbox first), and tags.
  const workspace = {
    entities: {
      lists: request.lists.map((list, at) => ({
        ...list,
        order: String(at).padStart(6, '0'),
        deletedAt: null,
        archived: false,
      })),
      tags: request.tags.map((tag) => ({ ...tag, deletedAt: null })),
    },
  } as unknown as WorkspaceFile;
  const people = request.people.map((person) => ({
    principal: person.principal,
    name: person.name,
    depth: 0,
    color: '#000000',
    user: person.handle ? { handle: person.handle } : null,
  })) as unknown as AssigneeOption[];
  const language = quickAddLanguage(request.language ?? undefined);
  const parsed = parseQuickAdd(request.text, {
    workspace,
    parser: parserFor(language),
    reference,
    people,
    language,
  });
  return JSON.stringify({
    title: parsed.title,
    tokens: parsed.tokens.map(({ kind, start, end, text }) => ({ kind, start, end, text })),
    schedule: parsed.schedule,
    due: parsed.due,
    priority: parsed.priority,
    listId: parsed.listId,
    tags: parsed.tags,
    assignees: parsed.assignees,
    recurrence: parsed.recurrence,
  });
}

(globalThis as { quickAdd?: typeof quickAdd }).quickAdd = quickAdd;
