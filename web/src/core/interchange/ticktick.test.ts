import { describe, expect, it } from 'vitest';
import { testContext } from '../../test/fixtures.ts';
import { inboxList } from '../lists.ts';
import { members } from '../ops.ts';
import { createWorkspace } from '../workspace.ts';
import { applyImport, planSummary } from './apply.ts';
import { parseCsv } from './csv.ts';
import {
  durationMinutes,
  exportTickTick,
  parseTickTick,
  reminderFrom,
  reminderTo,
} from './ticktick.ts';

// A made-up backup in TickTick's shape: its preamble, header, and a few rows.
const HEADER =
  '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status","Created Time","Completed Time","Order","Timezone","Is All Day","Is Floating","Column Name","Column Order","View Mode","taskId","parentId","projectKind"';
const row = (fields: string[]) => fields.map((field) => `"${field.replace(/"/g, '""')}"`).join(',');
const SAMPLE = [
  '"Date: 2026-10-25+0000"',
  '"Version: 7.2"',
  '"Status: \n0 Normal\n-1 Abandoned \n2 Completed"',
  HEADER,
  row([
    '',
    'Garden',
    'Plant bulbs',
    'TEXT',
    'yard,fall',
    'Tulips, deep',
    'N',
    '2026-11-04T06:00:00+0000',
    '2026-11-04T06:00:00+0000',
    'P0DT9H0M0S\n-P0DT15H0M0S',
    'FREQ=YEARLY;INTERVAL=1;BYMONTH=11;BYMONTHDAY=4',
    '5',
    '0',
    '2026-10-01T12:00:00+0000',
    '',
    '-2000',
    'America/Chicago',
    'true',
    'false',
    '',
    '',
    'list',
    '1',
    '',
    'TASK',
  ]),
  row([
    '',
    'Garden',
    'Buy mulch',
    'TEXT',
    '',
    '',
    'N',
    '2026-11-02T20:30:00+0000',
    '2026-11-02T21:30:00+0000',
    '-PT15M',
    '',
    '3',
    '2',
    '2026-10-01T12:00:00+0000',
    '2026-11-02T22:00:00+0000',
    '-3000',
    'America/Chicago',
    'false',
    'false',
    '',
    '',
    'list',
    '2',
    '',
    'TASK',
  ]),
  row([
    '',
    'Garden',
    'Rake leaves',
    'TEXT',
    '',
    '',
    'N',
    '',
    '',
    '',
    '',
    '1',
    '-1',
    '2026-10-01T12:00:00+0000',
    '2026-10-20T12:00:00+0000',
    '-1000',
    'America/Chicago',
    'false',
    'false',
    '',
    '',
    'list',
    '3',
    '1',
    'TASK',
  ]),
  row([
    '',
    'Inbox',
    'Pack for trip',
    'CHECKLIST',
    '',
    'For the cabin▪Boots▫Gloves',
    'Y',
    '',
    '',
    '',
    '',
    '0',
    '0',
    '2026-10-01T12:00:00+0000',
    '',
    '0',
    'America/Chicago',
    'false',
    'false',
    '',
    '',
    'list',
    '4',
    '',
    'TASK',
  ]),
].join('\n');

describe('TickTick reminders', () => {
  it('read ISO durations: timed before the time, all day from that midnight', () => {
    expect(durationMinutes('-P0DT15H0M0S')).toBe(-900);
    expect(durationMinutes('-PT5M')).toBe(-5);
    expect(durationMinutes('PT0S')).toBe(0);
    expect(reminderFrom('-PT15M', false)).toEqual({ before: 15 });
    expect(reminderFrom('P0DT9H0M0S', true)).toEqual({ before: 0 });
    expect(reminderFrom('-P0DT15H0M0S', true)).toEqual({ before: 1440 });
    expect(reminderFrom('P0DT10H0M0S', true)).toEqual({ before: -60 });
    expect(reminderFrom('nonsense', true)).toBeNull();
  });

  it('read the odd forms TickTick also writes: trigger parameters, days twice', () => {
    expect(durationMinutes(';RELATED=START:-PT5M')).toBe(-5);
    expect(durationMinutes('TRIGGER;RELATED=START:P0DT9H0M0S')).toBe(540);
    expect(durationMinutes('-P14D5DT15H0M0S')).toBe(-(19 * 1440 + 900));
    expect(durationMinutes('-P28D0DT0H0M0S')).toBe(-28 * 1440);
  });

  it('one after a timed task becomes a set time, and goes back out as after', () => {
    const lines = SAMPLE.split('\n');
    const timed = lines.findIndex((line) => line.includes('Buy mulch'));
    lines[timed] = lines[timed]!.replace('"-PT15M"', '"P0DT12H0M0S"');
    const plan = parseTickTick(lines.join('\n'), { timeZone: 'UTC' });
    const mulch = plan.tasks.find((each) => each.title === 'Buy mulch')!;
    // 14:30 Chicago, twelve hours on.
    expect(mulch.reminders).toEqual([{ at: '2026-11-03T02:30' }]);
    expect(plan.notes.reminderDropped).toBeUndefined();
    const ctx = testContext();
    const ws = applyImport(ctx, createWorkspace(ctx), plan, { intoSameNamed: true }).workspace;
    const again = parseTickTick(exportTickTick(ws), { timeZone: 'UTC' });
    expect(again.tasks.find((each) => each.title === 'Buy mulch')!.reminders).toEqual([
      { at: '2026-11-03T02:30' },
    ]);
  });

  it('round-trip', () => {
    for (const [reminder, allDay] of [
      [{ before: 0 }, true],
      [{ before: 1440 }, true],
      [{ before: -60 }, true],
      [{ before: 30 }, false],
      [{ before: 0 }, false],
      [{ before: 2880 }, false],
    ] as const) {
      expect(reminderFrom(reminderTo(reminder, allDay)!, allDay)).toEqual(reminder);
    }
  });
});

