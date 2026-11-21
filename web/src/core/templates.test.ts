import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { getEntity, isLive } from './collections.ts';
import { inboxList, createList } from './lists.ts';
import { members } from './ops.ts';
import { createTag, deleteTag } from './tags.ts';
import { createTask, MAX_SUBTASK_DEPTH, siblings, taskDepth, updateTask } from './tasks.ts';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  listBody,
  moveTemplate,
  renameTemplate,
  taskBody,
  taskCount,
  templateOfList,
  templateOfTask,
  templateFits,
  templatesByUse,
  templatesOf,
  fromListTemplate,
  fromTaskTemplate,
  blankTask,
} from './templates.ts';
import type { Template, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const ZONE = 'America/Chicago';
const MONDAY = '2026-11-23';

function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const tag = createTag(ctx, ws, 'home');
  ws = tag.workspace;
  // A task due Friday at 9:00, starting Thursday, with a timed reminder and two subtasks, one done.
  const pack = createTask(ctx, ws, {
    title: 'Pack for the trip',
    listId: inbox,
    notes: 'Passport!',
    priority: 2,
    schedule: { start: '2026-11-26', end: null, allDay: true, timeZone: ZONE },
    due: { at: '2026-11-27T09:00', allDay: false, timeZone: ZONE },
    tags: [tag.tag.id],
    reminders: [{ before: 30 }, { at: '2026-11-26T20:00' }],
    recurrence: 'FREQ=WEEKLY',
  });
  ws = updateTask(ctx, pack.workspace, pack.task.id, { constantReminder: true });
  const socks = createTask(ctx, ws, { title: 'Socks', listId: inbox, parentId: pack.task.id });
  ws = socks.workspace;
  const done = createTask(ctx, ws, { title: 'Bag', listId: inbox, parentId: pack.task.id });
  ws = updateTask(ctx, done.workspace, done.task.id, { status: 'done' });
  return { ctx, ws, inbox, tagId: tag.tag.id, packId: pack.task.id };
}

describe('saving a template (PL-140)', () => {
  it('keeps the task as it is now, its dates as days from today, and only its open subtasks', () => {
    const s = setup();
    const body = templateOfTask(s.ws, s.packId, MONDAY);
    expect(body).toEqual({
      title: 'Pack for the trip',
      notes: 'Passport!',
      priority: 2,
      tags: [s.tagId],
      start: { inDays: 3, time: null },
      end: null,
      due: { inDays: 4, time: '09:00' },
      reminders: [{ before: 30 }, { at: { inDays: 3, time: '20:00' } }],
      recurrence: 'FREQ=WEEKLY',
      constantReminder: true,
      subtasks: [expect.objectContaining({ title: 'Socks', subtasks: [] })],
    });
    const made = createTemplate(s.ctx, s.ws, { name: ' Trip ', kind: 'task', body });
    expect(made.template).toMatchObject({ name: 'Trip', kind: 'task', uses: 0 });
    // It is a template, not a task: views never see it.
    expect(made.workspace.entities.tasks).toHaveLength(s.ws.entities.tasks.length);
    expect(createAjvValidator().validate(made.workspace).errors).toEqual([]);
  });

  it('keeps a list: its look and its open tasks with their subtasks', () => {
    const s = setup();
    const list = createList(s.ctx, s.ws, { name: 'Camping', color: '#2e7d32', icon: 'tent' });
    let ws = createTask(s.ctx, list.workspace, { title: 'Tent', listId: list.list.id }).workspace;
    const closed = createTask(s.ctx, ws, { title: 'Old', listId: list.list.id });
    ws = updateTask(s.ctx, closed.workspace, closed.task.id, { status: 'done' });
    const body = templateOfList(ws, list.list.id, MONDAY);
    expect(body).toMatchObject({ name: 'Camping', color: '#2e7d32', icon: 'tent' });
    expect(body.tasks.map((task) => task.title)).toEqual(['Tent']);
  });
});

