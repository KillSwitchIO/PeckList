import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { createList, deleteList, inboxList } from './lists.ts';
import {
  completedTasks,
  dateState,
  listTasks,
  openCounts,
  completedOn,
  startDate,
  startState,
  todayGroups,
  subtaskProgress,
  todayTasks,
  dayTasks,
  trashedTasks,
  upcomingTasks,
} from './queries.ts';
import { createTask, deleteTask, toggleTaskDone } from './tasks.ts';
import type { Due, Schedule, Task, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const TZ = 'America/Chicago';
const TODAY = '2026-10-20';
const at = (start: string, end: string | null = null): Schedule => ({
  start,
  end,
  allDay: start.length === 10,
  timeZone: TZ,
});
const due = (date: string): Due => ({ at: date, allDay: true, timeZone: TZ });

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
    inbox,
    add,
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const titles = (tasks: Task[]) => tasks.map((task) => task.title);

describe('dateState', () => {
  const s = setup();
  const task = (schedule: Schedule | null, d: Due | null, status: Task['status'] = 'open') =>
    ({ ...s.add('x'), schedule, due: d, status }) as Task;

  it('follows the Design Spec rules', () => {
    expect(dateState(task(null, null), TODAY, 2)).toBe('none');
    expect(dateState(task(null, due('2026-10-19')), TODAY, 2)).toBe('late');
    expect(dateState(task(at('2026-10-18'), null), TODAY, 2)).toBe('late');
    expect(dateState(task(at('2026-10-18'), due('2026-10-25')), TODAY, 2)).toBe('slipped');
    expect(dateState(task(null, due('2026-10-22')), TODAY, 2)).toBe('dueSoon');
    expect(dateState(task(null, due('2026-10-30')), TODAY, 2)).toBe('normal');
    expect(dateState(task(at('2026-10-21T09:00'), null), TODAY, 2)).toBe('normal');
    expect(dateState(task(null, due('2026-10-01'), 'done'), TODAY, 2)).toBe('normal');
  });

  it('uses the schedule end for ranges', () => {
    expect(dateState(task(at('2026-10-15', '2026-10-21'), null), TODAY, 2)).toBe('normal');
  });
});

describe('smart views', () => {
  it('Today includes tasks starting today and overdue, sorted by start then priority', () => {
    const s = setup();
    s.add('future', { schedule: at('2026-10-22') });
    s.add('due today only', { due: due(TODAY) });
    s.add('overdue', { schedule: at('2026-10-10T08:00') });
    s.add('today', { schedule: at(TODAY) });
    s.add('urgent today', { schedule: at(TODAY), priority: 3 });
    s.add('no date');
    expect(titles(todayTasks(s.ws, TODAY))).toEqual(['overdue', 'urgent today', 'today']);
  });

  it('a day holds the open tasks starting on it, by time, past days and future ones alike', () => {
    const s = setup();
    s.add('day before', { schedule: at('2026-10-24') });
    s.add('afternoon', { schedule: at('2026-10-25T15:00') });
    s.add('all day', { schedule: at('2026-10-25') });
    s.add('due only', { due: due('2026-10-25') });
    s.add('long ago', { schedule: at('2026-10-02') });
    expect(titles(dayTasks(s.ws, '2026-10-25', TODAY))).toEqual(['all day', 'afternoon']);
    expect(titles(dayTasks(s.ws, '2026-10-02', TODAY))).toEqual(['long ago']);
  });

  it('Next 7 days groups by date and excludes today and later', () => {
    const s = setup();
    s.add('tomorrow', { schedule: at('2026-10-21') });
    s.add('in a week', { schedule: at('2026-10-27') });
    s.add('too late', { schedule: at('2026-10-28') });
    s.add('today', { schedule: at(TODAY) });
    expect(upcomingTasks(s.ws, TODAY).map((g) => [g.date, titles(g.tasks)])).toEqual([
      ['2026-10-21', ['tomorrow']],
      ['2026-10-27', ['in a week']],
    ]);
  });

  it('hides done, deleted and tasks of deleted lists; dated subtasks follow their parent', () => {
    const s = setup();
    const { workspace, list } = createList(s.ctx, s.ws, { name: 'Gone', color: '#A8DCC0' });
    s.ws = workspace;
    s.add('in deleted list', { listId: list.id, schedule: at(TODAY) });
    s.ws = deleteList(s.ctx, s.ws, list.id);
    const done = s.add('done', { schedule: at(TODAY) });
    s.ws = toggleTaskDone(s.ctx, s.ws, done.id);
    const parent = s.add('parent', { schedule: at(TODAY) });
    s.add('child', { parentId: parent.id, schedule: at(TODAY) });
    expect(titles(todayTasks(s.ws, TODAY))).toEqual(['parent', 'child']);
  });

  it('Completed lists most recent first and can filter by list', () => {
    const s = setup();
    const a = s.add('a');
    const b = s.add('b');
    s.ws = toggleTaskDone(s.ctx, s.ws, a.id);
    s.ctx.now = () => Date.UTC(2026, 9, 21);
    s.ws = toggleTaskDone(s.ctx, s.ws, b.id);
    expect(titles(completedTasks(s.ws))).toEqual(['b', 'a']);
    expect(completedTasks(s.ws, 'other')).toEqual([]);
  });

  it('Trash shows deleted subtree roots for 30 days', () => {
    const s = setup();
    const parent = s.add('parent');
    s.add('child', { parentId: parent.id });
    const old = s.add('old');
    s.ctx.now = () => Date.UTC(2026, 8, 1);
    s.ws = deleteTask(s.ctx, s.ws, old.id);
    s.ctx.now = () => Date.UTC(2026, 9, 20);
    s.ws = deleteTask(s.ctx, s.ws, parent.id);
    expect(titles(trashedTasks(s.ws, Date.UTC(2026, 9, 21)))).toEqual(['parent']);
  });
});

describe('list contents', () => {
  it("lists open top-level tasks in the list's own order", () => {
    const s = setup();
    const first = s.add('first');
    s.add('second');
    s.add('child', { parentId: first.id });
    expect(titles(listTasks(s.ws, s.inbox))).toEqual(['first', 'second']);
  });

  it('counts subtask progress and open tasks per list', () => {
    const s = setup();
    const parent = s.add('parent');
    const child = s.add('child', { parentId: parent.id });
    s.add('child 2', { parentId: parent.id });
    s.ws = toggleTaskDone(s.ctx, s.ws, child.id);
    expect(subtaskProgress(s.ws, parent.id)).toEqual({ done: 1, total: 2 });
    expect(openCounts(s.ws).get(s.inbox)).toBe(1);
  });

  it('uses the start date only; due dates do not place tasks in lists', () => {
    const s = setup();
    const task = s.add('x', { schedule: at('2026-10-25T10:00'), due: due('2026-10-23') });
    expect(startDate(task)).toBe('2026-10-25');
    expect(startDate(s.add('none', { due: due(TODAY) }))).toBeNull();
    expect(todayTasks(s.ws, TODAY)).toEqual([]);
  });

  it('start state: overdue, today, later, none', () => {
    const s = setup();
    expect(startState(s.add('a', { schedule: at('2026-10-19') }), TODAY)).toBe('overdue');
    expect(startState(s.add('b', { schedule: at('2026-10-20T08:00') }), TODAY)).toBe('today');
    expect(startState(s.add('c', { schedule: at('2026-10-21') }), TODAY)).toBe('later');
    expect(startState(s.add('d'), TODAY)).toBe('none');
  });

  it('splits Today into overdue and today, ordered by time', () => {
    const s = setup();
    s.add('late', { schedule: at('2026-10-18') });
    s.add('evening', { schedule: at('2026-10-20T20:00') });
    s.add('morning', { schedule: at('2026-10-20T08:00') });
    s.add('all day', { schedule: at(TODAY) });
    const groups = todayGroups(s.ws, TODAY);
    expect(titles(groups.overdue)).toEqual(['late']);
    expect(titles(groups.today)).toEqual(['all day', 'morning', 'evening']);
  });

  it('finds tasks completed today in the local time zone', () => {
    const s = setup();
    const a = s.add('a');
    const b = s.add('b');
    s.ctx.now = () => Date.UTC(2026, 9, 20, 15);
    s.ws = toggleTaskDone(s.ctx, s.ws, a.id);
    s.ctx.now = () => Date.UTC(2026, 9, 21, 3); // still Oct 20 in Chicago
    s.ws = toggleTaskDone(s.ctx, s.ws, b.id);
    expect(titles(completedOn(s.ws, TODAY, TZ))).toEqual(['b', 'a']);
    expect(titles(completedOn(s.ws, TODAY, 'UTC'))).toEqual(['a']);
  });
});
