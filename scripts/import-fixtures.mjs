#!/usr/bin/env node
// Writes the import fixtures in schema/fixtures/imports/ (spec: PL-063): made-up TickTick and
// Todoist exports in each app's own file shape, covering what an import must get right (nesting,
// sections, tags with slashes and emoji, priorities, dates with and without times in several time
// zones, repeats, closed tasks, attachments, notes in markdown) and two big ones (over 5,000
// tasks). Nothing in them comes from anyone's real export. The output is the same every run:
// `node scripts/import-fixtures.mjs` after a change here, and commit what it wrote.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../schema/fixtures/imports');

/** A CSV field as both apps quote it: always, inner quotes doubled. */
const field = (value) => `"${String(value).replace(/"/g, '""')}"`;
const csv = (rows) => rows.map((row) => row.map(field).join(',')).join('\n') + '\n';

/** Small deterministic random numbers (mulberry32), so every run writes the same bytes. */
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A zip of `files` ({ name, text }), deflated, as Todoist's backups come. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = Buffer.from(file.text, 'utf8');
    const packed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x5b21, 12); // 2025-08-01, a fixed date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x5b21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ---------------------------------------------------------------------------------------------
// TickTick: Settings > Account > Backup ("Generate backup"), one CSV.

const TICKTICK_HEADER = [
  'Folder Name',
  'List Name',
  'Title',
  'Kind',
  'Tags',
  'Content',
  'Is Check list',
  'Start Date',
  'Due Date',
  'Reminder',
  'Repeat',
  'Priority',
  'Status',
  'Created Time',
  'Completed Time',
  'Order',
  'Timezone',
  'Is All Day',
  'Is Floating',
  'Column Name',
  'Column Order',
  'View Mode',
  'taskId',
  'parentId',
  'projectKind',
];

const tickPreamble = (date) => [
  [`Date: ${date}+0000`],
  ['Version: 7.2'],
  ['Status: \n0 Normal\n-1 Abandoned \n2 Completed'],
  TICKTICK_HEADER,
];

/** TickTick's ids are 24 hex digits. */
const tickId = (n) => `65f0${String(n).padStart(20, '0')}`;

/** A TickTick row from the fields that matter; the rest as TickTick leaves them. */
function tickRow(task) {
  const defaults = {
    folder: '',
    kind: 'TEXT',
    tags: '',
    content: '',
    checklist: 'N',
    start: '',
    due: '',
    reminder: '',
    repeat: '',
    priority: '0',
    status: '0',
    created: '2026-09-01T15:00:00+0000',
    completed: '',
    order: '0',
    timezone: 'America/Chicago',
    allDay: task.start || task.due ? 'false' : '',
    floating: 'false',
    column: '',
    columnOrder: '',
    viewMode: 'list',
    parent: '',
    projectKind: 'TASK',
  };
  const t = { ...defaults, ...task };
  return [
    t.folder,
    t.list,
    t.title,
    t.kind,
    t.tags,
    t.content,
    t.checklist,
    t.start,
    t.due,
    t.reminder,
    t.repeat,
    t.priority,
    t.status,
    t.created,
    t.completed,
    t.order,
    t.timezone,
    t.allDay,
    t.floating,
    t.column,
    t.columnOrder,
    t.viewMode,
    t.id,
    t.parent,
    t.projectKind,
  ];
}

const MARKDOWN_NOTES = [
  '## Plan',
  '',
  'Ask **two** quotes, pick the _cheaper_ one. See [the guide](https://example.com/guide).',
  '',
  '1. Measure',
  '2. Order',
  '   - nested bullet',
  '',
  '> Keep the receipt.',
  '',
  '```',
  'width = 120 cm',
  '```',
  '',
  '| Part | Cost |',
  '|---|---|',
  '| Tile | 40 |',
].join('\n');

