import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import {
  addBlocker,
  blockedByTask,
  blockersOf,
  conflictsOf,
  removeBlocker,
  startsTooSoon,
  waitingOn,
  wouldLoop,
} from './blocking.ts';
import { getEntity } from './collections.ts';
import { inboxList } from './lists.ts';
import { members, setElement } from './ops.ts';
import { createTask, deleteTask, restoreTask, setTaskStatus, updateTask } from './tasks.ts';
import { purgeTask } from './trash.ts';
import type { Schedule, Task, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

/** A task no one shared with this device: its id is all it ever sees. */
const UNSEEN = '01TESTUNSEEN0000000000000A';
const ZONE = 'America/Chicago';

const day = (start: string, end: string | null = null): Schedule => ({
  start,
  end,
  allDay: start.length === 10,
  timeZone: ZONE,
});

/** Inbox: Buy paint, Paint the bedroom, Hang the pictures. */
function setup() {
  const ctx = testContext();
  let ws = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const make = (title: string) => {
    const made = createTask(ctx, ws, { title, listId: inbox });
    ws = made.workspace;
    return made.task.id;
  };
  const paint = make('Buy paint');
  const bedroom = make('Paint the bedroom');
  const pictures = make('Hang the pictures');
  return { ctx, ws, paint, bedroom, pictures };
}

const task = (ws: WorkspaceFile, id: string) => getEntity(ws, 'tasks', id)!;
const titles = (tasks: Task[]) => tasks.map((each) => each.title);

describe('blocked-by links (PL-055)', () => {
  it('a link puts the blocker on the waiting task, and the waiting task on the blocker’s Blocks side', () => {
    const { ctx, ws: before, paint, bedroom } = setup();
    const ws = addBlocker(ctx, before, bedroom, paint);
    expect(members(task(ws, bedroom).blockedBy)).toEqual([paint]);
    expect(titles(blockersOf(ws, task(ws, bedroom)).shown)).toEqual(['Buy paint']);
    expect(titles(blockedByTask(ws, task(ws, paint)))).toEqual(['Paint the bedroom']);
    expect(titles(waitingOn(ws, task(ws, bedroom)))).toEqual(['Buy paint']);
    // The blocker itself waits on nothing.
    expect(waitingOn(ws, task(ws, paint))).toEqual([]);
  });

  it('waits until every blocker is done or won’t do', () => {
    const { ctx, ws: start, paint, bedroom, pictures } = setup();
    let ws = addBlocker(ctx, start, pictures, paint);
    ws = addBlocker(ctx, ws, pictures, bedroom);
    expect(waitingOn(ws, task(ws, pictures))).toHaveLength(2);
    ws = setTaskStatus(ctx, ws, paint, 'done');
    expect(titles(waitingOn(ws, task(ws, pictures)))).toEqual(['Paint the bedroom']);
    ws = setTaskStatus(ctx, ws, bedroom, 'wontdo');
    expect(waitingOn(ws, task(ws, pictures))).toEqual([]);
    // The link stays: the details still list both.
    expect(blockersOf(ws, task(ws, pictures)).shown).toHaveLength(2);
    // A finished task waits on nothing, whatever it was linked to.
    ws = setTaskStatus(ctx, ws, bedroom, 'open');
    ws = setTaskStatus(ctx, ws, pictures, 'done');
    expect(waitingOn(ws, task(ws, pictures))).toEqual([]);
  });

  it('removing a link takes it off both sides, and adding one twice changes nothing', () => {
    const { ctx, ws: start, paint, bedroom } = setup();
    const linked = addBlocker(ctx, start, bedroom, paint);
    expect(addBlocker(ctx, linked, bedroom, paint)).toBe(linked);
    const ws = removeBlocker(ctx, linked, bedroom, paint);
    expect(members(task(ws, bedroom).blockedBy)).toEqual([]);
    expect(blockedByTask(ws, task(ws, paint))).toEqual([]);
    expect(removeBlocker(ctx, ws, bedroom, paint)).toBe(ws);
  });

  it('a task this device can’t see is counted, never named, and still waits on nothing it can show', () => {
    const { ctx, ws: start, paint, bedroom } = setup();
    let ws = addBlocker(ctx, start, bedroom, paint);
    // As it arrives from someone who can see both: the link is stored on the shared task.
    ws = updateTask(ctx, ws, bedroom, {
      blockedBy: setElement(ctx, task(ws, bedroom).blockedBy, UNSEEN, true),
    });
    expect(blockersOf(ws, task(ws, bedroom))).toEqual({ shown: [task(ws, paint)], hidden: 1 });
    // The chain mark counts only what it can know is open.
    expect(titles(waitingOn(ws, task(ws, bedroom)))).toEqual(['Buy paint']);
    ws = setTaskStatus(ctx, ws, paint, 'done');
    expect(waitingOn(ws, task(ws, bedroom))).toEqual([]);
    // Whoever may edit the waiting task can take the unseen link off.
    ws = removeBlocker(ctx, ws, bedroom, UNSEEN);
    expect(blockersOf(ws, task(ws, bedroom)).hidden).toBe(0);
  });

  it('links follow a blocker into the trash and back', () => {
    const { ctx, ws: start, paint, bedroom } = setup();
    let ws = addBlocker(ctx, start, bedroom, paint);
    ws = deleteTask(ctx, ws, paint);
    expect(blockersOf(ws, task(ws, bedroom))).toEqual({ shown: [], hidden: 0 });
    expect(waitingOn(ws, task(ws, bedroom))).toEqual([]);
    expect(members(task(ws, bedroom).blockedBy)).toEqual([paint]);
    ws = restoreTask(ctx, ws, paint);
    expect(titles(waitingOn(ws, task(ws, bedroom)))).toEqual(['Buy paint']);
  });

  it('links follow a waiting task into the trash and back', () => {
    const { ctx, ws: start, paint, bedroom } = setup();
    let ws = addBlocker(ctx, start, bedroom, paint);
    ws = deleteTask(ctx, ws, bedroom);
    expect(blockedByTask(ws, task(ws, paint))).toEqual([]);
    ws = restoreTask(ctx, ws, bedroom);
    expect(titles(blockedByTask(ws, task(ws, paint)))).toEqual(['Paint the bedroom']);
    expect(titles(waitingOn(ws, task(ws, bedroom)))).toEqual(['Buy paint']);
  });

  it('a purged blocker is gone for good, and a purged waiting task blocks on nothing', () => {
    const { ctx, ws: start, paint, bedroom, pictures } = setup();
    let ws = addBlocker(ctx, start, bedroom, paint);
    ws = addBlocker(ctx, ws, pictures, bedroom);
    ws = purgeTask(ctx, deleteTask(ctx, ws, paint), paint);
    expect(blockersOf(ws, task(ws, bedroom))).toEqual({ shown: [], hidden: 0 });
    ws = purgeTask(ctx, deleteTask(ctx, ws, pictures), pictures);
    expect(members(task(ws, pictures).blockedBy)).toEqual([]);
    expect(blockedByTask(ws, task(ws, bedroom))).toEqual([]);
  });

  describe('no loops', () => {
    it('refuses a task waiting on itself, or on a task that waits on it', () => {
      const { ctx, ws: start, paint, bedroom, pictures } = setup();
      expect(wouldLoop(start, paint, paint)).toBe(true);
      expect(addBlocker(ctx, start, paint, paint)).toBe(start);
      let ws = addBlocker(ctx, start, bedroom, paint);
      expect(wouldLoop(ws, paint, bedroom)).toBe(true);
      expect(addBlocker(ctx, ws, paint, bedroom)).toBe(ws);
      ws = addBlocker(ctx, ws, pictures, bedroom);
      // Paint the bedroom waits on Buy paint, Hang the pictures on Paint the bedroom: three long.
      expect(wouldLoop(ws, paint, pictures)).toBe(true);
      expect(addBlocker(ctx, ws, paint, pictures)).toBe(ws);
      // Side by side is no loop.
      expect(wouldLoop(ws, pictures, paint)).toBe(false);
    });

    it('counts a trashed task in the walk: its links come back with it, and so would the loop', () => {
      const { ctx, ws: start, paint, bedroom, pictures } = setup();
      // Paint the bedroom waits on Buy paint, which goes to the trash with that link still stored.
      let ws = addBlocker(ctx, start, bedroom, paint);
      ws = deleteTask(ctx, ws, paint);
      expect(wouldLoop(ws, paint, bedroom)).toBe(true);
      expect(addBlocker(ctx, ws, paint, bedroom)).toBe(ws);
      // In the middle of a chain too: Hang the pictures waits on Paint the bedroom (trashed), which
      // waits on Buy paint; Buy paint waiting on Hang the pictures would loop once it is restored.
      ws = restoreTask(ctx, ws, paint);
      ws = addBlocker(ctx, ws, pictures, bedroom);
      ws = deleteTask(ctx, ws, bedroom);
      expect(addBlocker(ctx, ws, paint, pictures)).toBe(ws);
      ws = restoreTask(ctx, ws, bedroom);
      expect(titles(waitingOn(ws, task(ws, pictures)))).toEqual(['Paint the bedroom']);
    });

    it('a loop two devices merged is walked without hanging', () => {
      const { ctx, ws: start, paint, bedroom, pictures } = setup();
      // Each device added one side; together they make a loop no device made.
      let ws = updateTask(ctx, start, bedroom, { blockedBy: setElement(ctx, {}, paint, true) });
      ws = updateTask(ctx, ws, paint, { blockedBy: setElement(ctx, {}, bedroom, true) });
      expect(wouldLoop(ws, pictures, paint)).toBe(false);
      expect(wouldLoop(ws, paint, bedroom)).toBe(true);
      expect(titles(waitingOn(ws, task(ws, paint)))).toEqual(['Paint the bedroom']);
    });
  });

  describe('dates', () => {
    const dated = (
      ws: WorkspaceFile,
      ctx: ReturnType<typeof testContext>,
      id: string,
      schedule: Schedule,
    ) => updateTask(ctx, ws, id, { schedule });

    it('a task starting before its blocker ends conflicts; starting the day it ends does not', () => {
      const { ctx, ws: start, paint, bedroom } = setup();
      let ws = addBlocker(ctx, start, bedroom, paint);
      ws = dated(ws, ctx, paint, day('2026-11-23', '2026-11-25'));
      ws = dated(ws, ctx, bedroom, day('2026-11-24'));
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(true);
      expect(titles(conflictsOf(ws, task(ws, bedroom), ZONE))).toEqual(['Buy paint']);
      ws = dated(ws, ctx, bedroom, day('2026-11-25'));
      expect(conflictsOf(ws, task(ws, bedroom), ZONE)).toEqual([]);
      ws = dated(ws, ctx, bedroom, day('2026-11-26', '2026-11-27'));
      expect(conflictsOf(ws, task(ws, bedroom), ZONE)).toEqual([]);
    });

    it('on the same day, times decide when both have one', () => {
      const { ctx, ws: start, paint, bedroom } = setup();
      let ws = dated(start, ctx, paint, day('2026-11-23T09:00', '2026-11-23T11:00'));
      ws = dated(ws, ctx, bedroom, day('2026-11-23T10:00', '2026-11-23T12:00'));
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(true);
      ws = dated(ws, ctx, bedroom, day('2026-11-23T11:00', '2026-11-23T12:00'));
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(false);
      // One of them all day: the day alone counts.
      ws = dated(ws, ctx, bedroom, day('2026-11-23'));
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(false);
    });

    it('compares on the viewer’s wall clock when the two were set in different zones', () => {
      const { ctx, ws: start, paint, bedroom } = setup();
      // Buy paint ends at 23:00 in Chicago: 06:00 the next morning in Berlin.
      let ws = dated(start, ctx, paint, {
        start: '2026-11-23T21:00',
        end: '2026-11-23T23:00',
        allDay: false,
        timeZone: ZONE,
      });
      // Paint the bedroom starts at 02:00 on the 24th in Berlin: 19:00 on the 23rd in Chicago.
      ws = dated(ws, ctx, bedroom, {
        start: '2026-11-24T02:00',
        end: '2026-11-24T04:00',
        allDay: false,
        timeZone: 'Europe/Berlin',
      });
      // By the raw dates it starts the next day; it really starts four hours before Buy paint ends.
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(true);
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), 'Europe/Berlin')).toBe(true);
      // Moved to 06:00 Berlin (23:00 Chicago), it starts as Buy paint ends: fine in both.
      ws = dated(ws, ctx, bedroom, {
        start: '2026-11-24T06:00',
        end: null,
        allDay: false,
        timeZone: 'Europe/Berlin',
      });
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(false);
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), 'Europe/Berlin')).toBe(false);
      // An all-day task is the same day everywhere: 24 Nov all day starts after the 23rd's end in
      // Chicago, but in Berlin Buy paint ends on the 24th at 06:00, the same day, with no time to
      // compare: fine too.
      ws = dated(ws, ctx, bedroom, day('2026-11-24'));
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(false);
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), 'Europe/Berlin')).toBe(false);
    });

    it('a due date stands in for a task with no schedule, and no date means no conflict', () => {
      const { ctx, ws: start, paint, bedroom } = setup();
      let ws = updateTask(ctx, start, paint, {
        due: { at: '2026-11-25', allDay: true, timeZone: ZONE },
      });
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(false);
      ws = updateTask(ctx, ws, bedroom, {
        due: { at: '2026-11-24', allDay: true, timeZone: ZONE },
      });
      expect(startsTooSoon(task(ws, bedroom), task(ws, paint), ZONE)).toBe(true);
    });
  });
});
