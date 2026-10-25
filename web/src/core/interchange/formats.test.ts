import { describe, expect, it } from 'vitest';
import { createChronoDateParser } from '../../adapters/chrono-date-parser.ts';
import { testContext } from '../../test/fixtures.ts';
import { members } from '../ops.ts';
import { createWorkspace } from '../workspace.ts';
import { createList, inboxList } from '../lists.ts';
import { createTag } from '../tags.ts';
import { createTask } from '../tasks.ts';
import { applyImport, planSummary, replaceable } from './apply.ts';
import { parseCsv, toCsv } from './csv.ts';
import { dateReader, ruleWords, scheduleWords } from './dateText.ts';
import { parseGoogleTasks } from './googleTasks.ts';
import { exportIcal, parseIcal } from './ical.ts';
import type { ImportPlan } from './model.ts';
import { exportOutlook, parseOutlook } from './outlook.ts';
import { exportThings, THINGS_BATCH, thingsUrl } from './things.ts';
import { exportTodoist, parseTodoist, projectName } from './todoist.ts';
import { isZip, readZip, streamOf, writeZip } from './zip.ts';

const ZONE = 'America/Chicago';
// A Sunday, so "every monday" is the next day.
const REFERENCE = new Date('2026-10-25T15:00:00Z');

function landed(plan: ImportPlan) {
  const ctx = testContext();
  const ws = applyImport(ctx, createWorkspace(ctx), plan, { intoSameNamed: true }).workspace;
  const names = new Map(ws.entities.tags.map((tag) => [tag.id, tag.name]));
  const task = (title: string) => ws.entities.tasks.find((each) => each.title === title)!;
  const tagsOf = (title: string) =>
    members(task(title).tags)
      .map((id) => names.get(id))
      .sort();
  return { ctx, ws, task, tagsOf };
}

const reader = () => {
  const ctx = testContext();
  return dateReader({
    workspace: createWorkspace(ctx),
    parser: createChronoDateParser(),
    reference: REFERENCE,
    timeZone: ZONE,
  });
};

