import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { agendaDays, dueGroups, setDueDates } from './agenda.ts';
import { getEntity } from './collections.ts';
import { inboxList } from './lists.ts';
import { createTask, toggleTaskDone } from './tasks.ts';
import type { Due, Schedule, Task, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const TZ = 'America/Chicago';
const TODAY = '2026-10-20';
const at = (start: string): Schedule => ({
  start,
  end: null,
  allDay: start.length === 10,
  timeZone: TZ,
});
const due = (value: string): Due => ({ at: value, allDay: value.length === 10, timeZone: TZ });
const titles = (tasks: Task[]) => tasks.map((task) => task.title);

function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]> = {}) => {
    const result = createTask(ctx, ws, { title, listId: inbox, ...extra });
    ws = result.workspace;
    return result.task;
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

describe('agenda days', () => {
  it('lists every day from the first one, empty days too', () => {
    const s = setup();
    s.add('today', { schedule: at('2026-10-20') });
    s.add('thursday', { schedule: at('2026-10-22T09:00') });
    s.add('too late', { schedule: at('2026-10-24') });
    s.add('overdue', { schedule: at('2026-10-18') });
    const days = agendaDays(s.ws, TODAY, TODAY, 4);
    expect(days.map((day) => [day.date, titles(day.tasks)])).toEqual([
      ['2026-10-20', ['today']],
      ['2026-10-21', []],
      ['2026-10-22', ['thursday']],
      ['2026-10-23', []],
    ]);
  });

  it('starts from a later day', () => {
    const s = setup();
    s.add('next week', { schedule: at('2026-10-27') });
    const days = agendaDays(s.ws, TODAY, '2026-10-26', 2);
    expect(days.map((day) => titles(day.tasks))).toEqual([[], ['next week']]);
  });
});

describe('due groups', () => {
  it('sorts open tasks with a due date into Overdue, Today, Tomorrow, this week and Later', () => {
    const s = setup();
    s.add('later', { due: due('2026-11-30') });
    s.add('late', { due: due('2026-10-19') });
    s.add('today', { due: due('2026-10-20T17:00') });
    s.add('tomorrow', { due: due('2026-10-21') });
    s.add('week', { due: due('2026-10-27') });
    s.add('no due', { schedule: at('2026-10-20') });
    const done = s.add('done', { due: due('2026-10-20') });
    s.ws = toggleTaskDone(s.ctx, s.ws, done.id);
    expect(dueGroups(s.ws, TODAY).map((group) => [group.key, titles(group.tasks)])).toEqual([
      ['overdue', ['late']],
      ['today', ['today']],
      ['tomorrow', ['tomorrow']],
      ['week', ['week']],
      ['later', ['later']],
    ]);
  });
});

describe('setting many due dates', () => {
  it('moves each to the day, keeping its own time; tasks without one get an all-day date', () => {
    const s = setup();
    const timed = s.add('timed', { due: due('2026-10-18T09:30') });
    const allDay = s.add('all day', { due: due('2026-10-19') });
    const none = s.add('none');
    s.ws = setDueDates(s.ctx, s.ws, [timed.id, allDay.id, none.id], '2026-10-25', TZ);
    const dueOf = (id: string) => getEntity(s.ws, 'tasks', id)?.due;
    expect(dueOf(timed.id)).toMatchObject({ at: '2026-10-25T09:30', allDay: false });
    expect(dueOf(allDay.id)).toMatchObject({ at: '2026-10-25', allDay: true });
    expect(dueOf(none.id)).toMatchObject({ at: '2026-10-25', allDay: true, timeZone: TZ });
  });

  it('clears due dates, and changes nothing when nothing moves', () => {
    const s = setup();
    const task = s.add('task', { due: due('2026-10-19') });
    const before = s.ws;
    expect(setDueDates(s.ctx, before, [task.id], '2026-10-19', TZ)).toBe(before);
    s.ws = setDueDates(s.ctx, s.ws, [task.id], null, TZ);
    expect(getEntity(s.ws, 'tasks', task.id)?.due).toBeNull();
  });
});
