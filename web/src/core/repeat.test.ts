import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { inboxList } from './lists.ts';
import { createTask, setCompletedAt, setTaskStatus, toggleTaskDone, updateTask } from './tasks.ts';
import type { Task, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const TZ = 'America/Chicago';
// 2026-10-24 12:00 in Chicago.
const NOW = Date.parse('2026-10-24T17:00:00Z');

function setup() {
  const ctx = testContext('ben', NOW);
  let ws: WorkspaceFile = createWorkspace(ctx);
  const add = (
    title: string,
    extra: Partial<Parameters<typeof createTask>[2]>,
    recurrence: string,
  ) => {
    const made = createTask(ctx, ws, { title, listId: inboxList(ws).id, ...extra });
    ws = updateTask(ctx, made.workspace, made.task.id, { recurrence });
    return made.task.id;
  };
  const get = (id: string) => ws.entities.tasks.find((task) => task.id === id)!;
  return {
    ctx,
    add,
    get,
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const at = (start: string, end: string | null = null) => ({
  start,
  end,
  allDay: start.length === 10,
  timeZone: TZ,
});

describe('completing a repeating task', () => {
  it('keeps a done copy and moves the task to its next date, times and span kept', () => {
    const s = setup();
    const id = s.add(
      'Standup',
      {
        schedule: at('2026-10-23T09:00', '2026-10-23T09:15'),
        due: { at: '2026-10-23T10:00', allDay: false, timeZone: TZ },
      },
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    );
    s.ws = toggleTaskDone(s.ctx, s.ws, id);
    const task = s.get(id);
    expect(task.status).toBe('open');
    expect(task.schedule).toMatchObject({ start: '2026-10-26T09:00', end: '2026-10-26T09:15' });
    expect(task.due?.at).toBe('2026-10-26T10:00');
    expect(task.completedAt).toBeNull();
    const history = s.ws.entities.tasks.filter(
      (each) => each.title === 'Standup' && each.id !== id,
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'done', recurrence: null });
    expect(history[0]!.schedule?.start).toBe('2026-10-23T09:00');
  });

  it("reopens its subtasks, and won't do skips one the same way", () => {
    const s = setup();
    const id = s.add('Clean', { schedule: at('2026-10-24') }, 'FREQ=WEEKLY');
    const sub = createTask(s.ctx, s.ws, {
      title: 'Vacuum',
      listId: s.get(id).listId,
      parentId: id,
    });
    s.ws = toggleTaskDone(s.ctx, sub.workspace, sub.task.id);
    s.ws = setTaskStatus(s.ctx, s.ws, id, 'wontdo');
    expect(s.get(id).schedule?.start).toBe('2026-10-31');
    expect(s.get(sub.task.id).status).toBe('open');
    expect(s.ws.entities.tasks.filter((each: Task) => each.status === 'wontdo')).toHaveLength(1);
  });

  it('counts down and closes for good on its last time', () => {
    const s = setup();
    const id = s.add('Pills', { schedule: at('2026-10-24') }, 'FREQ=DAILY;COUNT=2');
    s.ws = toggleTaskDone(s.ctx, s.ws, id);
    expect(s.get(id)).toMatchObject({ status: 'open', recurrence: 'FREQ=DAILY;COUNT=1' });
    s.ws = toggleTaskDone(s.ctx, s.ws, id);
    expect(s.get(id).status).toBe('done');
  });

  it('counts from the day it was done when set to, including a chosen completion date', () => {
    const s = setup();
    const id = s.add(
      'Water',
      { schedule: at('2026-10-01') },
      'FREQ=DAILY;INTERVAL=3;X-PL-FROM=COMPLETION',
    );
    s.ws = toggleTaskDone(s.ctx, s.ws, id);
    expect(s.get(id).schedule?.start).toBe('2026-10-27');
    // Completed on a chosen day (the task menu): that day counts, and the copy carries it.
    s.ws = setCompletedAt(s.ctx, s.ws, id, '2026-10-30T15:00:00.000Z');
    expect(s.get(id).schedule?.start).toBe('2026-11-02');
    const copies = s.ws.entities.tasks.filter((each) => each.title === 'Water' && each.id !== id);
    expect(copies.map((each) => each.completedAt).sort()).toContain('2026-10-30T15:00:00.000Z');
  });

  it('does nothing special without a date or a rule', () => {
    const s = setup();
    const id = s.add('Loose', {}, 'FREQ=DAILY');
    s.ws = toggleTaskDone(s.ctx, s.ws, id);
    expect(s.get(id).status).toBe('done');
    expect(s.ws.entities.tasks.filter((each) => each.title === 'Loose')).toHaveLength(1);
  });
});