describe('reading a TickTick backup', () => {
  const plan = parseTickTick(SAMPLE, { timeZone: 'UTC' });
  const task = (title: string) => plan.tasks.find((each) => each.title === title)!;

  it("takes lists (Inbox as the Mess Drawer), dates in the task's own zone, priority and status", () => {
    expect(plan.lists.map((list) => [list.name, list.inbox])).toEqual([
      ['Garden', false],
      ['Inbox', true],
    ]);
    expect(task('Plant bulbs').schedule).toEqual({
      start: '2026-11-04',
      end: null,
      allDay: true,
      timeZone: 'America/Chicago',
    });
    expect(task('Buy mulch').schedule).toEqual({
      start: '2026-11-02T14:30',
      end: '2026-11-02T15:30',
      allDay: false,
      timeZone: 'America/Chicago',
    });
    expect([
      task('Plant bulbs').priority,
      task('Buy mulch').priority,
      task('Rake leaves').priority,
    ]).toEqual([3, 2, 1]);
    expect([
      task('Plant bulbs').status,
      task('Buy mulch').status,
      task('Rake leaves').status,
    ]).toEqual(['open', 'done', 'wontdo']);
    expect(task('Buy mulch').completedAt).toBe('2026-11-02T22:00:00.000Z');
  });

  it("takes reminders, repeats, tags, notes and subtasks; a checklist's items become subtasks", () => {
    expect(task('Plant bulbs').reminders).toEqual([{ before: 0 }, { before: 1440 }]);
    expect(task('Buy mulch').reminders).toEqual([{ before: 15 }]);
    expect(task('Plant bulbs').recurrence).toBe('FREQ=YEARLY;INTERVAL=1;BYMONTH=11;BYMONTHDAY=4');
    expect(task('Plant bulbs').tags).toEqual(['yard', 'fall']);
    expect(task('Plant bulbs').notes).toBe('Tulips, deep');
    expect(task('Rake leaves').parentKey).toBe('1');
    expect(task('Pack for trip').notes).toBe('For the cabin');
    expect(task('Boots')).toMatchObject({ parentKey: '4', status: 'done' });
    expect(task('Gloves')).toMatchObject({ parentKey: '4', status: 'open' });
    // Garden's own order: smaller first.
    expect(
      plan.tasks
        .filter((each) => each.listKey === 'Garden' && !each.parentKey)
        .map((each) => each.title),
    ).toEqual(['Buy mulch', 'Plant bulbs']);
    expect(planSummary(plan)).toMatchObject({ lists: 2, open: 3, closed: 3, tags: 2 });
  });

  it('lands in the workspace as one: lists, tags, subtasks, closed ones closed', () => {
    const ctx = testContext();
    const outcome = applyImport(ctx, createWorkspace(ctx), plan, { intoSameNamed: true });
    const ws = outcome.workspace;
    expect([outcome.lists, outcome.tasks, outcome.tags]).toEqual([1, 6, 2]);
    const made = (title: string) => ws.entities.tasks.find((each) => each.title === title)!;
    expect(made('Pack for trip').listId).toBe(inboxList(ws).id);
    expect(made('Rake leaves').parentId).toBe(made('Plant bulbs').id);
    expect(made('Buy mulch').status).toBe('done');
    expect(made('Rake leaves').status).toBe('wontdo');
    expect(made('Plant bulbs').recurrence).toContain('FREQ=YEARLY');
    const names = new Map(ws.entities.tags.map((tag) => [tag.id, tag.name]));
    expect(members(made('Plant bulbs').tags).map((id) => names.get(id))).toEqual(['yard', 'fall']);
  });
});

describe('writing a TickTick backup', () => {
  it('reads back as it was written', () => {
    const ctx = testContext();
    const first = applyImport(
      ctx,
      createWorkspace(ctx),
      parseTickTick(SAMPLE, { timeZone: 'UTC' }),
      {
        intoSameNamed: true,
      },
    ).workspace;
    const text = exportTickTick(first, { now: new Date('2026-10-25T00:00:00Z') });
    expect(parseCsv(text)[3]).toHaveLength(25);
    const again = parseTickTick(text, { timeZone: 'UTC' });
    const pick = (title: string) => again.tasks.find((each) => each.title === title)!;
    expect(pick('Plant bulbs')).toMatchObject({
      schedule: { start: '2026-11-04', allDay: true, timeZone: 'America/Chicago' },
      reminders: [{ before: 0 }, { before: 1440 }],
      priority: 3,
      tags: ['yard', 'fall'],
    });
    expect(pick('Buy mulch')).toMatchObject({
      status: 'done',
      schedule: { start: '2026-11-02T14:30', end: '2026-11-02T15:30' },
    });
    expect(pick('Boots').parentKey).toBe(pick('Pack for trip').key);
    expect(again.lists.find((list) => list.name === 'Inbox')?.inbox).toBe(true);
  });
});
