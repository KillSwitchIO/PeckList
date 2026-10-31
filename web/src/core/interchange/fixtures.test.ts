// The import fixtures in schema/fixtures/imports (made-up exports in TickTick's and Todoist's own
// file shapes, written by scripts/import-fixtures.mjs): each one lands as the person had it in the
// other app, the workspace it makes passes the schema, and importing the same file again adds
// nothing (spec: PL-063).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../../adapters/ajv-validator.ts';
import { createChronoDateParser } from '../../adapters/chrono-date-parser.ts';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createUlidGenerator } from '../../adapters/ulid-ids.ts';
import { createWorkspaceStore } from '../../app/store/workspaceStore.ts';
import { testContext } from '../../test/fixtures.ts';
import { isLive } from '../collections.ts';
import { inboxList } from '../lists.ts';
import { members, type OpContext } from '../ops.ts';
import { createTask, toggleTaskDone } from '../tasks.ts';
import type { WorkspaceFile } from '../types.ts';
import { createWorkspace } from '../workspace.ts';
import {
  alreadyHere,
  applyImport,
  describeErrors,
  planSummary,
  type ImportOptions,
} from './apply.ts';
import { dateReader } from './dateText.ts';
import { detectSource, readPlan } from './index.ts';
import type { ImportPlan } from './model.ts';

// Tests run from web/.
const DIR = resolve(process.cwd(), '../schema/fixtures/imports');
const ZONE = 'America/Chicago';
// A Sunday, so "every monday" is the next day.
const REFERENCE = new Date('2026-10-25T15:00:00Z');
const validator = createAjvValidator();
const MERGE: ImportOptions = { mode: 'merge', intoSameNamed: true };

async function planOf(name: string, workspace: WorkspaceFile): Promise<ImportPlan> {
  const files = [{ name, bytes: new Uint8Array(readFileSync(resolve(DIR, name))) }];
  const source = await detectSource(files);
  expect(source).not.toBeNull();
  return readPlan(source!, files, {
    timeZone: ZONE,
    readDate: dateReader({
      workspace,
      parser: createChronoDateParser(),
      reference: REFERENCE,
      timeZone: ZONE,
    }),
  });
}

/** A fixture imported into a new workspace, checked against the schema. */
async function imported(name: string, options: ImportOptions = MERGE) {
  const ctx = testContext();
  const empty = createWorkspace(ctx);
  const plan = await planOf(name, empty);
  const outcome = applyImport(ctx, empty, plan, options);
  const ws = outcome.workspace;
  const check = validator.validate(ws);
  expect(describeErrors(ws, check.errors)).toEqual([]);
  const live = ws.entities.tasks.filter(isLive);
  const task = (title: string) => {
    const found = live.find((each) => each.title === title);
    if (!found) throw new Error(`no task "${title}"`);
    return found;
  };
  const tagNames = new Map(ws.entities.tags.map((tag) => [tag.id, tag.name]));
  const tagsOf = (title: string) =>
    members(task(title).tags)
      .map((id) => tagNames.get(id))
      .sort();
  const listOf = (title: string) =>
    ws.entities.lists.find((list) => list.id === task(title).listId)?.name;
  const parentOf = (title: string) =>
    live.find((each) => each.id === task(title).parentId)?.title ?? null;
  return { ctx, ws, plan, outcome, live, task, tagsOf, listOf, parentOf };
}

const liveCount = (ws: WorkspaceFile) => ws.entities.tasks.filter(isLive).length;

