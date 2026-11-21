import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { createList, inboxList } from './lists.ts';
import { createSavedFilter } from './savedFilters.ts';
import { createTask, toggleTaskDone } from './tasks.ts';
import type { Schedule, WorkspaceFile } from './types.ts';
import {
  WIDGET_TASK_LIMIT,
  WIDGET_VIEW_LIMIT,
  WIDGET_VIEWS_LIMIT,
  widgetFeed,
} from './widgetTasks.ts';
import { createWorkspace } from './workspace.ts';

const TZ = 'America/Chicago';
const TODAY = '2026-11-19';
const at = (start: string, end: string | null = null): Schedule => ({
  start,
  end,
  allDay: start.length === 10,
  timeZone: TZ,
});

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

describe('widgetFeed', () => {
  it("hands over today's and tomorrow's open tasks, overdue first, then by day and time", () => {
    const s = setup();
    s.add('Later', { schedule: at('2026-11-19T17:30') });
    s.add('Untimed', { schedule: at('2026-11-19') });
    s.add('Early', { schedule: at('2026-11-19T08:00') });
    s.add('Overdue', { schedule: at('2026-11-17') });
    s.add('Tomorrow', { schedule: at('2026-11-20T09:15') });
    s.add('Next week', { schedule: at('2026-11-26') });
    s.add('Someday');
    const done = s.add('Done', { schedule: at('2026-11-19') });
    s.ws = toggleTaskDone(s.ctx, s.ws, done.id);

    const feed = widgetFeed(s.ws, TODAY);
    expect(feed.asOf).toBe(TODAY);
    expect(feed.tasks.map((task) => [task.title, task.on, task.time ?? null])).toEqual([
      ['Overdue', '2026-11-17', null],
      ['Early', TODAY, '08:00'],
      ['Later', TODAY, '17:30'],
      ['Untimed', TODAY, null],
      ['Tomorrow', '2026-11-20', '09:15'],
    ]);
  });

  it('places a task running over days on today, and on tomorrow as it will be after midnight', () => {
    const s = setup();
    s.add('Trip', { schedule: at('2026-11-18', '2026-11-21') });
    const [trip] = widgetFeed(s.ws, TODAY).tasks;
    expect(trip).toMatchObject({ on: TODAY, next: '2026-11-20' });
  });

  it("carries the priority and the list's color", () => {
    const s = setup();
    const made = createList(s.ctx, s.ws, { name: 'Garden', color: '#5A8A4E' });
    s.ws = made.workspace;
    s.add('Weed', { listId: made.list.id, priority: 3, schedule: at(TODAY) });
    expect(widgetFeed(s.ws, TODAY).tasks[0]).toMatchObject({ priority: 3, color: '#5A8A4E' });
  });

  it(`keeps at most ${WIDGET_TASK_LIMIT} tasks`, () => {
    const s = setup();
    for (let i = 0; i < WIDGET_TASK_LIMIT + 5; i++) s.add(`Task ${i}`, { schedule: at(TODAY) });
    expect(widgetFeed(s.ws, TODAY).tasks).toHaveLength(WIDGET_TASK_LIMIT);
  });

  describe('for a widget set to another view (PL-121)', () => {
    it("hands over Upcoming's tasks through a day past its week, without repeats' projections", () => {
      const s = setup();
      s.add('Today', { schedule: at(TODAY) });
      const tomorrow = s.add('Tomorrow', { schedule: at('2026-11-20') });
      const week = s.add('In a week', { schedule: at('2026-11-26') });
      const past = s.add('A day past the week', { schedule: at('2026-11-27') });
      s.add('Too far', { schedule: at('2026-11-28') });
      const weekly = s.add('Weekly', { schedule: at('2026-11-21'), recurrence: 'FREQ=DAILY' });
      const feed = widgetFeed(s.ws, TODAY);
      expect(feed.upcoming).toEqual([tomorrow.id, weekly.id, week.id, past.id]);
      // Tomorrow's is in `tasks` already; the rest come in `more` (with the Inbox's), once each.
      const more = feed.more!.map((task) => task.id);
      expect(more).toEqual(expect.arrayContaining([weekly.id, week.id, past.id]));
      expect(more).not.toContain(tomorrow.id);
      expect(new Set(more).size).toBe(more.length);
    });

    it('lists every list, the Inbox first, then the saved filters, each with its tasks in order', () => {
      const s = setup();
      const garden = createList(s.ctx, s.ws, { name: 'Garden', color: '#5A8A4E' });
      s.ws = garden.workspace;
      const weed = s.add('Weed', { listId: garden.list.id });
      const water = s.add('Water', { listId: garden.list.id, priority: 3 });
      const call = s.add('Call the plumber');
      const saved = createSavedFilter(s.ctx, s.ws, 'Urgent', { priorities: [3] });
      s.ws = saved.workspace;
      const feed = widgetFeed(s.ws, TODAY);
      expect(feed.views!.map(({ key, kind, name, ids }) => ({ key, kind, name, ids }))).toEqual([
        {
          key: `list:${inboxList(s.ws).id}`,
          kind: 'inbox',
          name: inboxList(s.ws).name,
          ids: [call.id],
        },
        { key: `list:${garden.list.id}`, kind: 'list', name: 'Garden', ids: [weed.id, water.id] },
        { key: `filter:${saved.filter.id}`, kind: 'filter', name: 'Urgent', ids: [water.id] },
      ]);
      expect(feed.views![1]!.color).toBe('#5A8A4E');
      // An undated task has no day at all.
      const handed = feed.more!.find((task) => task.id === weed.id)!;
      expect(handed).toMatchObject({ title: 'Weed', priority: 0, color: '#5A8A4E' });
      expect(handed.on).toBeUndefined();
      expect(handed.next).toBeUndefined();
    });

    it(`keeps at most ${WIDGET_VIEW_LIMIT} tasks a view`, () => {
      const s = setup();
      for (let i = 0; i < WIDGET_VIEW_LIMIT + 5; i++) s.add(`Task ${i}`);
      expect(widgetFeed(s.ws, TODAY).views![0]!.ids).toHaveLength(WIDGET_VIEW_LIMIT);
    });

    it(`offers at most ${WIDGET_VIEWS_LIMIT} lists and filters, the lists first`, () => {
      const s = setup();
      for (let i = 0; i < WIDGET_VIEWS_LIMIT; i++) {
        s.ws = createList(s.ctx, s.ws, { name: `List ${i}`, color: '#5A8A4E' }).workspace;
      }
      s.ws = createSavedFilter(s.ctx, s.ws, 'Urgent', { priorities: [3] }).workspace;
      const views = widgetFeed(s.ws, TODAY).views!;
      expect(views).toHaveLength(WIDGET_VIEWS_LIMIT);
      expect(views.every((view) => view.kind !== 'filter')).toBe(true);
    });
  });
});
