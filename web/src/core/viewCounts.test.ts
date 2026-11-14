import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { createList, inboxList } from './lists.ts';
import { createTask, toggleTaskDone } from './tasks.ts';
import type { Schedule, WorkspaceFile } from './types.ts';
import { viewCounts } from './viewCounts.ts';
import { createWorkspace } from './workspace.ts';

const TZ = 'America/Chicago';
const TODAY = '2026-10-20';
const on = (start: string): Schedule => ({ start, end: null, allDay: true, timeZone: TZ });

describe('view counts (R-FB-114)', () => {
  it('counts the open tasks each view shows', () => {
    const ctx = testContext();
    let ws: WorkspaceFile = createWorkspace(ctx);
    const inbox = inboxList(ws).id;
    const made = createList(ctx, ws, { name: 'Work', color: '#4B2A8A' });
    ws = made.workspace;
    const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]> = {}) => {
      const result = createTask(ctx, ws, { title, listId: inbox, ...extra });
      ws = result.workspace;
      return result.task;
    };
    add('late', { schedule: on('2026-10-18') });
    add('now', { schedule: on(TODAY) });
    add('soon', { schedule: on('2026-10-23'), listId: made.list.id });
    add('someday');
    const done = add('done', { schedule: on(TODAY) });
    ws = toggleTaskDone(ctx, ws, done.id);
    add('bill', { due: { at: '2026-10-25', allDay: true, timeZone: TZ }, listId: made.list.id });

    const counts = viewCounts(ws, TODAY, null);
    expect(counts).toMatchObject({ today: 2, inbox: 3, upcoming: 3, due: 1, all: 5, completed: 1 });
    // Calendar, Trash and Search show none.
    expect(counts.calendar).toBeUndefined();
    expect(counts.trash).toBeUndefined();
  });

  it('gives the Mess Drawer no count while the workspace has none yet (before the first sync)', () => {
    const ws = createWorkspace(testContext());
    const counts = viewCounts({ ...ws, entities: { ...ws.entities, lists: [] } }, TODAY, null);
    expect(counts.inbox).toBeUndefined();
    expect(counts.today).toBe(0);
  });
});