describe('the TickTick backup fixture', () => {
  it('lands with its lists, nesting, tags and priorities', async () => {
    const { task, tagsOf, listOf, parentOf, live, ws } = await imported('ticktick-backup.csv');
    expect(listOf('No date at all')).toBe(inboxList(ws).name);
    expect(listOf('Priority none')).toBe('Home');
    expect(listOf('Card in Doing')).toBe('Work 💼');
    expect(
      ['Priority none', 'Priority low', 'Priority medium', 'Priority high'].map(
        (title) => task(title).priority,
      ),
    ).toEqual([0, 1, 2, 3]);
    expect(tagsOf('Priority low')).toEqual(['home/garden']);
    expect(tagsOf('Priority medium')).toEqual(['home/garden/beds', '🌱plants']);
    expect(tagsOf('Priority high')).toEqual(['work-stuff', '🔥']);
    expect(ws.entities.tags.map((tag) => tag.name)).toContain('home');
    // Five levels under a task at most: the sixth sits beside the fifth.
    expect(parentOf('Kitchen step at depth 1')).toBe('Renovate kitchen');
    expect(parentOf('Kitchen step at depth 5')).toBe('Kitchen step at depth 4');
    expect(parentOf('Kitchen step at depth 6')).toBe('Kitchen step at depth 4');
    expect(parentOf('Orphan whose parent is not in the file')).toBeNull();
    expect(live).toHaveLength(41);
  });

  it('keeps dates with and without times in their own time zones', async () => {
    const { task } = await imported('ticktick-backup.csv');
    expect(task('All-day task, Chicago').schedule).toEqual({
      start: '2026-11-04',
      end: null,
      allDay: true,
      timeZone: ZONE,
    });
    expect(task('All-day span Nov 7 to Nov 8').schedule).toMatchObject({
      start: '2026-11-07',
      end: '2026-11-08',
    });
    expect(task('Timed task with an end, Chicago').schedule).toEqual({
      start: '2026-11-05T14:30',
      end: '2026-11-05T15:30',
      allDay: false,
      timeZone: ZONE,
    });
    expect(task('Due only, timed').schedule?.start).toBe('2026-11-06T08:00');
    expect(task('All-day in Tokyo').schedule).toMatchObject({
      start: '2026-11-10',
      allDay: true,
      timeZone: 'Asia/Tokyo',
    });
    expect(task('Timed in London on the day clocks go back').schedule).toMatchObject({
      start: '2026-10-25T09:00',
      timeZone: 'Europe/London',
    });
    // No zone in the file: the importing device's.
    expect(task('Floating time, no zone written').schedule).toMatchObject({
      start: '2026-11-10T09:00',
      timeZone: ZONE,
    });
    expect(task('No date at all').schedule).toBeNull();
  });

  it('keeps at most ten reminders, and one over a year early as a set time', async () => {
    const { task, plan } = await imported('ticktick-backup.csv');
    expect(task('Eleven reminders').reminders).toHaveLength(10);
    expect(task('A reminder more than a year early').reminders).toEqual([
      { at: '2026-10-27T13:00' },
      { before: 30 },
    ]);
    expect(planSummary(plan).notes.reminderDropped).toBe(1);
  });

  it('keeps the repeats Punchlist reads, and says which it cannot', async () => {
    const { task, plan } = await imported('ticktick-backup.csv');
    expect(task('Every weekday').recurrence).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR');
    expect(task('Monthly on the last day').recurrence).toBe(
      'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=-1',
    );
    expect(task('Daily until Dec 31').recurrence).toBe('FREQ=DAILY;INTERVAL=1;UNTIL=20261231');
    expect(task('Weekly, five times').recurrence).toBe('FREQ=WEEKLY;INTERVAL=1;COUNT=5');
    expect(task('Last Friday of the month').recurrence).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR');
    expect(task('Written with RRULE:').recurrence).toBe('FREQ=YEARLY;INTERVAL=1');
    expect(task('Custom dates (dropped)').recurrence).toBeNull();
    expect(planSummary(plan).notes.repeatDropped).toBe(1);
  });

  it('closes what was closed, with what was open under it', async () => {
    const { task } = await imported('ticktick-backup.csv');
    expect(task('Done task')).toMatchObject({
      status: 'done',
      completedAt: '2026-10-20T17:00:00.000Z',
    });
    expect(task("Won't do task").status).toBe('wontdo');
    expect(task('Open child of a done parent').status).toBe('done');
  });

  it('keeps notes as markdown and checklists, and names the attachments it cannot bring', async () => {
    const { task, plan } = await imported('ticktick-backup.csv');
    expect(task('Renovate kitchen').notes).toContain('| Tile | 40 |');
    expect(task('Renovate kitchen').notes).toContain('```\nwidth = 120 cm\n```');
    expect(task('Packing checklist').notes).toBe(
      'Before the trip\n\n- [x] Passport\n- [ ] Charger\n- [ ] Snacks',
    );
    expect(task('Receipt photo').notes).toBe(
      'See 📎 receipt.jpg (attachment not imported) and 📎 manual.pdf (attachment not imported)',
    );
    expect(task('Untitled: this first line is its title').notes).toContain('more text');
    expect(planSummary(plan).notes).toMatchObject({
      attachmentsLeft: 2,
      foldersDropped: 1,
      notesAsTasks: 1,
      // "To do" and "Doing"; "Not Sectioned" is no section.
      sectionsDropped: 2,
      tooDeep: 1,
    });
  });
});

