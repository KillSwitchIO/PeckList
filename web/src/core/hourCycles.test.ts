// The server decides an automatic clock (schema 22) from a table made from ICU
// (server/src/PeckList.Core/Text/hour-cycles.json, scripts/hour-cycles.mjs), and the app from Intl:
// pushes read the clock the app shows only while the two agree. The shared cases
// (schema/fixtures/clock/automatic.json) are read by the server's tests too.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localeUses24h } from './intl.ts';

const CASES = resolve(process.cwd(), '../schema/fixtures/clock/automatic.json');
const cases = (JSON.parse(readFileSync(CASES, 'utf8')) as { cases: Record<string, boolean> }).cases;

describe('an automatic clock, as the server decides it', () => {
  it.each(Object.entries(cases))('%s reads 24-hour: %s', (tag, twentyFour) => {
    expect(localeUses24h(tag)).toBe(twentyFour);
  });

  it('the server’s table is what this ICU says', () => {
    // Throws, with the script's message, when they differ.
    execFileSync(
      process.execPath,
      [resolve(process.cwd(), '../scripts/hour-cycles.mjs'), '--check'],
      {
        stdio: 'pipe',
      },
    );
  }, 60_000);
});
