// Contract every DateParser adapter must pass. Call it from the adapter's own test file.
import { describe, expect, it } from 'vitest';
import type { DateParser } from '../ports/dateParser.ts';

// Wednesday, Oct 21 2026, 10:00 local time.
const REFERENCE = new Date(2026, 9, 21, 10, 0);

export function describeDateParserContract(name: string, parser: DateParser) {
  const first = (text: string) => parser.find(text, REFERENCE)[0];

  describe(`DateParser contract: ${name}`, () => {
    it('finds relative days, with no time unless one is said', () => {
      expect(first('call mom tomorrow')).toMatchObject({
        index: 9,
        length: 8,
        start: { date: '2026-10-22', time: null },
        end: null,
      });
      expect(first('today')!.start).toEqual({ date: '2026-10-21', time: null });
      expect(first('in 3 days')!.start.date).toBe('2026-10-24');
    });

    it('reads times in either clock', () => {
      expect(first('tomorrow 3pm')!.start).toEqual({ date: '2026-10-22', time: '15:00' });
      expect(first('fri at 18:30')!.start).toEqual({ date: '2026-10-23', time: '18:30' });
    });

    it('moves weekdays and dates forward', () => {
      // A bare weekday is the next one (today is Wednesday).
      expect(first('monday')!.start.date).toBe('2026-10-26');
      expect(first('oct 1')!.start.date).toBe('2027-10-01');
    });

    it("keeps today's own date in this year after noon, and moves only an earlier day on", () => {
      // Thursday, Nov 19 2026, 21:58: a date with no time counts as noon, already past.
      const evening = new Date(2026, 10, 19, 21, 58);
      const at = (text: string) => parser.find(text, evening)[0]!.start;
      expect(at('nov 19')).toEqual({ date: '2026-11-19', time: null });
      expect(at('11/19').date).toBe('2026-11-19');
      expect(at('nov 19 at 9pm')).toEqual({ date: '2026-11-19', time: '21:00' });
      expect(at('nov 20').date).toBe('2026-11-20');
      expect(at('nov 18').date).toBe('2027-11-18');
      expect(at('today').date).toBe('2026-11-19');
      // A year said is kept as said.
      expect(at('nov 19 2025').date).toBe('2025-11-19');
      // Late in the year, early dates are next year's.
      expect(parser.find('jan 5', new Date(2026, 11, 30, 18, 0))[0]!.start.date).toBe('2027-01-05');
    });

    it('moves a range as one: this year while it still reaches today, ends always in order', () => {
      const evening = new Date(2026, 10, 19, 21, 58);
      const days = (text: string, reference = evening) => {
        const match = parser.find(text, reference)[0]!;
        return [match.start.date, match.end?.date];
      };
      expect(days('nov 19 - nov 21')).toEqual(['2026-11-19', '2026-11-21']);
      expect(days('nov 18 - nov 21')).toEqual(['2026-11-18', '2026-11-21']);
      expect(days('nov 17 to nov 19')).toEqual(['2026-11-17', '2026-11-19']);
      // Wholly before today: next year, both ends.
      expect(days('nov 10 - nov 15')).toEqual(['2027-11-10', '2027-11-15']);
      // Across the new year.
      expect(days('dec 30 - jan 2', new Date(2026, 11, 30, 18, 0))).toEqual([
        '2026-12-30',
        '2027-01-02',
      ]);
    });

    it('reads ranges', () => {
      const span = first('fri 9am to 11am')!;
      expect(span.start).toEqual({ date: '2026-10-23', time: '09:00' });
      expect(span.end).toEqual({ date: '2026-10-23', time: '11:00' });
      const days = first('oct 28 - oct 30')!;
      expect([days.start.date, days.end?.date]).toEqual(['2026-10-28', '2026-10-30']);
    });

    it('finds nothing in plain text', () => {
      expect(parser.find('buy milk and eggs', REFERENCE)).toEqual([]);
    });
  });
}
