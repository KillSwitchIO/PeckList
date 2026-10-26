import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { testContext } from '../test/fixtures.ts';
import { createList, deleteList, inboxList } from './lists.ts';
import { trashedTasks } from './queries.ts';
import { createTask, deleteTask, updateTask } from './tasks.ts';
import { emptyTrash, isPurged, purgeExpired, purgeTask } from './trash.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const DAY = 86_400_000;

/** A clock the test moves; every operation stamps with it. */
function setup() {
  let now = Date.parse('2026-09-01T10:00:00.000Z');
  const ctx = { ...testContext(), now: () => now };
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const add = (title: string, parentId: string | null = null) => {
    const result = createTask(ctx, ws, { title, listId: inbox, parentId });
    ws = updateTask(ctx, result.workspace, result.task.id, { notes: `${title} notes` });
    return result.task;
  };
  return {
    ctx,
    add,
    advance: (days: number) => {
      now += days * DAY;
    },
    get now() {
      return now;
    },
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const find = (ws: WorkspaceFile, id: string) => ws.entities.tasks.find((task) => task.id === id)!;

describe('trash purge', () => {
  it('erases what was deleted more than 30 days ago, keeping the tombstone', () => {
    const s = setup();
    const old = s.add('Old secret');
    const child = s.add('Old child', old.id);
    const recent = s.add('Recent');
    s.ws = deleteTask(s.ctx, s.ws, old.id);
    s.advance(20);
    s.ws = deleteTask(s.ctx, s.ws, recent.id);
    s.advance(11);

    // Nothing due yet returns the very same workspace.
    expect(purgeExpired(s.ctx, s.ws, s.now - 2 * DAY)).toBe(s.ws);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    for (const id of [old.id, child.id]) {
      const gone = find(s.ws, id);
      expect(isPurged(gone)).toBe(true);
      expect([gone.title, gone.notes]).toEqual(['', '']);
    }
    expect(find(s.ws, recent.id).title).toBe('Recent');
    expect(trashedTasks(s.ws, s.now).map((task) => task.title)).toEqual(['Recent']);
    // Still a valid file, and purging again changes nothing.
    expect(createAjvValidator().validate(s.ws).errors).toEqual([]);
    expect(purgeExpired(s.ctx, s.ws, s.now + 100 * DAY)).not.toBe(s.ws);
    const settled = purgeExpired(s.ctx, s.ws, s.now + 100 * DAY);
    expect(purgeExpired(s.ctx, settled, s.now + 100 * DAY)).toBe(settled);
  });

  // Audit C2: a viewer's device purged a shared list's trash at every start; the server refused
  // each one ("The server refused N changes"), and an editor's blanked the owner's trash.
  it('leaves trash in a list someone else owns to them, and erases my own', () => {
    const s = setup();
    const theirs = createList(s.ctx, s.ws, { name: 'Their list', color: '#A7C7E7' });
    s.ws = theirs.workspace;
    const shared = theirs.list.id;
    s.ws = {
      ...s.ws,
      entities: {
        ...s.ws.entities,
        lists: s.ws.entities.lists.map((list) =>
          list.id === theirs.list.id
            ? { ...list, createdBy: '01SOMEONEELSE0000000000001', visibility: 'shared' as const }
            : list,
        ),
      },
    };
    const inTheirs = createTask(s.ctx, s.ws, { title: 'Their old task', listId: shared });
    s.ws = deleteTask(s.ctx, inTheirs.workspace, inTheirs.task.id);
    const mineToo = s.add('My old task');
    s.ws = deleteTask(s.ctx, s.ws, mineToo.id);
    s.advance(31);

    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(isPurged(find(s.ws, mineToo.id))).toBe(true);
    expect(find(s.ws, inTheirs.task.id).title).toBe('Their old task');
    s.ws = emptyTrash(s.ctx, s.ws);
    expect(find(s.ws, inTheirs.task.id).title).toBe('Their old task');
  });

  it('deletes one task forever with the subtasks trashed along with it', () => {
    const s = setup();
    const parent = s.add('Parent');
    const kept = s.add('Deleted earlier', parent.id);
    const child = s.add('Child', parent.id);
    s.ws = deleteTask(s.ctx, s.ws, kept.id);
    s.advance(1);
    s.ws = deleteTask(s.ctx, s.ws, parent.id);
    s.ws = purgeTask(s.ctx, s.ws, parent.id);
    expect(isPurged(find(s.ws, parent.id))).toBe(true);
    expect(isPurged(find(s.ws, child.id))).toBe(true);
    // Trashed on its own earlier: still restorable.
    expect(find(s.ws, kept.id).title).toBe('Deleted earlier');
  });

  it('empties the trash, lists included', () => {
    const s = setup();
    const task = s.add('Somewhere');
    const list = createList(s.ctx, s.ws, { name: 'Private plans', color: '#A7C7E7' });
    s.ws = deleteList(s.ctx, list.workspace, list.list.id);
    s.ws = deleteTask(s.ctx, s.ws, task.id);
    s.ws = emptyTrash(s.ctx, s.ws);
    expect(trashedTasks(s.ws, s.now)).toEqual([]);
    const gone = s.ws.entities.lists.find((each) => each.id === list.list.id)!;
    expect([gone.name, isPurged(gone)]).toEqual(['', true]);
    expect(createAjvValidator().validate(s.ws).errors).toEqual([]);
  });
});
