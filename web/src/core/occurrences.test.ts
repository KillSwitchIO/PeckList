import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { calendarItems } from './calendar.ts';
import { filterTasks, groupByDay } from './filters.ts';
import { inboxList } from './lists.ts';
import {
  detachOccurrence,
  occurrenceOf,
  projectOccurrences,
  skipOccurrence,
} from './occurrences.ts';
import { createTask } from './tasks.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

// Ben, 2026-11-02: therapy on Friday the 6th repeats on the 13th, but did not show there until
// the 6th was done.
const TODAY = '2026-11-02';

function therapy(recurrence = 'FREQ=WEEKLY;BYDAY=FR') {
  const ctx = testContext('ben', Date.parse('2026-11-02T15:00:00Z'));
  let ws: WorkspaceFile = createWorkspace(ctx);
  const made = createTask(ctx, ws, {
    title: 'Therapy',
    listId: inboxList(ws).id,
    schedule: {
      start: '2026-11-06T15:00',
      end: '2026-11-06T16:00',
      allDay: false,
      timeZone: 'America/Chicago',
    },
    reminders: [{ before: 30 }, { at: '2026-11-06T09:00' }],
    recurrence,
  });
  ws = made.workspace;
  const get = (id: string) => ws.entities.tasks.find((task) => task.id === id)!;
  return {
    ctx,
    id: made.task.id,
    get,
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const days = (ws: WorkspaceFile, to: number) =>
  groupByDay(filterTasks(ws, { start: { from: 0, to } }, TODAY)).map((day) => ({
    date: day.date,
    titles: day.tasks.map((task) => (occurrenceOf(task) ? `${task.title} (to come)` : task.title)),
  }));

describe("a repeating task's dates to come (PL-060)", () => {
  it('shows on each date it falls on, before the first is done', () => {
    const { ws } = therapy();
    expect(days(ws, 20)).toEqual([
      { date: '2026-11-06', titles: ['Therapy'] },
      { date: '2026-11-13', titles: ['Therapy (to come)'] },
      { date: '2026-11-20', titles: ['Therapy (to come)'] },
    ]);
    const next = projectOccurrences(ws.entities.tasks, '2026-11-07', '2026-11-13')[0]!;
    expect(next.schedule).toMatchObject({ start: '2026-11-13T15:00', end: '2026-11-13T16:00' });
    expect(occurrenceOf(next)).toEqual({
      taskId: ws.entities.tasks.at(-1)!.id,
      date: '2026-11-13',
    });
  });

  it('shows on the calendar too, as something that cannot be dragged', () => {
    const { ws, id } = therapy();
    const items = calendarItems(ws, '2026-11-01', '2026-11-30', 30).filter(
      (item) => item.taskId === id,
    );
    expect(items.map((item) => [item.start, item.occurrence ?? null, item.movable])).toEqual([
      ['2026-11-06T15:00', null, true],
      ['2026-11-13T15:00', '2026-11-13', false],
      ['2026-11-20T15:00', '2026-11-20', false],
      ['2026-11-27T15:00', '2026-11-27', false],
    ]);
  });

  it('stops where the series does, and never shows today or before', () => {
    const { ws } = therapy('FREQ=DAILY;COUNT=3');
    expect(days(ws, 30).map((day) => day.date)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
    expect(filterTasks(ws, { start: { to: 0 } }, '2026-11-08')).toHaveLength(1);
    // A series counting from completion has no dates to come until it is done.
    expect(days(therapy('FREQ=WEEKLY;X-PL-FROM=COMPLETION').ws, 30)).toHaveLength(1);
  });

  it('skips one date to come and keeps the rest (cancel the 13th, keep the 6th and 20th)', () => {
    const s = therapy();
    s.ws = skipOccurrence(s.ctx, s.ws, s.id, '2026-11-13');
    expect(days(s.ws, 20)).toEqual([
      { date: '2026-11-06', titles: ['Therapy'] },
      { date: '2026-11-20', titles: ['Therapy (to come)'] },
    ]);
    // Skipping the 6th as well moves it on to the 20th, and the skip is used up.
    s.ws = skipOccurrence(s.ctx, s.ws, s.id, '2026-11-06');
    expect(s.get(s.id).schedule?.start).toBe('2026-11-20T15:00');
    expect(s.get(s.id).recurrence).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  it('skipping the current one moves the task on, keeping nothing in history', () => {
    const s = therapy();
    const before = s.ws.entities.tasks.length;
    s.ws = skipOccurrence(s.ctx, s.ws, s.id, '2026-11-06');
    expect(s.get(s.id)).toMatchObject({ status: 'open', schedule: { start: '2026-11-13T15:00' } });
    expect(s.ws.entities.tasks).toHaveLength(before);
    // The last one closes it as won't do.
    const last = therapy('FREQ=WEEKLY;COUNT=1');
    last.ws = skipOccurrence(last.ctx, last.ws, last.id, '2026-11-06');
    expect(last.get(last.id).status).toBe('wontdo');
  });

  it('changes one date on its own: a task of its own on that date, and the series skips it', () => {
    const s = therapy();
    const made = detachOccurrence(s.ctx, s.ws, s.id, '2026-11-13')!;
    s.ws = made.workspace;
    expect(made.task).toMatchObject({
      title: 'Therapy',
      recurrence: null,
      schedule: { start: '2026-11-13T15:00', end: '2026-11-13T16:00' },
      // Reminders before its time come along; one set for the 6th does not.
      reminders: [{ before: 30 }],
    });
    expect(s.get(s.id).recurrence).toBe('FREQ=WEEKLY;BYDAY=FR;X-PL-SKIP=20261113');
    expect(days(s.ws, 20)).toEqual([
      { date: '2026-11-06', titles: ['Therapy'] },
      { date: '2026-11-13', titles: ['Therapy'] },
      { date: '2026-11-20', titles: ['Therapy (to come)'] },
    ]);
  });
});
