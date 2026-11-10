import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { inboxList } from './lists.ts';
import { withNewTaskDefaults } from './newTaskDefaults.ts';
import {
  allDayParts,
  allDayReminder,
  allDayReminderTimeOf,
  atAllDayTime,
  reminderInstant,
  remindersBetween,
  remindsAllDay,
  remindsMe,
  snoozeReminder,
} from './reminders.ts';
import { updateSettings } from './settings.ts';
import { setAssignee } from './sharing.ts';
import { createTask, toggleTaskDone, updateTask } from './tasks.ts';
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

  it('come again every 5 minutes for 30 minutes when constant, under one tag', () => {
    const s = setup();
    const pills = s.add('Pills', { schedule: timed, reminders: [{ before: 0 }] });
    s.ws = updateTask(s.ctx, s.ws, pills.id, { constantReminder: true });
    const due = remindersBetween(s.ws, ME, at('2026-10-26T10:00'), at('2026-10-26T12:00'), TZ);
    expect(due).toHaveLength(6);
    expect(due[1]!.at - due[0]!.at).toBe(5 * 60_000);
    expect(new Set(due.map((each) => each.tag)).size).toBe(1);
    expect(new Set(due.map((each) => each.key)).size).toBe(6);
    expect(due.every((each) => each.constant)).toBe(true);
  });

  it("bring a server's snoozes back as reminders while the task is open and mine (audit B3)", () => {
    const s = setup();
    const pills = s.add('Pills', { schedule: timed, reminders: [{ before: 0 }] });
    const theirs = s.add('Theirs', { schedule: timed });
    s.ws = setAssignee(s.ctx, s.ws, theirs.id, `user:${SAM}`, true);
    const done = s.add('Done', { schedule: timed });
    s.ws = toggleTaskDone(s.ctx, s.ws, done.id);
    const snoozes = [
      { taskId: pills.id, at: at('2026-10-26T10:45') },
      // At a time the task already reminds at: that reminder, once.
      { taskId: pills.id, at: at('2026-10-26T10:30') },
      { taskId: theirs.id, at: at('2026-10-26T10:40') },
      { taskId: done.id, at: at('2026-10-26T10:40') },
      { taskId: 'gone', at: at('2026-10-26T10:40') },
    ];
    const due = remindersBetween(
      s.ws,
      ME,
      at('2026-10-26T10:00'),
      at('2026-10-26T12:00'),
      TZ,
      snoozes,
    );
    expect(due.map((each) => [each.title, each.at, each.key])).toEqual([
      ['Pills', at('2026-10-26T10:30'), `${pills.id}@${at('2026-10-26T10:30')}`],
      ['Pills', at('2026-10-26T10:45'), `${pills.id}@${at('2026-10-26T10:45')}`],
    ]);
    // A constant reminder's snooze repeats as the reminder does, under its own tag.
    s.ws = updateTask(s.ctx, s.ws, pills.id, { constantReminder: true, reminders: [] });
    const constant = remindersBetween(
      s.ws,
      ME,
      at('2026-10-26T10:00'),
      at('2026-10-26T12:00'),
      TZ,
      snoozes.slice(0, 1),
    );
    expect(constant).toHaveLength(6);
    expect(new Set(constant.map((each) => each.tag))).toEqual(
      new Set([`${pills.id}@${at('2026-10-26T10:45')}`]),
    );
  });
});

describe('all-day reminders at a time of day', () => {
  it('turn days early and a time into minutes from 9:00, and back, later that day too', () => {
    expect(allDayReminder(0, '09:00')).toEqual({ before: 0 });
    expect(allDayReminder(1, '09:00')).toEqual({ before: 1440 });
    expect(allDayReminder(0, '10:00')).toEqual({ before: -60 });
    expect(allDayReminder(2, '07:30')).toEqual({ before: 2880 + 90 });
    for (const [days, time] of [
      [0, '09:00'],
      [0, '23:59'],
      [0, '00:00'],
      [1, '18:45'],
      [7, '06:00'],
    ] as const) {
      const made = allDayReminder(days, time);
      expect('before' in made && allDayParts(made.before)).toEqual({ days, time });
    }
  });
});

describe("the person's time for all-day reminders (R-FB-83)", () => {
  it('moves new choices to it, while reminders keep counting from 9:00', () => {
    // "On the day" and "1 day early" at 7:30 instead of 9:00; five minutes early stays five.
    expect(atAllDayTime(0, '07:30')).toBe(90);
    expect(atAllDayTime(1440, '07:30')).toBe(1440 + 90);
    expect(atAllDayTime(5, '10:00')).toBe(-55);
    expect(atAllDayTime(1440, '09:00')).toBe(1440);
    expect(allDayParts(atAllDayTime(1440, '07:30'))).toEqual({ days: 1, time: '07:30' });
  });

  it('is 9:00 until the person picks another', () => {
    const s = setup();
    expect(allDayReminderTimeOf(s.ws)).toBe('09:00');
    s.ws = updateSettings(s.ctx, s.ws, { allDayReminderTime: '07:30' });
    expect(allDayReminderTimeOf(s.ws)).toBe('07:30');
  });

  it("give a new all-day task's default reminder that time", () => {
    const s = setup();
    s.ws = updateSettings(s.ctx, s.ws, {
      allDayReminderTime: '07:30',
      newTask: { date: 'today', reminders: [{ before: 0 }] },
    });
    const options = { today: '2026-10-26', timeZone: TZ, inList: false };
    const allDayTask = withNewTaskDefaults(s.ws, { listId: inboxList(s.ws).id }, options);
    expect(allDayTask.reminders).toEqual([{ before: 90 }]);
    s.ws = updateSettings(s.ctx, s.ws, {
      newTask: { date: 'today', time: '14:00', reminders: [{ before: 0 }] },
    });
    // A timed task keeps "on time".
    expect(withNewTaskDefaults(s.ws, { listId: inboxList(s.ws).id }, options).reminders).toEqual([
      { before: 0 },
    ]);
  });
});

describe('snoozing a reminder', () => {
  it('adds a set time and drops set times already past', () => {
    const s = setup();
    const task = s.add('Stretch', {
      schedule: timed,
      reminders: [{ before: 0 }, { at: '2026-10-26T09:00' }],
    });
    s.ws = snoozeReminder(s.ctx, s.ws, task.id, '2026-10-26T10:40', '2026-10-26T10:30');
    expect(s.ws.entities.tasks.find((each) => each.id === task.id)!.reminders).toEqual([
      { before: 0 },
      { at: '2026-10-26T10:40' },
    ]);
  });
});