describe('dates as words', () => {
  it('reads the dates and repeats Todoist writes, and writes ours back as it reads them', () => {
    const read = reader();
    expect(read('2026-11-04')).toEqual({
      schedule: { start: '2026-11-04', end: null, allDay: true, timeZone: ZONE },
      recurrence: null,
    });
    expect(read('Nov 4 2026 at 14:30')?.schedule?.start).toBe('2026-11-04T14:30');
    const weekly = read('every monday at 9am');
    expect(weekly?.recurrence).toContain('FREQ=WEEKLY');
    expect(weekly?.schedule?.start).toBe('2026-10-26T09:00');
    expect(read('every! 3 days')?.recurrence).toContain('X-PL-FROM=COMPLETION');
    expect(ruleWords({ freq: 'DAILY', interval: 3, fromCompletion: true })).toBe('every! 3 days');
    expect(read('every monday starting Nov 9 2026')?.schedule?.start).toBe('2026-11-09');
    expect(read('whenever')).toBeNull();
    // Out and back.
    const out = scheduleWords(
      { start: '2026-11-09T14:30', end: null, allDay: false, timeZone: ZONE },
      'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    );
    expect(out).toBe('every monday at 14:30 starting Nov 9 2026');
    expect(read(out)).toMatchObject({
      schedule: { start: '2026-11-09T14:30', allDay: false },
      recurrence: expect.stringContaining('BYDAY=MO'),
    });
  });
});

describe('Todoist', () => {
  const header =
    'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG';
  const file = [
    header,
    'task,Plant bulbs @yard @fall,Tulips,1,1,,,2026-11-04,en,,,,,',
    'note,Deep enough this time,,,,,,,,,,,,',
    'task,Dig holes,,4,2,,,,,,,,,',
    'task,Buy compost,,4,3,,,,,,,,,',
    'section,Later,,,,,,,,,,,,',
    'task,Rake leaves,,3,1,,,every monday at 9am,en,,30,minute,Nov 30 2026,en',
    'task,Mystery,,2,1,,,someday maybe,en,,,,,',
  ].join('\n');

  it('takes projects by file name, labels as tags, nesting, notes as notes, dates and repeats', () => {
    expect(projectName('backup/Garden [2203306141].csv')).toBe('Garden');
    const plan = parseTodoist([{ name: 'Garden.csv', text: file }], { readDate: reader() });
    expect(plan.notes).toMatchObject({ commentsAsNotes: 1, sectionsDropped: 1, dateUnread: 1 });
    const { task, tagsOf } = landed(plan);
    expect(task('Plant bulbs')).toMatchObject({
      priority: 3,
      notes: 'Tulips\n\nDeep enough this time',
      schedule: { start: '2026-11-04', allDay: true },
    });
    expect(tagsOf('Plant bulbs')).toEqual(['fall', 'yard']);
    expect(task('Dig holes').parentId).toBe(task('Plant bulbs').id);
    expect(task('Buy compost').parentId).toBe(task('Dig holes').id);
    expect(task('Rake leaves')).toMatchObject({
      parentId: null,
      priority: 1,
      schedule: { start: '2026-10-26T09:00', end: '2026-10-26T09:30' },
      due: { at: '2026-11-30' },
    });
    expect(task('Rake leaves').recurrence).toContain('BYDAY=MO');
    expect(task('Mystery').priority).toBe(2);
  });

  it('writes a project file Todoist reads, and it reads back the same', () => {
    const { ws } = landed(
      parseTodoist([{ name: 'Garden.csv', text: file }], { readDate: reader() }),
    );
    const files = exportTodoist(ws);
    expect(files.map((each) => each.name)).toEqual(['Garden.csv']);
    const rows = parseCsv(files[0]!.text);
    expect(rows[0]).toEqual(header.split(','));
    expect(rows[1]!.slice(0, 5)).toEqual([
      'task',
      'Plant bulbs @yard @fall',
      'Tulips\n\nDeep enough this time',
      '1',
      '1',
    ]);
    const again = landed(parseTodoist(files, { readDate: reader() }));
    expect(again.task('Buy compost').parentId).toBe(again.task('Dig holes').id);
    expect(again.tagsOf('Plant bulbs')).toEqual(['fall', 'yard']);
    expect(again.task('Rake leaves')).toMatchObject({
      schedule: { start: '2026-10-26T09:00', end: '2026-10-26T09:30' },
      due: { at: '2026-11-30' },
    });
    expect(again.task('Rake leaves').recurrence).toContain('BYDAY=MO');
  });
});

describe('Google Tasks', () => {
  it('takes Takeout lists, in position order, with subtasks, due days and done ones', () => {
    const takeout = JSON.stringify({
      kind: 'tasks#taskLists',
      items: [
        {
          kind: 'tasks#taskList',
          id: 'L1',
          title: 'Errands',
          items: [
            {
              kind: 'tasks#task',
              id: 'b',
              title: 'Second',
              position: '00000000000000000002',
              status: 'needsAction',
              due: '2026-11-04T00:00:00.000Z',
            },
            {
              kind: 'tasks#task',
              id: 'a',
              title: 'First',
              position: '00000000000000000001',
              status: 'completed',
              completed: '2026-10-20T12:00:00.000Z',
              notes: 'Done early',
            },
            {
              kind: 'tasks#task',
              id: 'c',
              title: 'Under second',
              parent: 'b',
              position: '00000000000000000000',
              status: 'needsAction',
            },
            { kind: 'tasks#task', id: 'd', title: 'Gone', deleted: true, status: 'needsAction' },
          ],
        },
      ],
    });
    const plan = parseGoogleTasks(takeout, { timeZone: ZONE });
    expect(plan.tasks.filter((each) => !each.parentKey).map((each) => each.title)).toEqual([
      'First',
      'Second',
    ]);
    const { task, ws } = landed(plan);
    expect(ws.entities.lists.some((list) => list.name === 'Errands')).toBe(true);
    expect(task('First')).toMatchObject({
      status: 'done',
      notes: 'Done early',
      completedAt: '2026-10-20T12:00:00.000Z',
    });
    expect(task('Second').schedule).toMatchObject({ start: '2026-11-04', allDay: true });
    expect(task('Under second').parentId).toBe(task('Second').id);
    expect(ws.entities.tasks.some((each) => each.title === 'Gone')).toBe(false);
  });
});

describe('Microsoft To Do through Outlook', () => {
  const header =
    '"Subject","Start Date","Due Date","Reminder On/Off","Reminder Date","Reminder Time","Date Completed","% Complete","Total Work","Actual Work","Billing Information","Categories","Companies","Contacts","Mileage","Notes","Priority","Private","Role","Schedule+ Priority","Sensitivity","Status"';
  it('reads US dates, reminders, categories, priority and status', () => {
    const text = [
      header,
      '"Call plumber","11/4/2026","11/6/2026","True","11/4/2026","2:30:00 PM","","0%","","","","Home;Calls","","","","Ask about the valve","High","False","","","Normal","Not Started"',
      '"Pay rent","","10/1/2026","False","","","10/1/2026","100%","","","","","","","","","Normal","False","","","Normal","Completed"',
    ].join('\r\n');
    const { task, tagsOf } = landed(parseOutlook({ name: 'Tasks.csv', text }, { timeZone: ZONE }));
    expect(task('Call plumber')).toMatchObject({
      priority: 3,
      notes: 'Ask about the valve',
      schedule: { start: '2026-11-04', allDay: true },
      due: { at: '2026-11-06' },
      reminders: [{ at: '2026-11-04T14:30' }],
    });
    // Tag names are kept lowercase.
    expect(tagsOf('Call plumber')).toEqual(['calls', 'home']);
    expect(task('Pay rent')).toMatchObject({ status: 'done', schedule: { start: '2026-10-01' } });
  });

  it('sees a day-first file, and writes one Outlook reads back the same', () => {
    const text = [
      header,
      '"Late","","25/11/2026","False","","","","0%","","","","","","","","","Low","False","","","Normal","Not Started"',
    ].join('\n');
    const { ws, task } = landed(parseOutlook({ name: 'Tasks.csv', text }, { timeZone: ZONE }));
    expect(task('Late')).toMatchObject({ priority: 1, schedule: { start: '2026-11-25' } });
    const files = exportOutlook(ws);
    expect(parseCsv(files[0]!.text)[1]!.slice(0, 3)).toEqual(['Late', '11/25/2026', '11/25/2026']);
    const again = landed(parseOutlook(files[0]!, { timeZone: ZONE }));
    expect(again.task('Late')).toMatchObject({ priority: 1, schedule: { start: '2026-11-25' } });
  });
});

describe('iCalendar tasks', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:House',
    'BEGIN:VTODO',
    'UID:p1',
    'SUMMARY:Fix the gate\\, again',
    'DESCRIPTION:Hinge is loose.\\nBring screws.',
    'DTSTART;TZID=America/Chicago:20261104T143000',
    'DURATION:PT45M',
    'PRIORITY:1',
    'CATEGORIES:yard,tools',
    'RRULE:FREQ=WEEKLY;BYDAY=WE',
    'STATUS:NEEDS-ACTION',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VTODO',
    'BEGIN:VTODO',
    'UID:c1',
    'SUMMARY:Buy screws',
    'RELATED-TO;RELTYPE=PARENT:p1',
    'DUE;VALUE=DATE:20261103',
    'STATUS:COMPLETED',
    'COMPLETED:20261103T180000Z',
    'BEGIN:VALARM',
    'TRIGGER;RELATED=END:-P1D',
    'END:VALARM',
    'END:VTODO',
    'BEGIN:VTODO',
    'UID:x1',
    'SUMMARY:Skip the party',
    'STATUS:CANCELLED',
    'PRIORITY:9',
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');

  it('takes the calendar as a list, and its tasks with times, repeats, alarms and parents', () => {
    const { task, tagsOf } = landed(
      parseIcal([{ name: 'house.ics', text: ics }], { timeZone: ZONE }),
    );
    expect(task('Fix the gate, again')).toMatchObject({
      notes: 'Hinge is loose.\nBring screws.',
      priority: 3,
      schedule: { start: '2026-11-04T14:30', end: '2026-11-04T15:15', timeZone: ZONE },
      reminders: [{ before: 15 }],
    });
    expect(task('Fix the gate, again').recurrence).toContain('BYDAY=WE');
    expect(tagsOf('Fix the gate, again')).toEqual(['tools', 'yard']);
    expect(task('Buy screws')).toMatchObject({
      status: 'done',
      completedAt: '2026-11-03T18:00:00.000Z',
      schedule: { start: '2026-11-03', allDay: true },
      // A day before the day's midnight: 33 hours before its 9:00.
      reminders: [{ before: 1980 }],
    });
    expect(task('Buy screws').parentId).toBe(task('Fix the gate, again').id);
    expect(task('Skip the party')).toMatchObject({ status: 'wontdo', priority: 1 });
  });

  it('writes a calendar of VTODOs that reads back the same', () => {
    const { ws } = landed(parseIcal([{ name: 'house.ics', text: ics }], { timeZone: ZONE }));
    const files = exportIcal(ws, null, { now: REFERENCE });
    expect(files.map((each) => each.name)).toEqual(['House.ics']);
    expect(files[0]!.text).toContain('SUMMARY:Fix the gate\\, again');
    expect(
      files[0]!.text.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
    const again = landed(parseIcal(files, { timeZone: ZONE }));
    expect(again.task('Fix the gate, again')).toMatchObject({
      priority: 3,
      schedule: { start: '2026-11-04T14:30', end: '2026-11-04T15:15' },
      reminders: [{ before: 15 }],
    });
    expect(again.task('Buy screws')).toMatchObject({
      status: 'done',
      reminders: [{ before: 1980 }],
    });
    expect(again.task('Buy screws').parentId).toBe(again.task('Fix the gate, again').id);
    expect(again.tagsOf('Fix the gate, again')).toEqual(['tools', 'yard']);
  });
});

describe('Things', () => {
  it('makes projects first, then open to-dos with their dates, tags and checklist', () => {
    const { ws } = landed(
      parseIcal(
        [
          {
            name: 'h.ics',
            text: [
              'BEGIN:VCALENDAR',
              'X-WR-CALNAME:House',
              'BEGIN:VTODO',
              'UID:p',
              'SUMMARY:Gate',
              'DTSTART:20261104T203000Z',
              'CATEGORIES:yard',
              'PRIORITY:1',
              'RRULE:FREQ=DAILY',
              'END:VTODO',
              'BEGIN:VTODO',
              'UID:c',
              'SUMMARY:Screws',
              'RELATED-TO:p',
              'END:VTODO',
              'BEGIN:VTODO',
              'UID:d',
              'SUMMARY:Done one',
              'STATUS:COMPLETED',
              'END:VTODO',
              'END:VCALENDAR',
            ].join('\r\n'),
          },
        ],
        { timeZone: ZONE },
      ),
    );
    const out = exportThings(ws);
    expect(out.batches[0]).toEqual([{ type: 'project', attributes: { title: 'House' } }]);
    expect(out.batches[1]).toEqual([
      {
        type: 'to-do',
        attributes: {
          title: 'Gate',
          list: 'House',
          when: '2026-11-04@14:30',
          tags: ['yard'],
          'checklist-items': [{ type: 'checklist-item', attributes: { title: 'Screws' } }],
        },
      },
    ]);
    expect([out.repeatsDropped, out.prioritiesDropped]).toEqual([1, 1]);
    expect(thingsUrl(out.batches[0]!)).toMatch(/^things:\/\/\/json\?data=%5B/);
    expect(THINGS_BATCH).toBe(250);
  });
});

describe('zip archives', () => {
  it('reads back what it writes, and reads deflated entries', async () => {
    const files = [
      { name: 'Garden.csv', text: toCsv([['a', 'b']]) },
      { name: 'Café ✓.ics', text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' },
    ];
    const bytes = writeZip(files);
    expect(isZip(bytes)).toBe(true);
    const read = await readZip(bytes);
    expect(read.map((each) => [each.name, new TextDecoder().decode(each.bytes)])).toEqual(
      files.map((each) => [each.name, each.text]),
    );
    // A deflated entry, as zip tools write them.
    const text = 'hello hello hello hello';
    const deflated = new Uint8Array(
      await new Response(
        streamOf(new TextEncoder().encode(text)).pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );
    const stored = writeZip([{ name: 'x.txt', text: 'x'.repeat(deflated.length) }]);
    const view = new DataView(stored.buffer);
    // Swap the stored data for the deflated bytes and mark it deflated (method 8).
    stored.set(deflated, 30 + 5);
    view.setUint16(8, 8, true);
    const central = 30 + 5 + deflated.length;
    view.setUint16(central + 10, 8, true);
    const [entry] = await readZip(stored);
    expect(new TextDecoder().decode(entry!.bytes)).toBe(text);
  });
});

describe('merging or replacing', () => {
  const plan = (): ImportPlan => ({
    source: 'googleTasks',
    lists: [{ key: 'g', name: 'Garden' }],
    tasks: [
      { key: 't', listKey: 'g', title: 'New one', status: 'open', priority: 0, tags: ['yard'] },
    ],
    notes: {},
  });
  const current = () => {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    const garden = createList(ctx, ws, { name: 'Garden', color: '#336699' });
    ws = garden.workspace;
    ws = createTask(ctx, ws, { title: 'Old one', listId: garden.list.id }).workspace;
    ws = createTask(ctx, ws, { title: 'Loose', listId: inboxList(ws).id }).workspace;
    ws = createTag(ctx, ws, 'yard').workspace;
    return { ctx, ws };
  };
  const live = (ws: ReturnType<typeof createWorkspace>) => ({
    lists: ws.entities.lists
      .filter((each) => !each.deletedAt && !each.isInbox)
      .map((each) => each.name),
    tasks: ws.entities.tasks
      .filter((each) => !each.deletedAt)
      .map((each) => each.title)
      .sort(),
    tags: ws.entities.tags.filter((each) => !each.deletedAt).length,
  });

  it('merging keeps what is here, and can go into the list of the same name', () => {
    const { ctx, ws } = current();
    const out = applyImport(ctx, ws, plan(), { mode: 'merge', intoSameNamed: true });
    expect(live(out.workspace)).toEqual({
      lists: ['Garden'],
      tasks: ['Loose', 'New one', 'Old one'],
      tags: 1,
    });
    expect(out.trashed).toEqual({ lists: 0, tasks: 0, tags: 0 });
  });

  it('replacing puts my lists, the Mess Drawer and my tags in the Trash first', () => {
    const { ctx, ws } = current();
    expect(replaceable(ws, ctx.userId)).toMatchObject({ lists: [{ name: 'Garden' }] });
    const out = applyImport(ctx, ws, plan(), { mode: 'replace', intoSameNamed: true });
    expect(live(out.workspace)).toEqual({ lists: ['Garden'], tasks: ['New one'], tags: 1 });
    expect(out.trashed).toEqual({ lists: 1, tasks: 2, tags: 1 });
    // Trashed, not gone: the old ones are still there to restore.
    expect(
      out.workspace.entities.tasks.find((each) => each.title === 'Old one')?.deletedAt,
    ).not.toBeNull();
  });
});

describe('landing as the other app meant it', () => {
  it('closes what is open under a closed task, keeps when it was made, and titles the untitled', () => {
    const plan: ImportPlan = {
      source: 'ticktick',
      lists: [{ key: 'l', name: 'Trip' }],
      tasks: [
        {
          key: 'p',
          listKey: 'l',
          title: 'Pack',
          status: 'done',
          completedAt: '2026-05-02T10:00:00.000Z',
          priority: 0,
          createdAt: '2024-03-01T08:30:00.000Z',
        },
        { key: 'p.0', listKey: 'l', parentKey: 'p', title: 'Gloves', status: 'open', priority: 0 },
        {
          key: 'p.0.0',
          listKey: 'l',
          parentKey: 'p.0',
          title: 'Left one',
          status: 'open',
          priority: 0,
        },
        {
          key: 'x',
          listKey: 'l',
          title: '',
          notes: '\n  Call the cabin\nabout keys',
          status: 'open',
          priority: 0,
        },
        { key: 'y', listKey: 'l', title: ' ', status: 'open', priority: 0 },
        {
          key: 'z',
          listKey: 'l',
          title: '',
          notes: '- [x] Realtor questions\n- [ ] Siding',
          status: 'open',
          priority: 0,
        },
      ],
      notes: {},
    };
    expect(planSummary(plan)).toMatchObject({ open: 3, closed: 3 });
    const { task } = landed(plan);
    expect(task('Gloves')).toMatchObject({
      status: 'done',
      completedAt: '2026-05-02T10:00:00.000Z',
    });
    expect(task('Left one').status).toBe('done');
    expect(task('Pack').createdAt).toBe('2024-03-01T08:30:00.000Z');
    expect(task('Call the cabin').status).toBe('open');
    expect(task('Untitled').status).toBe('open');
    expect(task('Realtor questions').notes).toContain('- [ ] Siding');
  });
});
