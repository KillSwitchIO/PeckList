// Contract every MessageFormatter adapter must pass (PL-148). Call it from the adapter's own test
// file. `icu: false` is for a formatter that only fills `{name}` (the plain one): it still has to
// fill, keep missing parameters and never throw, but skips plurals and selects.
import { describe, expect, it } from 'vitest';
import type { MessageFormatter } from '../ports/messageFormat.ts';

export function describeMessageFormatContract(
  name: string,
  formatter: MessageFormatter,
  { icu }: { icu: boolean },
) {
  const format = (message: string, params = {}, locale = 'en') =>
    formatter.format(message, params, locale);

  describe(`MessageFormatter contract: ${name}`, () => {
    it('fills parameters, numbers too, and leaves text without any as it is', () => {
      expect(format('Will be saved as {path}', { path: 'home/yard' })).toBe(
        'Will be saved as home/yard',
      );
      expect(format('{done} of {total}', { done: 3, total: 10 })).toBe('3 of 10');
      expect(format("Can't reach your server")).toBe("Can't reach your server");
    });

    it('keeps a parameter that was not given as {name}', () => {
      expect(format('This view arrives in milestone {milestone}.')).toBe(
        'This view arrives in milestone {milestone}.',
      );
      expect(format('{a} and {b}', { a: 'x' })).toBe('x and {b}');
    });

    it('never throws on a message it cannot read', () => {
      expect(() => format('{count, plural, one {# task}', { count: 2 })).not.toThrow();
      expect(() => format('{count, plural, one {# task} other {# tasks}}')).not.toThrow();
      expect(format('{count, plural, one {# task}', { count: 2 })).toEqual(expect.any(String));
    });

    if (!icu) return;

    it('picks the plural form English asks for, with # as the number', () => {
      const message = '{count, plural, one {# open task} other {# open tasks}}';
      expect(format(message, { count: 1 })).toBe('1 open task');
      expect(format(message, { count: 0 })).toBe('0 open tasks');
      expect(format(message, { count: 5 })).toBe('5 open tasks');
    });

    it("follows each language's own plural rules", () => {
      const polish =
        '{count, plural, one {# zadanie} few {# zadania} many {# zadań} other {# zadania}}';
      expect(format(polish, { count: 1 }, 'pl')).toBe('1 zadanie');
      expect(format(polish, { count: 3 }, 'pl')).toBe('3 zadania');
      expect(format(polish, { count: 5 }, 'pl')).toBe('5 zadań');
      expect(format(polish, { count: 22 }, 'pl')).toBe('22 zadania');
    });

    it("writes # in the language's number style", () => {
      const message = '{count, plural, one {# task} other {# tasks}}';
      expect(format(message, { count: 1234 }, 'en')).toBe('1,234 tasks');
      expect(format(message, { count: 1234 }, 'de')).toBe('1.234 tasks');
    });

    it('picks a select branch, and other when none matches', () => {
      const message = '{kind, select, list {Shared a list} task {Shared a task} other {Shared}}';
      expect(format(message, { kind: 'list' })).toBe('Shared a list');
      expect(format(message, { kind: 'tag' })).toBe('Shared');
    });

    it('fills plain parameters inside a plural', () => {
      const message = '{name} added {count, plural, one {# task} other {# tasks}}';
      expect(format(message, { name: 'Sam', count: 2 })).toBe('Sam added 2 tasks');
    });

    it('reads quoted braces as text', () => {
      expect(format("'{'{count, plural, other {#}}'}'", { count: 2 })).toBe('{2}');
    });
  });
}
