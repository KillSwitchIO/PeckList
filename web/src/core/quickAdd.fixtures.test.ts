// The shared quick-add cases (schema/fixtures/quick-add/cases.json): the app reads a line of text
// exactly as the server's task API does (PL-137). The server's QuickAddTests read the same file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChronoDateParser } from '../adapters/chrono-date-parser.ts';
import { parseQuickAdd } from './quickAdd.ts';
import type { AssigneeOption } from './sharing.ts';
import type { WorkspaceFile } from './types.ts';

interface Fixture {
  reference: string;
  lists: { id: string; name: string; isInbox: boolean }[];
  tags: { id: string; name: string }[];
  people: { principal: string; name: string; handle: string | null }[];
  cases: ({ text: string } & Record<string, unknown>)[];
}

const FILE = resolve(process.cwd(), '../schema/fixtures/quick-add/cases.json');
const fixture = JSON.parse(readFileSync(FILE, 'utf8')) as Fixture;

// The person's wall clock, read as local time (as the app passes it).
const [day, time] = fixture.reference.split('T') as [string, string];
const [year, month, date] = day.split('-').map(Number) as [number, number, number];
const [hour, minute] = time.split(':').map(Number) as [number, number];
const reference = new Date(year, month - 1, date, hour, minute);

const workspace = {
  entities: {
    lists: fixture.lists.map((list, at) => ({
      ...list,
      order: String.fromCharCode(86 + at),
      deletedAt: null,
      archived: false,
    })),
    tags: fixture.tags.map((tag) => ({ ...tag, deletedAt: null })),
  },
} as unknown as WorkspaceFile;

const people = fixture.people.map((person) => ({
  principal: person.principal,
  name: person.name,
  depth: 0,
  color: '#000000',
  user: person.handle ? { handle: person.handle } : null,
})) as unknown as AssigneeOption[];

const parser = createChronoDateParser();

describe('quick add, as the server reads it (PL-137)', () => {
  it('has the shared cases', () => {
    expect(fixture.cases.length).toBeGreaterThan(80);
  });

  it.each(fixture.cases.map((each) => [each.text, each] as const))('%s', (text, expected) => {
    const parsed = parseQuickAdd(text, { workspace, parser, reference, people });
    const want = Object.fromEntries(Object.entries(expected).filter(([key]) => key !== 'text'));
    expect({
      title: parsed.title,
      tokens: parsed.tokens.map(({ kind, start, end, text: piece }) => ({
        kind,
        start,
        end,
        text: piece,
      })),
      schedule: parsed.schedule,
      due: parsed.due,
      priority: parsed.priority,
      listId: parsed.listId,
      tags: parsed.tags,
      assignees: parsed.assignees,
      recurrence: parsed.recurrence,
    }).toEqual(want);
  });
});
