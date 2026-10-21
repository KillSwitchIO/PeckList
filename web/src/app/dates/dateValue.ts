import { joinDateTime } from '../../core/dates.ts';

/** A picked date with an optional `HH:mm` time. */
export interface DateValue {
  date: string;
  time: string | null;
}

/** Time used by the "Tonight" shortcut. */
export const EVENING = '18:00';

export function toDateValue(value: string | undefined | null): DateValue | null {
  if (!value) return null;
  return { date: value.slice(0, 10), time: value.length > 10 ? value.slice(11, 16) : null };
}

export function fromDateValue(value: DateValue): string {
  return joinDateTime(value.date, value.time);
}
