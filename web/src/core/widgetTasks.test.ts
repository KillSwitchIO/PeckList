import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { createList, inboxList } from './lists.ts';
import { createTask, toggleTaskDone } from './tasks.ts';
import type { Schedule, WorkspaceFile } from './types.ts';
import { WIDGET_TASK_LIMIT, widgetFeed } from './widgetTasks.ts';
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
});
