// Exports that cannot be in this repository, even anonymized, kept by the developer elsewhere: set
// PECKLIST_PRIVATE_IMPORTS to their folder to run this. Unset (CI, everyone else), it skips. It
// checks only what holds for any export, so it needs no knowledge of what a file contains: all of
// it lands, the workspace passes the schema, and importing it again adds nothing (spec: PL-063).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../../adapters/ajv-validator.ts';
import { createChronoDateParser } from '../../adapters/chrono-date-parser.ts';
import { testContext } from '../../test/fixtures.ts';
import { isLive } from '../collections.ts';
import { datePart, localDayOf, localTimeZone, weekday } from '../dates.ts';
import { parseRule } from '../recurrence.ts';
import type { WorkspaceFile } from '../types.ts';
import { createWorkspace } from '../workspace.ts';
import { applyImport, describeErrors } from './apply.ts';
import { parseCsv, recordsOf } from './csv.ts';
import { dateReader } from './dateText.ts';
import { detectSource, readPlan } from './index.ts';
import { exportTodoist } from './todoist.ts';

const DIR = process.env.PECKLIST_PRIVATE_IMPORTS;
const files = DIR
  ? readdirSync(DIR).filter((name) => /\.(csv|zip|json|ics)$/i.test(name))
  : ['(PECKLIST_PRIVATE_IMPORTS is not set)'];
const validator = createAjvValidator();
const liveTasks = (ws: WorkspaceFile) => ws.entities.tasks.filter(isLive).length;

describe.skipIf(!DIR)('private import fixtures', () => {
  it('finds at least one', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)(
    '%s lands whole, passes the schema, and adds nothing the second time',
    async (name) => {
      const ctx = testContext();
      const empty = createWorkspace(ctx);
      const bytes = [{ name, bytes: new Uint8Array(readFileSync(join(DIR!, name))) }];
      const source = await detectSource(bytes);
      expect(source).not.toBeNull();
      const timeZone = localTimeZone();
      const plan = await readPlan(source!, bytes, {
        timeZone,
        readDate: dateReader({
          workspace: empty,
          parser: createChronoDateParser(),
          reference: new Date(),
          timeZone,
        }),
      });
      const first = applyImport(ctx, empty, plan, { mode: 'merge', intoSameNamed: true });
      expect(first.tasks).toBe(plan.tasks.length);
      expect(describeErrors(first.workspace, validator.validate(first.workspace).errors)).toEqual(
        [],
      );

      const again = applyImport(ctx, first.workspace, plan, { mode: 'merge', intoSameNamed: true });
      expect(again.tasks).toBe(0);
      expect(again.lists).toBe(0);
      expect(again.skipped).toBe(plan.tasks.length);
      expect(liveTasks(again.workspace)).toBe(liveTasks(first.workspace));

      const replaced = applyImport(ctx, first.workspace, plan, {
        mode: 'replace',
        intoSameNamed: true,
      });
      expect(replaced.skipped).toBe(0);
      expect(liveTasks(replaced.workspace)).toBe(plan.tasks.length);
      expect(validator.validate(replaced.workspace).valid).toBe(true);
    },
    120_000,
  );
});

// Todoist exports: every repeat lands on a day of its own, the ones whose start is a guess are
// listed (and only those), and our own export reads back the same. Counted against the file's
// own rows, so nothing here knows what a file contains.
const todoistFiles = DIR ? files.filter((name) => /\.csv$/i.test(name)) : [];
const REFERENCE = new Date('2026-11-14T20:25:00Z');
const ZONE = 'America/Chicago';

describe.skipIf(!DIR || !todoistFiles.length)('private Todoist exports: repeat dates', () => {
  it.each(todoistFiles)('%s', async (name) => {
    const bytes = [{ name, bytes: new Uint8Array(readFileSync(join(DIR!, name))) }];
    if ((await detectSource(bytes)) !== 'todoist') return;
    const read = () =>
      dateReader({
        workspace: createWorkspace(testContext()),
        parser: createChronoDateParser(),
        reference: REFERENCE,
        timeZone: ZONE,
      });
    const plan = await readPlan('todoist', bytes, { timeZone: ZONE, readDate: read() });
    const text = new TextDecoder().decode(bytes[0]!.bytes);
    const rows = recordsOf(parseCsv(text), (row) => row[0]?.trim() === 'TYPE');
    const dateOf = (key: string) => rows[Number(key.split('#').pop())]?.DATE?.trim() ?? '';
    const today = localDayOf(REFERENCE.toISOString(), ZONE);

    const repeating = plan.tasks.filter((task) => task.recurrence);
    expect(repeating.length).toBe(
      rows.filter((row) => row.TYPE?.trim() === 'task' && /^every/i.test(row.DATE?.trim() ?? ''))
        .length,
    );
    const guessed = new Set(plan.guessedStarts ?? []);
    for (const task of repeating) {
      const rule = parseRule(task.recurrence)!;
      const start = datePart(task.schedule!.start);
      expect(start >= today).toBe(true);
      if (rule.freq === 'WEEKLY' && rule.byDay?.length) {
        expect(rule.byDay.map((day) => day.weekday)).toContain(weekday(start));
      }
      const exact =
        /\bstarting\b/i.test(dateOf(task.key)) ||
        (!rule.fromCompletion &&
          rule.interval === 1 &&
          (rule.freq === 'DAILY' || Boolean(rule.byDay?.length || rule.byMonthDay?.length)));
      expect(guessed.has(task.key)).toBe(!exact);
    }

    const ctx = testContext();
    const landed = applyImport(ctx, createWorkspace(ctx), plan, { intoSameNamed: true }).workspace;
    const back = await readPlan(
      'todoist',
      exportTodoist(landed).map((file) => ({
        name: file.name,
        bytes: new TextEncoder().encode(file.text),
      })),
      { timeZone: ZONE, readDate: read() },
    );
    expect(back.guessedStarts ?? []).toEqual([]);
    const shape = (
      tasks: readonly { schedule?: { start: string } | null; recurrence?: string | null }[],
    ) =>
      tasks
        .filter((task) => task.recurrence)
        .map((task) => `${task.schedule?.start} ${task.recurrence}`)
        .sort();
    expect(shape(back.tasks)).toEqual(shape(landed.entities.tasks.filter(isLive)));
  });
});