describe('the Todoist fixtures', () => {
  it('a backup zip lands with projects, nesting, labels and priorities', async () => {
    const { task, tagsOf, listOf, parentOf, ws, plan } = await imported('todoist-backup.zip');
    expect(listOf('Plain task, no date')).toBe(inboxList(ws).name);
    expect(listOf('Renovate kitchen')).toBe('Home');
    expect(parentOf('Depth 4')).toBe('Depth 3');
    expect(parentOf('Back to depth 2')).toBe('Renovate kitchen');
    expect(
      ['Priority p1', 'Priority p2', 'Priority p3', 'Priority p4'].map(
        (title) => task(title).priority,
      ),
    ).toEqual([3, 2, 1, 0]);
    expect(tagsOf('Labels')).toEqual(['errands', 'home/garden', '🌱plants']);
    expect(task('Markdown description').notes).toContain('| Tile | 40 |');
    expect(task('Has comments').notes).toBe(
      'First comment with **bold**\n\n📎 receipt.pdf (attachment not imported)',
    );
    expect(planSummary(plan).notes).toMatchObject({
      sectionsDropped: 2,
      commentsAsNotes: 2,
      attachmentsLeft: 1,
    });
    expect(planSummary(plan).notes.dateUnread).toBeUndefined();
  });

  it('keeps dates, times, durations, deadlines and a task’s own time zone', async () => {
    const { task } = await imported('todoist-backup.zip');
    expect(task('All-day date').schedule).toEqual({
      start: '2026-11-12',
      end: null,
      allDay: true,
      timeZone: ZONE,
    });
    expect(task('Timed date').schedule?.start).toBe('2026-11-12T14:30');
    expect(task('Timed in Tokyo').schedule).toMatchObject({
      start: '2026-11-13T09:00',
      timeZone: 'Asia/Tokyo',
    });
    expect(task('Timed with a duration').schedule).toMatchObject({
      start: '2026-11-14T10:00',
      end: '2026-11-14T10:45',
    });
    expect(task('With a deadline').due).toEqual({
      at: '2026-12-01',
      allDay: true,
      timeZone: ZONE,
    });
  });

  it('reads the repeats Todoist writes as words', async () => {
    const { task } = await imported('todoist-backup.zip');
    const repeat = (title: string) => ({
      rule: task(title).recurrence,
      start: task(title).schedule?.start,
    });
    expect(repeat('Every weekday')).toEqual({
      rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      start: '2026-10-26',
    });
    expect(repeat('Every last day')).toEqual({
      rule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
      start: '2026-10-31',
    });
    expect(repeat('Every month on the last day')).toEqual(repeat('Every last day'));
    expect(repeat('Every day until Dec 31')).toEqual({
      rule: 'FREQ=DAILY;UNTIL=20261231',
      start: '2026-10-25',
    });
    expect(repeat('Every day ending Dec 31')).toEqual(repeat('Every day until Dec 31'));
    expect(repeat('Every monday at 9am')).toEqual({
      rule: 'FREQ=WEEKLY;BYDAY=MO',
      start: '2026-10-26T09:00',
    });
    expect(repeat('Every 3 days from completion').rule).toBe(
      'FREQ=DAILY;INTERVAL=3;X-PL-FROM=COMPLETION',
    );
    expect(repeat('Every 15th')).toEqual({
      rule: 'FREQ=MONTHLY;BYMONTHDAY=15',
      start: '2026-11-15',
    });
    expect(repeat('Every last friday')).toEqual({
      rule: 'FREQ=MONTHLY;BYDAY=-1FR',
      start: '2026-10-30',
    });
    expect(repeat('Every 2 weeks starting')).toEqual({
      rule: 'FREQ=WEEKLY;INTERVAL=2',
      start: '2026-11-09',
    });
  });

  it('a single project CSV lands as that project', async () => {
    const { live, plan } = await imported('todoist-project.csv');
    expect(plan.lists).toHaveLength(1);
    expect(live).toHaveLength(13);
  });
});

describe('big exports', () => {
  it.each([
    ['ticktick-large.csv', 5120],
    ['todoist-large.zip', 5200],
  ])(
    '%s: all %i tasks land, and the workspace passes the schema',
    async (name, count) => {
      const { live, outcome } = await imported(name);
      expect(live).toHaveLength(count);
      expect(outcome.tasks).toBe(count);
    },
    60_000,
  );
});