function tickTickSample() {
  let n = 0;
  const id = () => tickId(++n);
  const rows = [];
  const add = (task) => {
    const made = { id: id(), order: String(-1099511627776 + n * 1024), ...task };
    rows.push(made);
    return made.id;
  };

  // Inbox: dates with and without times, in several time zones.
  add({
    list: 'Inbox',
    title: 'All-day task, Chicago',
    start: '2026-11-04T06:00:00+0000',
    due: '2026-11-04T06:00:00+0000',
    allDay: 'true',
    reminder: 'P0DT9H0M0S',
  });
  add({
    list: 'Inbox',
    title: 'All-day span Nov 7 to Nov 8',
    start: '2026-11-07T06:00:00+0000',
    due: '2026-11-09T06:00:00+0000',
    allDay: 'true',
  });
  add({
    list: 'Inbox',
    title: 'Timed task with an end, Chicago',
    start: '2026-11-05T20:30:00+0000',
    due: '2026-11-05T21:30:00+0000',
    reminder: '-PT15M\n-PT0S',
  });
  add({
    list: 'Inbox',
    title: 'Due only, timed',
    due: '2026-11-06T14:00:00+0000',
  });
  add({
    list: 'Inbox',
    title: 'All-day in Tokyo',
    start: '2026-11-09T15:00:00+0000',
    due: '2026-11-09T15:00:00+0000',
    allDay: 'true',
    timezone: 'Asia/Tokyo',
  });
  add({
    list: 'Inbox',
    title: 'Timed in London on the day clocks go back',
    start: '2026-10-25T09:00:00+0000',
    due: '2026-10-25T09:00:00+0000',
    timezone: 'Europe/London',
  });
  add({
    list: 'Inbox',
    title: 'Floating time, no zone written',
    start: '2026-11-10T15:00:00+0000',
    due: '2026-11-10T15:00:00+0000',
    timezone: '',
    floating: 'true',
  });
  add({ list: 'Inbox', title: 'No date at all', timezone: '' });
  add({
    list: 'Inbox',
    title: 'Eleven reminders',
    start: '2026-11-12T18:00:00+0000',
    due: '2026-11-12T18:00:00+0000',
    reminder: Array.from({ length: 11 }, (_, i) => `-PT${(i + 1) * 5}M`).join('\n'),
  });
  add({
    list: 'Inbox',
    title: 'A reminder more than a year early',
    start: '2027-12-01T18:00:00+0000',
    due: '2027-12-01T18:00:00+0000',
    reminder: '-P400DT0H0M0S\n-PT30M',
  });
  add({
    list: 'Inbox',
    title: 'Quotes "inside", commas, and a line\nbreak',
    content: 'Plain note',
  });
  add({ list: 'Inbox', title: '', content: 'Untitled: this first line is its title\nmore text' });

  // Home (in a folder): priorities, tags with slashes, emoji and spaces, deep nesting.
  const home = { folder: 'Life', list: 'Home' };
  add({ ...home, title: 'Priority none', priority: '0', tags: 'errands' });
  add({ ...home, title: 'Priority low', priority: '1', tags: 'home/garden' });
  add({ ...home, title: 'Priority medium', priority: '3', tags: '🌱plants,home/garden/beds' });
  add({ ...home, title: 'Priority high', priority: '5', tags: 'Work Stuff, 🔥' });
  const level0 = add({ ...home, title: 'Renovate kitchen', content: MARKDOWN_NOTES });
  let parent = level0;
  for (let depth = 1; depth <= 6; depth += 1) {
    parent = add({ ...home, title: `Kitchen step at depth ${depth}`, parent });
  }
  add({ ...home, title: 'Orphan whose parent is not in the file', parent: tickId(99999) });
  add({
    ...home,
    title: 'Packing checklist',
    kind: 'CHECKLIST',
    checklist: 'Y',
    content: 'Before the trip\r▪Passport\r▫Charger\r▫Snacks\r',
  });
  add({
    ...home,
    title: 'Receipt photo',
    content:
      'See ![image](65f0a1b2c3d4e5f6a7b8c9d0/receipt.jpg) and ![file](65f0a1b2c3d4e5f6a7b8c9d1/manual.pdf)',
  });

  // Repeats.
  const repeats = { list: 'Repeats' };
  const day = {
    start: '2026-11-02T06:00:00+0000',
    due: '2026-11-02T06:00:00+0000',
    allDay: 'true',
  };
  add({
    ...repeats,
    ...day,
    title: 'Every weekday',
    repeat: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR',
  });
  add({
    ...repeats,
    start: '2026-11-30T06:00:00+0000',
    due: '2026-11-30T06:00:00+0000',
    allDay: 'true',
    title: 'Monthly on the last day',
    repeat: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1',
  });
  add({
    ...repeats,
    ...day,
    title: 'Daily until Dec 31',
    repeat: 'FREQ=DAILY;INTERVAL=1;UNTIL=20261231',
  });
  add({
    ...repeats,
    ...day,
    title: 'Weekly, five times',
    repeat: 'FREQ=WEEKLY;INTERVAL=1;COUNT=5',
  });
  add({
    ...repeats,
    ...day,
    title: 'Last Friday of the month',
    repeat: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR',
  });
  add({ ...repeats, ...day, title: 'Written with RRULE:', repeat: 'RRULE:FREQ=YEARLY;INTERVAL=1' });
  add({
    ...repeats,
    ...day,
    title: 'Custom dates (dropped)',
    repeat: 'ERULE:NAME=CUSTOM;BYDATE=20261105,20261120',
  });

  // Closed tasks, and open ones under a closed parent.
  const closed = { list: 'Errands' };
  add({ ...closed, title: 'Done task', status: '2', completed: '2026-10-20T17:00:00+0000' });
  add({ ...closed, title: "Won't do task", status: '-1', completed: '2026-10-21T17:00:00+0000' });
  const doneParent = add({
    ...closed,
    title: 'Done parent',
    status: '2',
    completed: '2026-10-22T17:00:00+0000',
  });
  add({ ...closed, title: 'Open child of a done parent', parent: doneParent });

  // A kanban list: its columns are sections.
  const board = { list: 'Work 💼', viewMode: 'kanban' };
  add({ ...board, title: 'Card in To do', column: 'To do', columnOrder: '1' });
  add({ ...board, title: 'Card in Doing', column: 'Doing', columnOrder: '2' });
  add({ ...board, title: 'Card not sectioned', column: 'Not Sectioned', columnOrder: '0' });

  // A note list (TickTick's notes).
  add({
    list: 'Ideas',
    title: 'A note',
    kind: 'NOTE',
    projectKind: 'NOTE',
    content: 'Just a note',
  });

  return csv([...tickPreamble('2026-10-30'), ...rows.map(tickRow)]);
}

