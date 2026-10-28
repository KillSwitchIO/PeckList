import { describe, expect, it } from 'vitest';
import { createList } from '../../core/lists.ts';
import { createWorkspace } from '../../core/workspace.ts';
import type { HistoryEntry } from '../../ports/sync.ts';
import { testContext } from '../../test/fixtures.ts';
import { historyText } from './historyText.ts';

const TODAY = '2026-10-27';
const entry = (field: string, before: unknown, after: unknown): HistoryEntry => ({
  id: 'H1',
  at: '2026-10-27T15:00:00.000Z',
  actorId: null,
  field,
  before: before === undefined ? null : JSON.stringify(before),
  after: after === undefined ? null : JSON.stringify(after),
});

describe('history text (R-FB-105)', () => {
  it('says each change plainly, with names from this device', () => {
    const ctx = testContext();
    const made = createList(ctx, createWorkspace(ctx), { name: 'Garden', color: '#4B2A8A' });
    const ws = made.workspace;
    const say = (field: string, before: unknown, after: unknown) =>
      historyText(entry(field, before, after), ws, TODAY);

    expect(say('created', undefined, 'Paint')).toBe('created this task');
    expect(say('title', 'Paint', 'Paint the shed')).toBe('changed the title to "Paint the shed"');
    expect(say('status', 'open', 'done')).toBe('completed it');
    expect(say('status', 'done', 'open')).toBe('reopened it');
    expect(say('schedule', null, { start: '2026-10-28', allDay: true })).toBe(
      'set the date to Tomorrow',
    );
    expect(say('schedule', { start: '2026-10-28' }, null)).toBe('removed the date');
    expect(say('priority', 0, 3)).toBe('set the priority to High');
    expect(say('listId', 'x', made.list.id)).toBe('moved it to Garden');
    expect(say('notes', undefined, undefined)).toBe('edited the notes');
    expect(say('pinnedAt', null, '2026-10-27T15:00:00.000Z')).toBe('pinned it');
    expect(say('progress', 0, 40)).toBe('set progress to 40%');
  });
});