describe('using a template (PL-140)', () => {
  it('makes the task again, open, its dates counted from the day it is used', () => {
    const s = setup();
    const saved = createTemplate(s.ctx, s.ws, {
      name: 'Trip',
      kind: 'task',
      body: templateOfTask(s.ws, s.packId, MONDAY),
    });
    // Used two weeks later, from the calendar's day.
    const used = fromTaskTemplate(
      s.ctx,
      saved.workspace,
      saved.template.id,
      { listId: s.inbox },
      { day: '2026-12-07', timeZone: 'Europe/Berlin' },
    );
    const task = getEntity(used.workspace, 'tasks', used.taskId)!;
    expect(task).toMatchObject({
      title: 'Pack for the trip',
      notes: 'Passport!',
      priority: 2,
      status: 'open',
      recurrence: 'FREQ=WEEKLY',
      constantReminder: true,
      schedule: { start: '2026-12-10', end: null, allDay: true, timeZone: 'Europe/Berlin' },
      due: { at: '2026-12-11T09:00', allDay: false, timeZone: 'Europe/Berlin' },
      reminders: [{ before: 30 }, { at: '2026-12-10T20:00' }],
    });
    expect(members(task.tags)).toEqual([s.tagId]);
    expect(siblings(used.workspace, s.inbox, task.id).map((each) => each.title)).toEqual(['Socks']);
    // Counted, for most used first.
    expect(getEntity(used.workspace, 'templates', saved.template.id)!.uses).toBe(1);
    expect(createAjvValidator().validate(used.workspace).errors).toEqual([]);
  });

  it('takes the title typed in quick add, and skips a tag deleted since', () => {
    const s = setup();
    const saved = createTemplate(s.ctx, s.ws, {
      name: 'Trip',
      kind: 'task',
      body: templateOfTask(s.ws, s.packId, MONDAY),
    });
    const ws = deleteTag(s.ctx, saved.workspace, s.tagId);
    const used = fromTaskTemplate(
      s.ctx,
      ws,
      saved.template.id,
      { listId: s.inbox, title: 'Pack for Berlin' },
      { day: MONDAY, timeZone: ZONE },
    );
    const task = getEntity(used.workspace, 'tasks', used.taskId)!;
    expect(task.title).toBe('Pack for Berlin');
    expect(members(task.tags)).toEqual([]);
  });

  it('puts a template with no dates on the calendar day it was added to', () => {
    const s = setup();
    const plain = createTemplate(s.ctx, s.ws, {
      name: 'Call',
      kind: 'task',
      body: blankTask('Call'),
    });
    const day = { start: '2026-12-02', end: null, allDay: true, timeZone: ZONE };
    const used = fromTaskTemplate(
      s.ctx,
      plain.workspace,
      plain.template.id,
      { listId: s.inbox, schedule: day },
      { day: '2026-12-02', timeZone: ZONE },
    );
    expect(getEntity(used.workspace, 'tasks', used.taskId)!.schedule).toEqual(day);
    // Its own dates win over the day's.
    const dated = createTemplate(s.ctx, used.workspace, {
      name: 'Trip',
      kind: 'task',
      body: templateOfTask(s.ws, s.packId, MONDAY),
    });
    const trip = fromTaskTemplate(
      s.ctx,
      dated.workspace,
      dated.template.id,
      { listId: s.inbox, schedule: day },
      { day: '2026-12-02', timeZone: ZONE },
    );
    expect(getEntity(trip.workspace, 'tasks', trip.taskId)!.schedule?.start).toBe('2026-12-05');
  });

  it('moves the dates of an overdue task saved as a template to start on the day it is used', () => {
    const s = setup();
    // Saved the Monday after: started 4 days ago, due 3 days ago.
    const body = templateOfTask(s.ws, s.packId, '2026-11-30');
    expect(body.start).toEqual({ inDays: 0, time: null });
    expect(body.due).toEqual({ inDays: 1, time: '09:00' });
    expect(body.reminders).toEqual([{ before: 30 }, { at: { inDays: 0, time: '20:00' } }]);
  });

  it('makes a new private list from a list template', () => {
    const s = setup();
    const list = createList(s.ctx, s.ws, { name: 'Camping', color: '#2e7d32', icon: 'tent' });
    const tent = createTask(s.ctx, list.workspace, {
      title: 'Tent',
      listId: list.list.id,
      due: { at: '2026-11-24', allDay: true, timeZone: ZONE },
    });
    const ws = createTask(s.ctx, tent.workspace, {
      title: 'Pegs',
      listId: list.list.id,
      parentId: tent.task.id,
    }).workspace;
    const saved = createTemplate(s.ctx, ws, {
      name: 'Camping',
      kind: 'list',
      body: templateOfList(ws, list.list.id, MONDAY),
    });
    const used = fromListTemplate(s.ctx, saved.workspace, saved.template.id, 'Camping in May', {
      day: '2027-05-01',
      timeZone: ZONE,
    });
    const made = getEntity(used.workspace, 'lists', used.listId)!;
    expect(made).toMatchObject({
      name: 'Camping in May',
      color: '#2e7d32',
      icon: 'tent',
      visibility: 'private',
    });
    const top = siblings(used.workspace, used.listId, null);
    expect(top.map((task) => [task.title, task.due?.at])).toEqual([['Tent', '2027-05-02']]);
    expect(siblings(used.workspace, used.listId, top[0]!.id).map((task) => task.title)).toEqual([
      'Pegs',
    ]);
  });
});