/** Over 5,000 tasks across 20 lists: nested, tagged, dated, most of them done. */
function tickTickLarge() {
  const next = random(63);
  const pick = (items) => items[Math.floor(next() * items.length)];
  const rows = [];
  let n = 0;
  const tags = ['home', 'work', 'errands', 'home/garden', 'health', '📚reading', 'money/bills'];
  const zones = ['America/Chicago', 'America/New_York', 'Europe/Berlin', 'Asia/Tokyo'];
  for (let list = 0; list < 20; list += 1) {
    const listName = `List ${String(list + 1).padStart(2, '0')}`;
    const folder = list % 3 === 0 ? `Folder ${list / 3 + 1}` : '';
    for (let i = 0; i < 160; i += 1) {
      const top = tickId(++n);
      const done = next() < 0.8;
      const day = 1 + Math.floor(next() * 28);
      const dated = next() < 0.6;
      const allDay = next() < 0.5;
      const zone = pick(zones);
      const at = `2026-${String(1 + Math.floor(next() * 12)).padStart(2, '0')}-${String(day).padStart(2, '0')}T${allDay ? '06:00' : '15:30'}:00+0000`;
      rows.push({
        id: top,
        folder,
        list: listName,
        title: `Task ${n} in ${listName}`,
        tags: next() < 0.4 ? pick(tags) : '',
        content: next() < 0.2 ? `Notes for task ${n}\n- point one\n- point two` : '',
        start: dated ? at : '',
        due: dated ? at : '',
        allDay: dated ? String(allDay) : '',
        timezone: zone,
        priority: pick(['0', '0', '1', '3', '5']),
        status: done ? '2' : '0',
        completed: done ? '2026-10-01T12:00:00+0000' : '',
        repeat: dated && next() < 0.05 ? 'FREQ=WEEKLY;INTERVAL=1' : '',
        order: String(i * 1024),
      });
      // Every fifth task has two subtasks, one with its own subtask.
      if (i % 5 === 0) {
        const child = tickId(++n);
        rows.push({
          id: child,
          folder,
          list: listName,
          title: `Subtask ${n}`,
          parent: top,
          status: done ? '2' : '0',
          completed: done ? '2026-10-01T12:00:00+0000' : '',
          order: '0',
        });
        rows.push({
          id: tickId(++n),
          folder,
          list: listName,
          title: `Subtask ${n}`,
          parent: top,
          order: '1024',
        });
        rows.push({
          id: tickId(++n),
          folder,
          list: listName,
          title: `Sub-subtask ${n}`,
          parent: child,
          order: '0',
        });
      }
    }
  }
  return csv([...tickPreamble('2026-10-30'), ...rows.map(tickRow)]);
}

