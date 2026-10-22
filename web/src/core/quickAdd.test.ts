import { describe, expect, it } from 'vitest';
import { createChronoDateParser } from '../adapters/chrono-date-parser.ts';
import { testContext } from '../test/fixtures.ts';
import { createList, inboxList } from './lists.ts';
import { createFromQuickAdd, parseQuickAdd, type QuickAddContext } from './quickAdd.ts';
import { assigneesOf, type AssigneeOption } from './sharing.ts';
import { createTag } from './tags.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

// Wednesday, Oct 21 2026, 10:00 local time.
const REFERENCE = new Date(2026, 9, 21, 10, 0);
const parser = createChronoDateParser();

function world() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const garden = createList(ctx, ws, { name: 'Garden Plans', color: '#CFE3A3' });
  ws = garden.workspace;
  ws = createTag(ctx, ws, 'home/yard', '#A8DCC0').workspace;
  const context = (extra: Partial<QuickAddContext> = {}): QuickAddContext => ({
    workspace: ws,
    parser,
    reference: REFERENCE,
    ...extra,
  });
  return { ctx, ws: () => ws, garden: garden.list.id, context };
}

describe('quick add', () => {
  it('reads a start date and time, and keeps the rest as the title', () => {
    const w = world();
    const parsed = parseQuickAdd('Call mom tomorrow 3pm', w.context());
    expect(parsed.title).toBe('Call mom');
    expect(parsed.schedule).toEqual({ start: { date: '2026-10-22', time: '15:00' }, end: null });
    expect(parsed.tokens.map((token) => [token.kind, token.text])).toEqual([
      ['date', 'tomorrow 3pm'],
    ]);
  });

  it('reads ranges and a due date', () => {
    const w = world();
    const span = parseQuickAdd('Workshop fri 9am to 11am', w.context());
    expect(span.schedule).toEqual({
      start: { date: '2026-10-23', time: '09:00' },
      end: { date: '2026-10-23', time: '11:00' },
    });
    const due = parseQuickAdd('Taxes due oct 30', w.context());
    expect(due.title).toBe('Taxes');
    expect(due.due).toEqual({ date: '2026-10-30', time: null });
    expect(due.schedule).toBeNull();
    const both = parseQuickAdd('Draft report monday due by friday', w.context());
    expect([both.schedule?.start.date, both.due?.date, both.title]).toEqual([
      '2026-10-26',
      '2026-10-23',
      'Draft report',
    ]);
  });

  it('reads #tags (paths, leaf names, new ones), ^list and !priority', () => {
    const w = world();
    const parsed = parseQuickAdd('Rake leaves #yard #weekend ^garden !high', w.context());
    expect(parsed.title).toBe('Rake leaves');
    expect(parsed.tags.map((tag) => [tag.name, tag.id !== null])).toEqual([
      ['home/yard', true],
      ['weekend', false],
    ]);
    expect(parsed.listId).toBe(w.garden);
    expect(parsed.priority).toBe(3);
    expect(parseQuickAdd('Nap !3', w.context()).priority).toBe(1);
    // Unknown lists and priorities stay words.
    const plain = parseQuickAdd('Ask about ^nowhere !maybe', w.context());
    expect(plain.title).toBe('Ask about ^nowhere !maybe');
  });

  it('@ names people from the picker, and a chip turned off stays text', () => {
    const w = world();
    const people = [
      {
        principal: 'user:01JBSAM0000000000000000002',
        name: 'Sam',
        depth: 0,
        color: '#000000',
        user: null,
      },
    ] as AssigneeOption[];
    const parsed = parseQuickAdd('Fix fence @sam tomorrow', w.context({ people }));
    expect(parsed.assignees).toEqual(['user:01JBSAM0000000000000000002']);
    expect(parsed.title).toBe('Fix fence');
    const kept = parseQuickAdd(
      'Fix fence @sam tomorrow',
      w.context({ people, ignore: new Set(['tomorrow']) }),
    );
    expect(kept.title).toBe('Fix fence tomorrow');
    expect(kept.schedule).toBeNull();
  });

  it('makes the task, with new tags, in the named list', () => {
    const w = world();
    const parsed = parseQuickAdd('Plant bulbs sat 10am #fall ^garden !2', w.context());
    const made = createFromQuickAdd(
      w.ctx,
      w.ws(),
      parsed,
      { listId: inboxList(w.ws()).id },
      'America/Chicago',
    );
    const task = made.workspace.entities.tasks.find((each) => each.id === made.id)!;
    expect(task).toMatchObject({
      title: 'Plant bulbs',
      listId: w.garden,
      priority: 2,
      schedule: {
        start: '2026-10-24T10:00',
        end: null,
        allDay: false,
        timeZone: 'America/Chicago',
      },
    });
    const tag = made.workspace.entities.tags.find((each) => each.name === 'fall')!;
    expect(Object.keys(task.tags)).toEqual([tag.id]);
    expect(assigneesOf(task)).toEqual([]);
  });
});