describe('importing the same file again', () => {
  const twice = async (
    name: string,
    change?: (ctx: OpContext, ws: WorkspaceFile) => WorkspaceFile,
  ) => {
    const first = await imported(name);
    const ws = change ? change(first.ctx, first.ws) : first.ws;
    const again = applyImport(first.ctx, ws, first.plan, MERGE);
    return { first, ws, again };
  };

  it.each(['ticktick-backup.csv', 'todoist-backup.zip', 'ticktick-large.csv'])(
    '%s adds nothing the second time',
    async (name) => {
      const { first, again } = await twice(name);
      expect(again.tasks).toBe(0);
      expect(again.lists).toBe(0);
      expect(again.tags).toBe(0);
      expect(again.skipped).toBe(first.plan.tasks.length);
      expect(liveCount(again.workspace)).toBe(liveCount(first.ws));
      expect(validator.validate(again.workspace).valid).toBe(true);
    },
    60_000,
  );

  it('keeps what was changed here since, and adds only what is new in the file', async () => {
    const first = await imported('ticktick-backup.csv');
    const ws = toggleTaskDone(first.ctx, first.ws, first.task('No date at all').id);
    const plan: ImportPlan = {
      ...first.plan,
      tasks: [
        ...first.plan.tasks,
        { key: 'new-1', listKey: 'Home', title: 'New since', status: 'open', priority: 0 },
        // A second task of a name already here is a task of its own.
        { key: 'new-2', listKey: 'Home', title: 'Priority none', status: 'open', priority: 0 },
      ],
    };
    const again = applyImport(first.ctx, ws, plan, MERGE);
    expect(again.tasks).toBe(2);
    const titles = again.workspace.entities.tasks.filter(isLive).map((task) => task.title);
    expect(titles.filter((title) => title === 'Priority none')).toHaveLength(2);
    expect(titles.filter((title) => title === 'New since')).toHaveLength(1);
    expect(
      again.workspace.entities.tasks.find((task) => task.title === 'No date at all')?.status,
    ).toBe('done');
  });

  it('a TickTick task made at another time is another task, even with the same title', async () => {
    const first = await imported('ticktick-backup.csv');
    const plan: ImportPlan = {
      ...first.plan,
      tasks: first.plan.tasks.map((task) =>
        task.title === 'Done task' ? { ...task, createdAt: '2026-10-29T10:00:00.000Z' } : task,
      ),
    };
    expect(alreadyHere(first.ws, plan, MERGE).size).toBe(plan.tasks.length - 1);
  });

  it('replacing twice leaves one copy, the first in the Trash', async () => {
    const replace: ImportOptions = { mode: 'replace', intoSameNamed: true };
    const first = await imported('ticktick-backup.csv', replace);
    const again = applyImport(first.ctx, first.ws, first.plan, replace);
    expect(again.skipped).toBe(0);
    expect(liveCount(again.workspace)).toBe(liveCount(first.ws));
    expect(again.trashed.tasks).toBe(liveCount(first.ws));
    expect(validator.validate(again.workspace).valid).toBe(true);
  });

  it('into new lists beside the old ones, only the Mess Drawer’s tasks are found again', async () => {
    const beside: ImportOptions = { mode: 'merge', intoSameNamed: false };
    const first = await imported('ticktick-backup.csv', beside);
    const inboxTasks = first.plan.tasks.filter((task) => task.listKey === 'Inbox').length;
    expect(alreadyHere(first.ws, first.plan, beside).size).toBe(inboxTasks);
  });
});

describe('undo', () => {
  it.each(['merge', 'replace'] as const)(
    'one undo takes a %s of the big TickTick export back',
    async (mode) => {
      const store = createWorkspaceStore({
        storage: createMemoryStorage(),
        validator,
        ids: createUlidGenerator(),
        node: 'test',
      });
      await store.getState().init();
      store
        .getState()
        .apply(
          (ctx, ws) =>
            createTask(ctx, ws, { title: 'Here before', listId: inboxList(ws).id }).workspace,
        );
      const before = store.getState().workspace!;
      const plan = await planOf('ticktick-large.csv', before);
      const result = store
        .getState()
        .applyChecked(
          (ctx, ws) => applyImport(ctx, ws, plan, { mode, intoSameNamed: true }).workspace,
          'Imported from TickTick',
        );
      expect(result.ok).toBe(true);
      const after = store.getState().workspace!;
      expect(liveCount(after)).toBe(mode === 'merge' ? 5121 : 5120);
      store.getState().undo();
      const undone = store.getState().workspace!;
      expect(undone.entities.tasks.filter(isLive).map((task) => task.title)).toEqual([
        'Here before',
      ]);
      expect(undone.entities.lists.filter(isLive)).toHaveLength(
        before.entities.lists.filter(isLive).length,
      );
    },
    60_000,
  );
});

describe('schema errors as a person reads them', () => {
  it('names the task and the field', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    const withTask = {
      ...ws,
      entities: {
        ...ws.entities,
        tasks: [{ ...({} as WorkspaceFile['entities']['tasks'][number]), title: 'Water plants' }],
      },
    };
    expect(
      describeErrors(withTask, [
        '/entities/tasks/0/reminders must NOT have more than 10 items',
        '/entities/tasks/0/reminders/0 must match exactly one schema in oneOf',
        '/ must have required property owner',
      ]),
    ).toEqual([
      '"Water plants": reminders must NOT have more than 10 items',
      '/ must have required property owner',
    ]);
  });
});
