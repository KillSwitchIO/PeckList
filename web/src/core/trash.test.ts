import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { testContext } from '../test/fixtures.ts';
import { addAttachment } from './attachments.ts';
import { HlcClock } from './hlc.ts';
import { addComment } from './comments.ts';
import { createList, deleteList, inboxList } from './lists.ts';
import { members } from './ops.ts';
import { trashedTasks } from './queries.ts';
import { createSavedFilter, deleteSavedFilter } from './savedFilters.ts';
import { updateSettings } from './settings.ts';
import { createTag, deleteTag } from './tags.ts';
import { createTask, deleteTask, restoreTask, updateTask } from './tasks.ts';
import {
  emptyTrash,
  erasedByShortening,
  ERASED,
  isPurged,
  PURGED_AT,
  purgeExpired,
  purgeTask,
} from './trash.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const DAY = 86_400_000;

/** A clock the test moves; every operation stamps with it. */
function setup() {
  let now = Date.parse('2026-09-01T10:00:00.000Z');
  const ctx = {
    ...testContext(),
    now: () => now,
    clock: new HlcClock({ node: 'dev1', now: () => now }),
  };
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

  it('erases what a purged task carried: dates, reminders, tags and people', () => {
    const s = setup();
    const tag = createTag(s.ctx, s.ws, 'private');
    s.ws = tag.workspace;
    const task = s.add('Doctor');
    s.ws = updateTask(s.ctx, s.ws, task.id, {
      priority: 3,
      schedule: { start: '2026-09-02', end: null, allDay: true, timeZone: 'America/Chicago' },
      recurrence: 'FREQ=WEEKLY',
      reminders: [{ before: 60 }],
      tags: { [tag.tag.id]: { in: true, hlc: s.ctx.clock.tick() } },
      assignees: { 'user:01ARZ3NDEKTSV4RRFFQ69G5FAV': { in: true, hlc: s.ctx.clock.tick() } },
      status: 'done',
      completedAt: '2026-09-01T10:00:00.000Z',
      completedBy: s.ctx.userId,
    });
    s.ws = deleteTask(s.ctx, s.ws, task.id);
    s.ws = purgeTask(s.ctx, s.ws, task.id);

    const gone = find(s.ws, task.id);
    expect(gone).toMatchObject({
      status: 'open',
      priority: 0,
      schedule: null,
      recurrence: null,
      reminders: [],
      completedAt: null,
      completedBy: null,
    });
    expect(members(gone.tags)).toEqual([]);
    expect(members(gone.assignees)).toEqual([]);
    expect(createAjvValidator().validate(s.ws).errors).toEqual([]);
  });

  it('erases the comments and files on a purged task', () => {
    const s = setup();
    const task = s.add('With extras');
    const other = s.add('Stays');
    s.ws = addComment(s.ctx, s.ws, task.id, 'A private thought').workspace;
    s.ws = addComment(s.ctx, s.ws, other.id, 'Still here').workspace;
    const file = addAttachment(s.ctx, s.ws, {
      taskId: task.id,
      name: 'scan.pdf',
      size: 10,
      mime: 'application/pdf',
      sha256: 'a'.repeat(64),
    });
    s.ws = file.workspace;
    s.ws = deleteTask(s.ctx, s.ws, task.id);
    s.ws = purgeTask(s.ctx, s.ws, task.id);

    expect(s.ws.entities.comments.map((each) => [each.body, isPurged(each)])).toEqual([
      [ERASED, true],
      ['Still here', false],
    ]);
    const gone = s.ws.entities.attachments[0]!;
    expect([gone.name, isPurged(gone)]).toEqual([ERASED, true]);
    expect(createAjvValidator().validate(s.ws).errors).toEqual([]);
  });

  it('finishes tasks an older version purged, then has nothing left to do', () => {
    const s = setup();
    const task = s.add('Purged long ago');
    s.ws = addComment(s.ctx, s.ws, task.id, 'Left behind').workspace;
    s.ws = updateTask(s.ctx, s.ws, task.id, {
      title: '',
      notes: '',
      priority: 2,
      deletedAt: PURGED_AT,
    });

    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, task.id).priority).toBe(0);
    expect(s.ws.entities.comments[0]!.body).toBe(ERASED);
    expect(purgeExpired(s.ctx, s.ws, s.now)).toBe(s.ws);
  });

  it("does not erase a task in someone else's list when asked to delete it forever", () => {
    const s = setup();
    const theirs = createList(s.ctx, s.ws, { name: 'Their list', color: '#A7C7E7' });
    s.ws = theirs.workspace;
    const made = createTask(s.ctx, s.ws, { title: 'Shared', listId: theirs.list.id });
    s.ws = addComment(s.ctx, made.workspace, made.task.id, 'Mine').workspace;
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
    s.ws = deleteTask(s.ctx, s.ws, made.task.id);
    expect(purgeTask(s.ctx, s.ws, made.task.id)).toBe(s.ws);
    expect(find(s.ws, made.task.id).title).toBe('Shared');
  });

  it("erases my own comment deleted in someone else's list, and leaves theirs", () => {
    const s = setup();
    const theirs = createList(s.ctx, s.ws, { name: 'Their list', color: '#A7C7E7' });
    s.ws = theirs.workspace;
    const made = createTask(s.ctx, s.ws, { title: 'Shared', listId: theirs.list.id });
    s.ws = addComment(s.ctx, made.workspace, made.task.id, 'Mine').workspace;
    s.ws = addComment(s.ctx, s.ws, made.task.id, 'Theirs').workspace;
    const someone = '01SOMEONEELSE0000000000001';
    s.ws = {
      ...s.ws,
      entities: {
        ...s.ws.entities,
        lists: s.ws.entities.lists.map((list) =>
          list.id === theirs.list.id
            ? { ...list, createdBy: someone, visibility: 'shared' as const }
            : list,
        ),
        comments: s.ws.entities.comments.map((each) =>
          each.body === 'Theirs'
            ? { ...each, createdBy: someone, deletedAt: '2026-08-01T00:00:00.000Z' }
            : { ...each, deletedAt: '2026-08-01T00:00:00.000Z' },
        ),
      },
    };
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(s.ws.entities.comments.map((each) => each.body)).toEqual([ERASED, 'Theirs']);
  });

  it('erases the names of tags and saved filters deleted long enough ago', () => {
    const s = setup();
    const tag = createTag(s.ctx, s.ws, 'courtroom');
    s.ws = deleteTag(s.ctx, tag.workspace, tag.tag.id);
    const filter = createSavedFilter(s.ctx, s.ws, 'Secret', { lists: [inboxList(s.ws).id] });
    s.ws = deleteSavedFilter(s.ctx, filter.workspace, filter.filter.id);
    s.advance(20);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(s.ws.entities.tags.find((each) => each.id === tag.tag.id)!.name).toBe('courtroom');

    s.advance(11);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    const gone = s.ws.entities.tags.find((each) => each.id === tag.tag.id)!;
    expect([gone.name, isPurged(gone)]).toEqual([ERASED, true]);
    const filterGone = s.ws.entities.savedFilters.find((each) => each.id === filter.filter.id)!;
    expect([filterGone.name, filterGone.query]).toEqual(['', {}]);
    expect(createAjvValidator().validate(s.ws).errors).toEqual([]);
  });

  it('purges after the time the person picked, not 30 days', () => {
    const s = setup();
    s.ws = updateSettings(s.ctx, s.ws, { purgeAfterDays: 7 });
    const soon = s.add('Gone in a week');
    s.ws = deleteTask(s.ctx, s.ws, soon.id);
    s.advance(6);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, soon.id).title).toBe('Gone in a week');
    s.advance(2);
    expect(trashedTasks(s.ws, s.now)).toEqual([]);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(isPurged(find(s.ws, soon.id))).toBe(true);
    expect(createAjvValidator().validate(s.ws).errors).toEqual([]);
  });

  it('keeps the trash for up to a year when asked', () => {
    const s = setup();
    s.ws = updateSettings(s.ctx, s.ws, { purgeAfterDays: 365 });
    const kept = s.add('Kept a while');
    s.ws = deleteTask(s.ctx, s.ws, kept.id);
    s.advance(364);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(trashedTasks(s.ws, s.now).map((task) => task.title)).toEqual(['Kept a while']);
    s.advance(2);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(isPurged(find(s.ws, kept.id))).toBe(true);
  });

  it("moves won't-do tasks to the trash after the time, restorable, then erases them", () => {
    const s = setup();
    const dropped = s.add('Not doing this');
    const fresh = s.add('Dropped later');
    s.ws = updateTask(s.ctx, s.ws, dropped.id, { status: 'wontdo' });
    s.advance(20);
    s.ws = updateTask(s.ctx, s.ws, fresh.id, { status: 'wontdo' });
    s.advance(11);

    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, dropped.id).deletedAt).not.toBeNull();
    expect(find(s.ws, dropped.id).title).toBe('Not doing this');
    expect(find(s.ws, fresh.id).deletedAt).toBeNull();

    s.advance(31);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(isPurged(find(s.ws, dropped.id))).toBe(true);
  });

  it("gives a restored won't-do task the full time again", () => {
    const s = setup();
    const dropped = s.add('Not doing this');
    s.ws = updateTask(s.ctx, s.ws, dropped.id, { status: 'wontdo' });
    s.advance(31);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    s.ws = restoreTask(s.ctx, s.ws, dropped.id);

    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, dropped.id).deletedAt).toBeNull();
    s.advance(31);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, dropped.id).deletedAt).not.toBeNull();
  });

  it("counts a won't-do task's time from its real date, so imported ones move on the first pass", () => {
    const s = setup();
    const imported = s.add('Imported from years ago');
    const recent = s.add('Dropped this week');
    s.ws = updateTask(s.ctx, s.ws, imported.id, {
      status: 'wontdo',
      completedAt: '2023-01-01T00:00:00.000Z',
    });
    s.ws = updateTask(s.ctx, s.ws, recent.id, {
      status: 'wontdo',
      completedAt: new Date(s.now).toISOString(),
    });
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, imported.id).deletedAt).not.toBeNull();
    expect(find(s.ws, recent.id).deletedAt).toBeNull();
  });

  it("gives an imported won't-do task the full time again when restored", () => {
    const s = setup();
    const imported = s.add('Imported from years ago');
    s.ws = updateTask(s.ctx, s.ws, imported.id, {
      status: 'wontdo',
      completedAt: '2023-01-01T00:00:00.000Z',
    });
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    s.ws = restoreTask(s.ctx, s.ws, imported.id);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, imported.id).deletedAt).toBeNull();
  });

  it("leaves a won't-do task with an open subtask, and takes closed ones along", () => {
    const s = setup();
    const parent = s.add('Parent dropped');
    const open = s.add('Still open', parent.id);
    const other = s.add('Other dropped');
    const closed = s.add('Closed child', other.id);
    s.ws = updateTask(s.ctx, s.ws, parent.id, { status: 'wontdo' });
    s.ws = updateTask(s.ctx, s.ws, other.id, { status: 'wontdo' });
    s.ws = updateTask(s.ctx, s.ws, closed.id, { status: 'done' });
    s.advance(31);

    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, parent.id).deletedAt).toBeNull();
    expect(find(s.ws, open.id).deletedAt).toBeNull();
    expect(find(s.ws, other.id).deletedAt).not.toBeNull();
    expect(find(s.ws, closed.id).deletedAt).toBe(find(s.ws, other.id).deletedAt);
    // Restoring brings back what went together.
    s.ws = restoreTask(s.ctx, s.ws, other.id);
    expect(find(s.ws, closed.id).deletedAt).toBeNull();
  });

  it("leaves a won't-do task in someone else's list to them", () => {
    const s = setup();
    const theirs = createList(s.ctx, s.ws, { name: 'Their list', color: '#A7C7E7' });
    const made = createTask(s.ctx, theirs.workspace, { title: 'Theirs', listId: theirs.list.id });
    s.ws = updateTask(s.ctx, made.workspace, made.task.id, { status: 'wontdo' });
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
    s.advance(31);
    s.ws = purgeExpired(s.ctx, s.ws, s.now);
    expect(find(s.ws, made.task.id).deletedAt).toBeNull();
  });

  describe('completed tasks', () => {
    const complete = (s: ReturnType<typeof setup>, id: string, at: number) => {
      s.ws = updateTask(s.ctx, s.ws, id, {
        status: 'done',
        completedAt: new Date(at).toISOString(),
        completedBy: s.ctx.userId,
      });
    };

    it('move to the trash after the time, restorable, then are erased', () => {
      const s = setup();
      const old = s.add('Finished');
      const recent = s.add('Finished later');
      const open = s.add('Still open');
      complete(s, old.id, s.now);
      s.advance(20);
      complete(s, recent.id, s.now);
      s.advance(11);

      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, old.id).deletedAt).not.toBeNull();
      expect(find(s.ws, old.id).title).toBe('Finished');
      expect(find(s.ws, recent.id).deletedAt).toBeNull();
      expect(find(s.ws, open.id).deletedAt).toBeNull();
      expect(createAjvValidator().validate(s.ws).errors).toEqual([]);

      s.advance(31);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(isPurged(find(s.ws, old.id))).toBe(true);
    });

    it('count from their real date, so imported history moves on the first pass', () => {
      const s = setup();
      const imported = s.add('Finished in 2023');
      complete(s, imported.id, Date.parse('2023-03-01T12:00:00.000Z'));
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, imported.id).deletedAt).not.toBeNull();
    });

    it('follow the time the person picked', () => {
      const s = setup();
      s.ws = updateSettings(s.ctx, s.ws, { purgeAfterDays: 365 });
      const task = s.add('Finished');
      complete(s, task.id, s.now);
      s.advance(364);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, task.id).deletedAt).toBeNull();
      s.advance(2);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, task.id).deletedAt).not.toBeNull();
    });

    it('get the full time again when restored', () => {
      const s = setup();
      const task = s.add('Brought back');
      complete(s, task.id, Date.parse('2023-03-01T12:00:00.000Z'));
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      s.ws = restoreTask(s.ctx, s.ws, task.id);

      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, task.id).deletedAt).toBeNull();
      s.advance(29);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, task.id).deletedAt).toBeNull();
      s.advance(2);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, task.id).deletedAt).not.toBeNull();
    });

    it('stay under a task that stays, and go with it later', () => {
      const s = setup();
      const parent = s.add('Long job');
      const step = s.add('First step', parent.id);
      complete(s, step.id, s.now);
      s.advance(31);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, step.id).deletedAt).toBeNull();

      complete(s, parent.id, s.now);
      s.advance(31);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, parent.id).deletedAt).not.toBeNull();
      expect(find(s.ws, step.id).deletedAt).toBe(find(s.ws, parent.id).deletedAt);
    });

    it('wait for a subtask with time left, or an open one', () => {
      const s = setup();
      const waits = s.add('Waits for a recent subtask');
      const recent = s.add('Done recently', waits.id);
      const blocked = s.add('Has an open subtask');
      s.add('Still open', blocked.id);
      complete(s, waits.id, s.now);
      complete(s, blocked.id, s.now);
      s.advance(20);
      complete(s, recent.id, s.now);
      s.advance(11);

      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, waits.id).deletedAt).toBeNull();
      expect(find(s.ws, blocked.id).deletedAt).toBeNull();
      s.advance(20);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, waits.id).deletedAt).not.toBeNull();
      expect(find(s.ws, blocked.id).deletedAt).toBeNull();
    });

    it("stay in someone else's list for its owner to clean up", () => {
      const s = setup();
      const theirs = createList(s.ctx, s.ws, { name: 'Their list', color: '#A7C7E7' });
      const made = createTask(s.ctx, theirs.workspace, { title: 'Theirs', listId: theirs.list.id });
      s.ws = made.workspace;
      complete(s, made.task.id, s.now);
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
      s.advance(31);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(find(s.ws, made.task.id).deletedAt).toBeNull();
    });

    it('have nothing more to do once moved', () => {
      const s = setup();
      const task = s.add('Finished');
      complete(s, task.id, s.now);
      s.advance(31);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(purgeExpired(s.ctx, s.ws, s.now)).toBe(s.ws);
    });
  });

  describe('a task erased on one device while another moved it to the trash', () => {
    const blank = (s: ReturnType<typeof setup>, title: string) => {
      const task = s.add(title);
      // The erasing's fields, with the later delete date the other device's write left.
      s.ws = updateTask(s.ctx, s.ws, task.id, {
        title: '',
        notes: '',
        status: 'open',
        completedAt: null,
        schedule: null,
        deletedAt: '2026-08-31T10:00:00.000Z',
      });
      return task;
    };

    it('does not show in the trash', () => {
      const s = setup();
      blank(s, 'Was erased');
      const real = s.add('Really deleted');
      s.ws = deleteTask(s.ctx, s.ws, real.id);
      expect(trashedTasks(s.ws, s.now).map((task) => task.title)).toEqual(['Really deleted']);
    });

    it('gets its erased date back on the next pass, and that settles it', () => {
      const s = setup();
      const task = blank(s, 'Was erased');
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(isPurged(find(s.ws, task.id))).toBe(true);
      expect(purgeExpired(s.ctx, s.ws, s.now)).toBe(s.ws);
    });

    it('leaves a deleted task with anything in it alone', () => {
      const s = setup();
      const noted = s.add('');
      s.ws = updateTask(s.ctx, s.ws, noted.id, { title: '', notes: 'Something' });
      const done = s.add('');
      s.ws = updateTask(s.ctx, s.ws, done.id, {
        title: '',
        notes: '',
        status: 'done',
        completedAt: new Date(s.now).toISOString(),
      });
      s.ws = deleteTask(s.ctx, s.ws, noted.id);
      s.ws = deleteTask(s.ctx, s.ws, done.id);
      s.ws = purgeExpired(s.ctx, s.ws, s.now);
      expect(isPurged(find(s.ws, noted.id))).toBe(false);
      expect(isPurged(find(s.ws, done.id))).toBe(false);
      expect(trashedTasks(s.ws, s.now)).toHaveLength(2);
    });
  });

  it('counts what a shorter time would erase', () => {
    const s = setup();
    const old = s.add('Ten days in the trash');
    const recent = s.add('Two days in the trash');
    s.ws = deleteTask(s.ctx, s.ws, old.id);
    s.advance(8);
    s.ws = deleteTask(s.ctx, s.ws, recent.id);
    s.advance(2);
    expect(erasedByShortening(s.ws, 15, s.now)).toBe(0);
    expect(erasedByShortening(s.ws, 7, s.now)).toBe(1);
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