// ---------------------------------------------------------------------------------------------
// Todoist: a project's "Export as a CSV file", or Settings > Backups (a zip, a CSV a project).
// Todoist exports open tasks only: completed and archived ones are not in the file.

const TODOIST_HEADER = [
  'TYPE',
  'CONTENT',
  'DESCRIPTION',
  'PRIORITY',
  'INDENT',
  'AUTHOR',
  'RESPONSIBLE',
  'DATE',
  'DATE_LANG',
  'TIMEZONE',
  'DURATION',
  'DURATION_UNIT',
  'DEADLINE',
  'DEADLINE_LANG',
];
const AUTHOR = 'Sam Sample (40000001)';
const BLANK = TODOIST_HEADER.map(() => '');

/** A Todoist row: task (default), section, note or meta. Blank rows between, as Todoist writes. */
function doRow(row) {
  const t = {
    type: 'task',
    content: '',
    description: '',
    priority: row.type && row.type !== 'task' ? '' : '4',
    indent: row.type && row.type !== 'task' ? '' : '1',
    author: row.type === 'section' || row.type === 'meta' ? '' : AUTHOR,
    responsible: '',
    date: '',
    lang: '',
    timezone: '',
    duration: '',
    unit: '',
    deadline: '',
    deadlineLang: '',
    ...row,
  };
  return [
    t.type,
    t.content,
    t.description,
    t.priority,
    t.indent,
    t.author,
    t.responsible,
    t.date,
    t.date ? t.lang || 'en' : '',
    t.timezone,
    t.duration,
    t.unit,
    t.deadline,
    t.deadline ? t.deadlineLang || 'en' : '',
  ];
}

const todoistCsv = (rows, view = 'list') =>
  csv([
    TODOIST_HEADER,
    doRow({ type: 'meta', content: 'view_style', description: view }),
    BLANK,
    ...rows.flatMap((row) => [doRow(row), BLANK]),
  ]);

