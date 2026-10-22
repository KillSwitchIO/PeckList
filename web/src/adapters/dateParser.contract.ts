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
