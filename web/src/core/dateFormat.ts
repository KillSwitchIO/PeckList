// How dates show (Settings > Dates): the language's own, a preset, or a pattern the user types.
// Patterns take the tokens people know from ISO 8601 and moment.js, in either case where that
// is not ambiguous: YYYY 2026, YY 26, MMMM October, MMM Oct, MM 10, M 10, DD 05, D 5,
// dddd Monday, ddd Mon. Text in [brackets] shows as is; anything else (- / . , spaces) too.

/** The language's own format (the default). */
export const DATE_FORMAT_AUTO = 'auto';

/** The formats Settings offers before Custom. */
export const DATE_FORMAT_PRESETS = [
  DATE_FORMAT_AUTO,
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'DD.MM.YYYY',
  'MMM D, YYYY',
  'D MMM YYYY',
  'ddd, MMM D',
] as const;

export const DATE_FORMAT_MAX = 40;

// Longest first, so MMMM is not read as MM MM, and dddd (a weekday) before dd (a day).
const TOKENS = /\[[^\]]*\]|YYYY|yyyy|YY|yy|MMMM|MMM|MM|M|dddd|ddd|EEEE|EEE|DD|dd|D|d/g;

/** Whether a typed pattern can be used: not too long, and showing at least one part of a date. */
export function isDatePattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > DATE_FORMAT_MAX) return false;
  return [...pattern.matchAll(TOKENS)].some((match) => !match[0].startsWith('['));
}

const pad = (value: number) => String(value).padStart(2, '0');

/** A date (`YYYY-MM-DD`) in a pattern; month and weekday names in `locale`. */
export function formatDatePattern(date: string, pattern: string, locale?: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  const name = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(at);
  return pattern.replace(TOKENS, (token) => {
    switch (token) {
      case 'YYYY':
      case 'yyyy':
        return String(year);
      case 'YY':
      case 'yy':
        return pad(year % 100);
      case 'MMMM':
        return name({ month: 'long' });
      case 'MMM':
        return name({ month: 'short' });
      case 'MM':
        return pad(month);
      case 'M':
        return String(month);
      case 'dddd':
      case 'EEEE':
        return name({ weekday: 'long' });
      case 'ddd':
      case 'EEE':
        return name({ weekday: 'short' });
      case 'DD':
      case 'dd':
        return pad(day);
      case 'D':
      case 'd':
        return String(day);
      default:
        // [literal text]
        return token.slice(1, -1);
    }
  });
}