function todoistSample() {
  const inbox = todoistCsv([
    { content: 'Plain task, no date' },
    { content: 'All-day date', date: 'Nov 12 2026' },
    { content: 'Timed date', date: 'Nov 12 2026 14:30' },
    { content: 'Timed in Tokyo', date: 'Nov 13 2026 09:00', timezone: 'Asia/Tokyo' },
    { content: 'Timed with a duration', date: 'Nov 14 2026 10:00', duration: '45', unit: 'minute' },
    { content: 'With a deadline', date: 'Nov 15 2026', deadline: 'Dec 1 2026' },
    { content: 'Priority p1', priority: '1' },
    { content: 'Priority p2', priority: '2' },
    { content: 'Priority p3', priority: '3' },
    { content: 'Priority p4', priority: '4' },
    { content: 'Labels @home/garden @🌱plants @errands' },
    {
      content: 'Markdown description',
      description: MARKDOWN_NOTES,
    },
    { content: 'Has comments' },
    { type: 'note', content: 'First comment with **bold**' },
    {
      type: 'note',
      content:
        '[[file {"file_name": "receipt.pdf", "file_size": 20480, "file_type": "application/pdf", "file_url": "https://files.todoist.com/example/receipt.pdf", "resource_type": "file"}]]',
    },
  ]);
  const home = todoistCsv(
    [
      { content: 'Before any section' },
      { type: 'section', content: 'Kitchen' },
      { content: 'Renovate kitchen' },
      { content: 'Depth 2', indent: '2' },
      { content: 'Depth 3', indent: '3' },
      { content: 'Depth 4', indent: '4' },
      { content: 'Back to depth 2', indent: '2' },
      { type: 'section', content: 'Garden 🌻' },
      { content: 'Weed the beds @home/garden', priority: '2' },
    ],
    'board',
  );
  const repeats = todoistCsv([
    { content: 'Every weekday', date: 'every weekday' },
    { content: 'Every last day', date: 'every last day' },
    { content: 'Every month on the last day', date: 'every month on the last day' },
    { content: 'Every day until Dec 31', date: 'every day until Dec 31 2026' },
    { content: 'Every day ending Dec 31', date: 'every day ending Dec 31 2026' },
    { content: 'Every monday at 9am', date: 'every monday at 9am' },
    { content: 'Every 3 days from completion', date: 'every! 3 days' },
    { content: 'Every 15th', date: 'every 15th' },
    { content: 'Every last friday', date: 'every last friday' },
    { content: 'Every 2 weeks starting', date: 'every 2 weeks starting Nov 9 2026' },
  ]);
  return {
    files: [
      { name: 'Inbox [2200000001].csv', text: inbox },
      { name: 'Home [2200000002].csv', text: home },
      { name: 'Repeats [2200000003].csv', text: repeats },
    ],
  };
}

/** Over 5,000 open tasks in 25 projects (a backup zip). */
function todoistLarge() {
  const next = random(64);
  const pick = (items) => items[Math.floor(next() * items.length)];
  const files = [];
  let n = 0;
  for (let project = 0; project < 25; project += 1) {
    const rows = [];
    for (let section = 0; section < 4; section += 1) {
      rows.push({ type: 'section', content: `Section ${section + 1}` });
      for (let i = 0; i < 52; i += 1) {
        n += 1;
        const dated = next() < 0.5;
        rows.push({
          content: `Task ${n}${next() < 0.3 ? ` @${pick(['home', 'work', 'errands', 'home/garden', '📚reading'])}` : ''}`,
          priority: pick(['1', '2', '3', '4', '4', '4']),
          indent: i % 6 === 5 ? '2' : '1',
          date: dated
            ? pick([
                'Nov 3 2026',
                'Nov 12 2026 14:30',
                'every weekday',
                'every monday at 9am',
                'Dec 24 2026',
              ])
            : '',
        });
      }
    }
    files.push({
      name: `Project ${String(project + 1).padStart(2, '0')} [22100000${String(project).padStart(2, '0')}].csv`,
      text: todoistCsv(rows),
    });
  }
  return files;
}

// ---------------------------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const write = (name, data) => writeFileSync(join(OUT, name), data);
write('ticktick-backup.csv', tickTickSample());
write('ticktick-large.csv', tickTickLarge());
const sample = todoistSample();
write('todoist-project.csv', sample.files[0].text);
write('todoist-backup.zip', zip(sample.files));
write('todoist-large.zip', zip(todoistLarge()));
console.log(`wrote the import fixtures to ${OUT}`);