describe('a template body from another device (PL-140)', () => {
  it('is read with care: bad fields are dropped, never trusted', () => {
    const s = setup();
    const made = createTemplate(s.ctx, s.ws, { name: 'Odd', kind: 'task', body: blankTask('x') });
    const odd: Template = {
      ...made.template,
      body: {
        title: 42,
        priority: 9,
        tags: ['T1', 5],
        due: { inDays: 'soon', time: '9am' },
        start: { inDays: 2, time: '25:99x' },
        reminders: [{ before: 'x' }, { at: { inDays: 1, time: '08:00' } }],
        subtasks: 'none',
      },
    };
    expect(taskBody(odd)).toEqual({
      title: '',
      notes: '',
      priority: 0,
      tags: ['T1'],
      start: { inDays: 2, time: null },
      end: null,
      due: null,
      reminders: [{ at: { inDays: 1, time: '08:00' } }],
      recurrence: null,
      constantReminder: false,
      subtasks: [],
    });
    expect(listBody(odd)).toBeNull();
  });

  it('keeps only what a task may hold: real times, reminders in range and at most 10, an end after its start', () => {
    const s = setup();
    const made = createTemplate(s.ctx, s.ws, { name: 'Odd', kind: 'task', body: blankTask('x') });
    const odd: Template = {
      ...made.template,
      body: {
        title: 'Odd',
        start: { inDays: 3, time: '99:99' },
        end: { inDays: 1, time: null },
        due: { inDays: 4, time: '24:00' },
        reminders: [
          { before: 999999 },
          { before: -1440 },
          { before: -1439 },
          ...Array.from({ length: 12 }, (_, at) => ({ before: at })),
        ],
      },
    };
    const body = taskBody(odd)!;
    expect(body.start).toEqual({ inDays: 3, time: null });
    expect(body.end).toBeNull();
    expect(body.due).toEqual({ inDays: 4, time: null });
    expect(body.reminders).toEqual([
      { before: -1439 },
      ...Array.from({ length: 9 }, (_, at) => ({ before: at })),
    ]);
    const kept = taskBody({
      ...odd,
      body: { start: { inDays: 1, time: '09:00' }, end: { inDays: 1, time: '10:30' } },
    })!;
    expect(kept.end).toEqual({ inDays: 1, time: '10:30' });
    // What it makes, the server takes.
    const ws = {
      ...made.workspace,
      entities: { ...made.workspace.entities, templates: [odd] },
    };
    const used = fromTaskTemplate(
      s.ctx,
      ws,
      odd.id,
      { listId: s.inbox },
      { day: MONDAY, timeZone: ZONE },
    );
    expect(createAjvValidator().validate(used.workspace).errors).toEqual([]);
  });

  it('makes a task only from what a template keeps: a crafted list, assignees or rule are ignored', () => {
    const s = setup();
    const made = createTemplate(s.ctx, s.ws, {
      name: 'Crafted',
      kind: 'task',
      body: blankTask('x'),
    });
    const crafted: Template = {
      ...made.template,
      body: {
        title: 'Crafted',
        listId: 'L-someone-else',
        parentId: 'T-someone-else',
        assignees: ['user:mallory'],
        attachments: [{ id: 'A1', name: 'x.exe' }],
        recurrence: 'NOT A RULE',
        tags: [s.tagId, 'TAG-unknown'],
      },
    };
    const ws = {
      ...made.workspace,
      entities: { ...made.workspace.entities, templates: [crafted] },
    };
    const used = fromTaskTemplate(
      s.ctx,
      ws,
      crafted.id,
      { listId: s.inbox },
      { day: MONDAY, timeZone: ZONE },
    );
    const task = getEntity(used.workspace, 'tasks', used.taskId)!;
    expect(task.listId).toBe(s.inbox);
    expect(task.parentId ?? null).toBeNull();
    expect(members(task.assignees)).toEqual([]);
    expect(task.recurrence).toBeNull();
    expect(members(task.tags)).toEqual([s.tagId]);
    expect(used.workspace.entities.attachments).toEqual(ws.entities.attachments);
    expect(createAjvValidator().validate(used.workspace).errors).toEqual([]);
  });

  it('is never bigger than the server takes', () => {
    const s = setup();
    const long = { ...blankTask('Long'), notes: 'x'.repeat(20000) };
    const body = { ...blankTask('Big'), subtasks: Array.from({ length: 11 }, () => long) };
    expect(templateFits(body)).toBe(false);
    expect(() => createTemplate(s.ctx, s.ws, { name: 'Big', kind: 'task', body })).toThrow(
      'template too large',
    );
    expect(templateFits({ ...body, subtasks: body.subtasks.slice(0, 9) })).toBe(true);
  });

  it('makes at most 200 tasks however deep it goes', () => {
    const s = setup();
    let deep = blankTask('leaf');
    for (let i = 0; i < 300; i++)
      deep = { ...blankTask(`t${i}`), subtasks: [deep, blankTask('side')] };
    const made = createTemplate(s.ctx, s.ws, { name: 'Huge', kind: 'task', body: deep });
    expect(taskCount(made.template)).toBeLessThan(200);
    // Used, it nests no deeper than subtasks can.
    const used = fromTaskTemplate(
      s.ctx,
      made.workspace,
      made.template.id,
      { listId: s.inbox },
      { day: MONDAY, timeZone: ZONE },
    );
    const depths = used.workspace.entities.tasks.map((task) => taskDepth(used.workspace, task.id));
    expect(Math.max(...depths)).toBe(MAX_SUBTASK_DEPTH);
  });
});

