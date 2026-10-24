import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import {
  ALL_TASKS,
  dateGroupOf,
  filterClosedTasks,
  filterTasks,
  groupByDate,
  type TaskFilter,
} from './filters.ts';
import { putEntity } from './collections.ts';
import { createList, inboxList } from './lists.ts';
import { softDelete } from './ops.ts';
import { createTag } from './tags.ts';
import { setAssignee } from './sharing.ts';
import { createTask, setTaskStatus } from './tasks.ts';
import type { Schedule, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const TODAY = '2026-10-21';
const on = (date: string): Schedule => ({ start: date, end: null, allDay: true, timeZone: 'UTC' });

function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const work = createList(ctx, ws, { name: 'Work', color: '#A7C7E7' });
  ws = work.workspace;
  const tagged = createTag(ctx, ws, 'home/yard', '#A8DCC0');
  ws = tagged.workspace;
  const home = ws.entities.tags.find((tag) => tag.name === 'home')!.id;
  const yard = tagged.tag.id;
  const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]> = {}) => {
    const result = createTask(ctx, ws, { title, listId: inbox, ...extra });
    ws = result.workspace;
    return result.task;
  };
  const overdue = add('overdue', { schedule: on('2026-10-19'), priority: 3 });
  add('today', { schedule: on(TODAY), tags: [yard] });
  add('tomorrow', { schedule: on('2026-10-22'), listId: work.list.id });
  add('in a week', { schedule: on('2026-10-28') });
  add('later', { schedule: on('2026-11-30'), tags: [home] });
  const undated = add('undated', { listId: work.list.id });
  add('undated child', { parentId: undated.id });
  return {
    ctx,
    inbox,
    work: work.list.id,
    home,
    yard,
    overdue,
    undated,
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const titles = (s: ReturnType<typeof setup>, filter: TaskFilter) =>
  filterTasks(s.ws, filter, TODAY).map((task) => task.title);

describe('filter engine', () => {
  it('All has no conditions: every open task, dated first, undated last', () => {
    const s = setup();
    expect(titles(s, ALL_TASKS)).toEqual([
      'overdue',
      'today',
      'tomorrow',
      'in a week',
      'later',
      'undated',
      'undated child',
    ]);
  });

  it('filters by list and by tag, nested tags included', () => {
    const s = setup();
    expect(titles(s, { lists: [s.work] })).toEqual(['tomorrow', 'undated', 'undated child']);
    expect(titles(s, { tags: [s.home] })).toEqual(['today', 'later']);
    expect(titles(s, { tags: [s.yard] })).toEqual(['today']);
    expect(titles(s, { tags: ['gone'] })).toEqual([]);
  });

  it('filters by start window (undated never match) and by having a date', () => {
    const s = setup();
    expect(titles(s, { start: { to: 0 } })).toEqual(['overdue', 'today']);
    expect(titles(s, { start: { from: 1, to: 7 } })).toEqual(['tomorrow', 'in a week']);
    expect(titles(s, { dated: false })).toEqual(['undated', 'undated child']);
  });

  it('combines conditions with AND, values with OR', () => {
    const s = setup();
    expect(titles(s, { lists: [s.inbox, s.work], start: { to: 1 } })).toEqual([
      'overdue',
      'today',
      'tomorrow',
    ]);
    expect(titles(s, { priorities: [3], start: { to: 0 } })).toEqual(['overdue']);
  });

  it('hides tasks of a deleted list, but not of a list this device never had', () => {
    const s = setup();
    const work = s.ws.entities.lists.find((list) => list.id === s.work)!;
    const deleted = putEntity(s.ws, 'lists', softDelete(s.ctx, work));
    expect(filterTasks(deleted, ALL_TASKS, TODAY).map((task) => task.title)).not.toContain(
      'tomorrow',
    );
    // Assigned from someone else's list: the task came without it.
    const unknown = {
      ...s.ws,
      entities: { ...s.ws.entities, lists: s.ws.entities.lists.filter((list) => list !== work) },
    };
    expect(filterTasks(unknown, ALL_TASKS, TODAY).map((task) => task.title)).toContain('tomorrow');
  });

  it('shared with me: tasks in lists others own, or from lists I do not have', () => {
    const s = setup();
    expect(titles(s, { sharedWith: s.ctx.userId })).toEqual([]);
    const work = s.ws.entities.lists.find((list) => list.id === s.work)!;
    const theirs = putEntity(s.ws, 'lists', { ...work, createdBy: 'someone-else' });
    expect(filterTasks(theirs, { sharedWith: s.ctx.userId }, TODAY).map((t) => t.title)).toEqual([
      'tomorrow',
      'undated',
      'undated child',
    ]);
    const missing = {
      ...s.ws,
      entities: { ...s.ws.entities, lists: s.ws.entities.lists.filter((list) => list !== work) },
    };
    expect(filterTasks(missing, { sharedWith: s.ctx.userId }, TODAY)).toHaveLength(3);
  });

  it("keeps an archived list's tasks out of views but on its own page", () => {
    const s = setup();
    const work = s.ws.entities.lists.find((list) => list.id === s.work)!;
    const archived = putEntity(s.ws, 'lists', { ...work, archived: true });
    expect(filterTasks(archived, ALL_TASKS, TODAY).map((task) => task.title)).not.toContain(
      'tomorrow',
    );
    expect(filterTasks(archived, { lists: [s.work] }, TODAY).map((task) => task.title)).toEqual([
      'tomorrow',
      'undated',
      'undated child',
    ]);
  });

  it('lists closed tasks without the subtasks closed along with their parent', () => {
    const s = setup();
    s.ws = setTaskStatus(s.ctx, s.ws, s.undated.id, 'done');
    s.ws = setTaskStatus(s.ctx, s.ws, s.overdue.id, 'wontdo');
    expect(filterClosedTasks(s.ws, ALL_TASKS, TODAY).map((task) => task.title)).toEqual([
      'overdue',
      'undated',
    ]);
    expect(filterClosedTasks(s.ws, { lists: [s.work] }, TODAY).map((task) => task.title)).toEqual([
      'undated',
    ]);
  });

  it('groups by date: overdue, today, tomorrow, next 7 days, later, no date', () => {
    const s = setup();
    const groups = groupByDate(s.ws, filterTasks(s.ws, ALL_TASKS, TODAY), TODAY);
    expect(groups.map((group) => [group.key, group.tasks.map((task) => task.title)])).toEqual([
      ['overdue', ['overdue']],
      ['today', ['today']],
      ['tomorrow', ['tomorrow']],
      ['week', ['in a week']],
      ['later', ['later']],
      ['none', ['undated', 'undated child']],
    ]);
    expect(groups[1]!.date).toBe(TODAY);
    expect(dateGroupOf(s.overdue, '2026-10-01')).toBe('later');
  });

  it('keeps an undated subtask in its dated parent group', () => {
    const s = setup();
    const parent = filterTasks(s.ws, ALL_TASKS, TODAY).find((task) => task.title === 'tomorrow')!;
    s.ws = createTask(s.ctx, s.ws, {
      title: 'prep',
      listId: s.work,
      parentId: parent.id,
    }).workspace;
    const groups = groupByDate(s.ws, filterTasks(s.ws, ALL_TASKS, TODAY), TODAY);
    const tomorrow = groups.find((group) => group.key === 'tomorrow')!;
    expect(tomorrow.tasks.map((task) => task.title)).toEqual(['tomorrow', 'prep']);
  });
});

describe('assignee and date-state conditions', () => {
  it('finds tasks assigned to me (directly or through a group), to someone, or to nobody', () => {
    const s = setup();
    const me = s.ctx.userId;
    const sam = '01JBSAM0000000000000000002';
    const group = '01JBGRP0000000000000000003';
    s.ws = setAssignee(s.ctx, s.ws, s.overdue.id, `user:${me}`, true);
    const later = s.ws.entities.tasks.find((task) => task.title === 'later')!;
    s.ws = setAssignee(s.ctx, s.ws, later.id, `user:${sam}`, true);
    const tomorrow = s.ws.entities.tasks.find((task) => task.title === 'tomorrow')!;
    s.ws = setAssignee(s.ctx, s.ws, tomorrow.id, `group:${group}`, true);
    expect(titles(s, { assignees: ['me'] })).toEqual(['overdue']);
    expect(titles(s, { assignees: [`user:${sam}`] })).toEqual(['later']);
    expect(titles(s, { assignees: [`user:${sam}`, `group:${group}`] })).toEqual([
      'tomorrow',
      'later',
    ]);
    expect(titles(s, { assignees: ['none'], dated: true })).toEqual(['today', 'in a week']);
    // Through a group I am an active member of.
    s.ws = putEntity(s.ws, 'groupMembers', {
      id: '01JBMEM0000000000000000004',
      groupId: group,
      userId: me,
      joinedAt: '2026-10-20T10:00:00.000Z',
      state: 'active',
      createdAt: '2026-10-20T10:00:00.000Z',
      createdBy: me,
      deletedAt: null,
      origin: 'test',
      _hlc: {},
    } as unknown as Parameters<typeof putEntity<'groupMembers'>>[2]);
    expect(titles(s, { assignees: ['me'] })).toEqual(['overdue', 'tomorrow']);
  });

  it('finds late, slipped and due-soon tasks', () => {
    const s = setup();
    const due = (at: string) => ({ at, allDay: true, timeZone: 'UTC' });
    s.ws = createTask(s.ctx, s.ws, {
      title: 'due yesterday',
      listId: s.inbox,
      due: due('2026-10-20'),
    }).workspace;
    s.ws = createTask(s.ctx, s.ws, {
      title: 'slipped',
      listId: s.inbox,
      schedule: on('2026-10-19'),
      due: due('2026-10-30'),
    }).workspace;
    s.ws = createTask(s.ctx, s.ws, {
      title: 'due tomorrow',
      listId: s.inbox,
      due: due('2026-10-22'),
    }).workspace;
    expect(titles(s, { states: ['late'] }).sort()).toEqual(['due yesterday', 'overdue']);
    expect(titles(s, { states: ['slipped'] })).toEqual(['slipped']);
    expect(titles(s, { states: ['dueSoon'] })).toEqual(['due tomorrow']);
    expect(titles(s, { states: ['slipped', 'dueSoon'] }).sort()).toEqual([
      'due tomorrow',
      'slipped',
    ]);
  });
});
