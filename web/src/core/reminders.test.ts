import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { inboxList } from './lists.ts';
import { reminderInstant, remindersBetween, remindsAllDay, remindsMe } from './reminders.ts';
import { setAssignee } from './sharing.ts';
import { createTask, toggleTaskDone } from './tasks.ts';
import type { Task, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const TZ = 'America/Chicago';
const ME = '01JBBEN0000000000000000001';
const SAM = '01JBSAM0000000000000000002';
const at = (local: string) => Date.parse(new Date(`${local}:00-05:00`).toISOString());

function setup() {
  const ctx = testContext('ben', undefined, ME);
  let ws: WorkspaceFile = createWorkspace(ctx);
  const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]>): Task => {
    const made = createTask(ctx, ws, { title, listId: inboxList(ws).id, ...extra });
    ws = made.workspace;
    return made.task;
  };
  return {
    ctx,
    add,
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const timed = { start: '2026-10-26T10:30', end: null, allDay: false, timeZone: TZ };
const allDay = { start: '2026-10-26', end: null, allDay: true, timeZone: TZ };

describe('reminders', () => {
  it('count back from the start, or from 9:00 on an all-day date', () => {
    const s = setup();
    const meeting = s.add('Meeting', { schedule: timed, reminders: [{ before: 30 }] });
    expect(reminderInstant(meeting, { before: 30 }, TZ)).toBe(at('2026-10-26T10:00'));
    expect(reminderInstant(meeting, { before: 0 }, TZ)).toBe(at('2026-10-26T10:30'));
    const bins = s.add('Bins', { schedule: allDay });
    expect(remindsAllDay(bins)).toBe(true);
    expect(reminderInstant(bins, { before: 1440 }, TZ)).toBe(at('2026-10-25T09:00'));
    // A set time needs no date on the task.
    const loose = s.add('Loose', {});
    expect(reminderInstant(loose, { before: 5 }, TZ)).toBeNull();
    expect(reminderInstant(loose, { at: '2026-10-27T07:15' }, TZ)).toBe(at('2026-10-27T07:15'));
  });

  it('use the due date when there is no start', () => {
    const s = setup();
    const bill = s.add('Bill', { due: { at: '2026-10-28T17:00', allDay: false, timeZone: TZ } });
    expect(reminderInstant(bill, { before: 60 }, TZ)).toBe(at('2026-10-28T16:00'));
  });

  it('are mine when I am assigned, or nobody is and I made the task', () => {
    const s = setup();
    const mine = s.add('Mine', { schedule: timed });
    expect(remindsMe(s.ws, mine, ME)).toBe(true);
    s.ws = setAssignee(s.ctx, s.ws, mine.id, `user:${SAM}`, true);
    const given = s.ws.entities.tasks.find((task) => task.id === mine.id)!;
    expect(remindsMe(s.ws, given, ME)).toBe(false);
    expect(remindsMe(s.ws, given, SAM)).toBe(true);
  });

  it('list what fires in a window, soonest first, skipping closed tasks', () => {
    const s = setup();
    s.add('Later', { schedule: timed, reminders: [{ before: 0 }] });
    s.add('Sooner', { schedule: timed, reminders: [{ before: 30 }, { before: 2880 }] });
    const done = s.add('Done', { schedule: timed, reminders: [{ before: 5 }] });
    s.ws = toggleTaskDone(s.ctx, s.ws, done.id);
    const due = remindersBetween(s.ws, ME, at('2026-10-26T09:00'), at('2026-10-26T11:00'), TZ);
    expect(due.map((each) => [each.title, each.at])).toEqual([
      ['Sooner', at('2026-10-26T10:00')],
      ['Later', at('2026-10-26T10:30')],
    ]);
    expect(new Set(due.map((each) => each.key)).size).toBe(2);
  });
});
