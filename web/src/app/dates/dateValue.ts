import { joinDateTime } from '../../core/dates.ts';

/** A date with an optional `HH:mm` time. */
export interface DatePart {
  date: string;
  time: string | null;
}

/** A picked date with an optional time, and for a time span its end. */
export interface DateValue extends DatePart {
  end?: DatePart | null;
}

/** An hour later on the same day, stopping at 23:59. */
export function addHour(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  if (h >= 23) return '23:59';
  return `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * A span made consistent: all day on both ends or timed on both (a missing end time is an hour
 * after the start), and start before end (swapped when picked backwards).
 */
export function orderedSpan(start: DatePart, end: DatePart): { start: DatePart; end: DatePart } {
  const fixedEnd: DatePart =
    start.time === null
      ? { date: end.date, time: null }
      : { date: end.date, time: end.time ?? addHour(start.time) };
  const key = (part: DatePart) => `${part.date}T${part.time ?? '00:00'}`;
  return key(fixedEnd) < key(start)
    ? {
        start: { date: fixedEnd.date, time: fixedEnd.time },
        end: { date: start.date, time: start.time },
      }
    : { start, end: fixedEnd };
}

/** Time the wheels start from when a task has no time yet. */
export const DEFAULT_TIME = '09:00';

/** Time used by the "Tonight" shortcut. */
export const EVENING = '18:00';

export function toDateValue(
  value: string | undefined | null,
  end?: string | null,
): DateValue | null {
  if (!value) return null;
  const part = (text: string): DatePart => ({
    date: text.slice(0, 10),
    time: text.length > 10 ? text.slice(11, 16) : null,
  });
  return end ? { ...part(value), end: part(end) } : part(value);
}

export function fromDateValue(value: DateValue): string {
  return joinDateTime(value.date, value.time);
}
