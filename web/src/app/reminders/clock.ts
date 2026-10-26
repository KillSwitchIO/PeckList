import { localTimeZone } from '../../core/dates.ts';

/** "YYYY-MM-DDTHH:mm" in the app's time zone for an instant. */
export function localClock(at: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: localTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