describe('keeping templates (PL-140)', () => {
  it('orders, renames, duplicates and deletes them, and the picker puts the most used first', () => {
    const s = setup();
    let ws = s.ws;
    const ids: string[] = [];
    for (const name of ['A', 'B', 'C']) {
      const made = createTemplate(s.ctx, ws, { name, kind: 'task', body: blankTask(name) });
      ws = made.workspace;
      ids.push(made.template.id);
    }
    ws = moveTemplate(s.ctx, ws, ids[2]!, null);
    expect(templatesOf(ws).map((each) => each.name)).toEqual(['C', 'A', 'B']);
    ws = renameTemplate(s.ctx, ws, ids[0]!, '  Alpha ');
    ws = renameTemplate(s.ctx, ws, ids[0]!, '   ');
    const copy = duplicateTemplate(s.ctx, ws, ids[0]!, 'Alpha (copy)');
    ws = copy.workspace;
    expect(templatesOf(ws).map((each) => each.name)).toEqual(['C', 'Alpha', 'Alpha (copy)', 'B']);
    ws = fromTaskTemplate(
      s.ctx,
      ws,
      ids[1]!,
      { listId: s.inbox },
      { day: MONDAY, timeZone: ZONE },
    ).workspace;
    expect(templatesByUse(ws, 'task').map((each) => each.name)[0]).toBe('B');
    ws = deleteTemplate(s.ctx, ws, ids[1]!);
    expect(templatesOf(ws).map((each) => each.name)).toEqual(['C', 'Alpha', 'Alpha (copy)']);
    expect(isLive(getEntity(ws, 'templates', ids[1]!)!)).toBe(false);
    expect(templatesOf(ws, 'list')).toEqual([]);
  });
});
