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
import { localTimeZone } from '../dates.ts';
import type { WorkspaceFile } from '../types.ts';
import { createWorkspace } from '../workspace.ts';
import { applyImport, describeErrors } from './apply.ts';
import { dateReader } from './dateText.ts';
import { detectSource, readPlan } from './index.ts';

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
