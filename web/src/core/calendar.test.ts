import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { calendarItems, droppedSchedule, placedSchedule, unscheduledTasks } from './calendar.ts';
import { inboxList } from './lists.ts';
import { createTask, deleteTask, toggleTaskDone } from './tasks.ts';
import type { Schedule, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const TZ = 'Europe/Berlin';
const on = (start: string, end: string | null = null, allDay = start.length === 10): Schedule => ({
  start,
  end,
  allDay,
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

describe('calendar items', () => {
  it('draws each kind of schedule as the spec says, with due dates as their own flags', () => {
    const t = setup();
    const day = t.add('Day only', { schedule: on('2026-10-22') });
    const point = t.add('Point', { schedule: on('2026-10-22T09:00', null, false) });
    const range = t.add('Range', { schedule: on('2026-10-22T09:00', '2026-10-22T11:30', false) });
    const span = t.add('Span', { schedule: on('2026-10-21', '2026-10-24') });
    const both = t.add('Due too', {
      schedule: on('2026-10-20'),
      priority: 3,
      due: { at: '2026-10-23', allDay: true, timeZone: TZ },
    });
    const items = calendarItems(t.ws, '2026-10-19', '2026-10-25', 30);
    const find = (id: string) => items.find((item) => item.id === id)!;

    expect(find(day.id)).toMatchObject({
      kind: 'schedule',
      start: '2026-10-22',
      end: null,
      allDay: true,
      movable: true,
    });
    // A start time alone is drawn for the point-event length.
    expect(find(point.id)).toMatchObject({
      start: '2026-10-22T09:00',
      end: '2026-10-22T09:30',
      allDay: false,
    });
    expect(find(range.id)).toMatchObject({
      start: '2026-10-22T09:00',
      end: '2026-10-22T11:30',
      allDay: false,
    });
    expect(find(span.id)).toMatchObject({ start: '2026-10-21', end: '2026-10-24', allDay: true });
    expect(find(both.id)).toMatchObject({ start: '2026-10-20', priority: 3 });
    expect(find(`due:${both.id}`)).toMatchObject({
      kind: 'due',
      taskId: both.id,
      start: '2026-10-23',
      allDay: true,
      movable: false,
    });
    expect(items).toHaveLength(6);
  });

  it('shows only what touches the days asked for, and nothing deleted', () => {
    const t = setup();
    t.add('Before', { schedule: on('2026-10-10') });
    t.add('Spans in', { schedule: on('2026-10-15', '2026-10-20') });
    const late = t.add('Late night', { schedule: on('2026-10-18T23:45', null, false) });
    const gone = t.add('Deleted', { schedule: on('2026-10-20') });
    t.ws = deleteTask(t.ctx, t.ws, gone.id);
    const closed = t.add('Done', { schedule: on('2026-10-21') });
    t.ws = toggleTaskDone(t.ctx, t.ws, closed.id);
    const items = calendarItems(t.ws, '2026-10-19', '2026-10-25', 30);
    expect(items.map((item) => item.title).sort()).toEqual(['Done', 'Late night', 'Spans in']);
    // A point event at 23:45 runs past midnight into the visible days.
    expect(items.find((item) => item.taskId === late.id)!.end).toBe('2026-10-19T00:15');
    expect(items.find((item) => item.title === 'Done')!.done).toBe(true);
  });

  it('leaves tasks a person may not change unmovable', () => {
    const t = setup();
    const theirs = t.add('Theirs', { schedule: on('2026-10-22') });
    const items = calendarItems(
      t.ws,
      '2026-10-19',
      '2026-10-25',
      30,
      (task) => task.id !== theirs.id,
    );
    expect(items[0]!.movable).toBe(false);
  });
});

describe('dragging on the calendar', () => {
  it("moves a day, keeps a span's length, and takes a new end when one is given", () => {
    expect(
      placedSchedule(on('2026-10-22'), { start: '2026-10-24', end: null, allDay: true }, TZ),
    ).toEqual(on('2026-10-24'));
    expect(
      placedSchedule(
        on('2026-10-21', '2026-10-24'),
        { start: '2026-10-26', end: null, allDay: true },
        TZ,
      ),
    ).toEqual(on('2026-10-26', '2026-10-29'));
    expect(
      placedSchedule(
        on('2026-10-21', '2026-10-24'),
        { start: '2026-10-21', end: '2026-10-22', allDay: true },
        TZ,
      ),
    ).toEqual(on('2026-10-21', '2026-10-22'));
    // An end on the start day is one day.
    expect(
      placedSchedule(null, { start: '2026-10-21', end: '2026-10-21', allDay: true }, TZ),
    ).toEqual(on('2026-10-21'));
  });

  it('moves timed ones keeping their length, and turns all-day ones timed when dropped on a time', () => {
    expect(
      placedSchedule(
        on('2026-10-22T09:00', '2026-10-22T11:30', false),
        { start: '2026-10-23T14:00', end: null, allDay: false },
        TZ,
      ),
    ).toEqual(on('2026-10-23T14:00', '2026-10-23T16:30', false));
    expect(
      placedSchedule(
        on('2026-10-22T09:00', null, false),
        { start: '2026-10-22T10:15', end: null, allDay: false },
        TZ,
      ),
    ).toEqual(on('2026-10-22T10:15', null, false));
    // Resizing gives the end.
    expect(
      placedSchedule(
        on('2026-10-22T09:00', null, false),
        { start: '2026-10-22T09:00', end: '2026-10-22T10:00', allDay: false },
        TZ,
      ),
    ).toEqual(on('2026-10-22T09:00', '2026-10-22T10:00', false));
    expect(
      placedSchedule(on('2026-10-22'), { start: '2026-10-22T08:00', end: null, allDay: false }, TZ),
    ).toEqual(on('2026-10-22T08:00', null, false));
    // A timed task dropped on the all-day row loses its time.
    expect(
      placedSchedule(
        on('2026-10-22T09:00', null, false),
        { start: '2026-10-22', end: null, allDay: true },
        TZ,
      ),
    ).toEqual(on('2026-10-22'));
  });

  it('schedules an unscheduled task where it is dropped, and lists the ones still waiting', () => {
    expect(droppedSchedule('2026-10-22', null, TZ)).toEqual(on('2026-10-22'));
    expect(droppedSchedule('2026-10-22', '09:30', TZ)).toEqual(on('2026-10-22T09:30', null, false));
    const t = setup();
    t.add('Waiting');
    t.add('Planned', { schedule: on('2026-10-22') });
    expect(unscheduledTasks(t.ws).map((task) => task.title)).toEqual(['Waiting']);
  });
});
