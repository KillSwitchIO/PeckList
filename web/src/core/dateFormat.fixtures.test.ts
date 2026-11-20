// The shared date pattern cases (schema/fixtures/date-patterns/cases.json): the app shows dates in
// a person's pattern exactly as the server words them in reminders. The server's DatePatternTests
// read the same file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatDatePattern, isDatePattern } from './dateFormat.ts';

const FILE = resolve(process.cwd(), '../schema/fixtures/date-patterns/cases.json');
const file = JSON.parse(readFileSync(FILE, 'utf8')) as {
  format: { date: string; pattern: string; text: string }[];
  valid: string[];
  invalid: string[];
};

describe('date patterns, as the server words them', () => {
  it.each(file.format.map((each) => [`${each.pattern} on ${each.date}`, each] as const))(
    '%s',
    (_, { date, pattern, text }) => {
      expect(formatDatePattern(date, pattern, 'en-US')).toBe(text);
    },
  );

  it('take the same patterns', () => {
    expect(file.valid.filter((each) => !isDatePattern(each))).toEqual([]);
    expect(file.invalid.filter((each) => isDatePattern(each))).toEqual([]);
  });
});
