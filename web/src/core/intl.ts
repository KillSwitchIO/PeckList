// Intl formatters cost far more to make than to use, and views format a date for every task on
// every render: one formatter per locale and set of options, kept for the session.
//
// The locale dates and numbers use (PL-148): the language the person picked in Settings, or,
// when it is automatic (undefined), the browser's own, so someone on an en-GB browser keeps their
// day-first dates even though the app speaks plain English.

let preferred: string | undefined;

/**
 * Dates and numbers follow this locale from now on; undefined: the browser's. A tag Intl rejects
 * falls back to its language alone, else the browser's: the synced setting's pattern lets through
 * tags such as `en-12`, and one written by the API or a script must not make every formatter throw
 * in every render, on every device, with Settings out of reach.
 */
export function setIntlLocale(locale: string | undefined): void {
  preferred = [locale, locale?.split(/[-_]/)[0]].find(accepted);
}

function accepted(tag: string | undefined): tag is string {
  if (!tag) return false;
  try {
    Intl.getCanonicalLocales(tag);
    return true;
  } catch {
    return false;
  }
}

/** The locale dates and numbers use, for `toLocaleString(intlLocale())` and the like. */
export function intlLocale(): string | undefined {
  return preferred;
}

const clocks = new Map<string, boolean>();

let phoneClock: boolean | undefined;
const phoneClockListeners = new Set<() => void>();

/**
 * The phone's own 12/24-hour setting (the Android shell's info, api 17), which an automatic clock
 * follows on a phone ahead of the language (Manager, rc.2: it is the person's own word on it).
 * Undefined: a browser, or an older shell.
 */
export function setPhoneClock(twentyFour: boolean | undefined): void {
  if (twentyFour === phoneClock) return;
  phoneClock = twentyFour;
  for (const listener of phoneClockListeners) listener();
}

/** The phone's 12/24-hour setting as last told, for useSyncExternalStore. */
export function phoneClockSetting(): boolean | undefined {
  return phoneClock;
}

/** Calls `listener` when the phone's setting changes; returns the unsubscribe. */
export function onPhoneClock(listener: () => void): () => void {
  phoneClockListeners.add(listener);
  return () => {
    phoneClockListeners.delete(listener);
  };
}

/**
 * Whether a locale's own clock is 24-hour (de, es, fr, en-GB) rather than 12-hour (en-US): what an
 * automatic clock follows off a phone (schema 22). No locale means the one set above, else the
 * browser's. A tag Intl rejects (the schema allows `en-12`, which Intl does not) reads 12-hour
 * rather than throwing in a render.
 */
export function localeUses24h(locale?: string): boolean {
  const used = locale ?? preferred;
  const key = used ?? '';
  let known = clocks.get(key);
  if (known === undefined) {
    try {
      const cycle = new Intl.DateTimeFormat(used, { hour: 'numeric' }).resolvedOptions().hourCycle;
      known = cycle === 'h23' || cycle === 'h24';
    } catch {
      known = false;
    }
    clocks.set(key, known);
  }
  return known;
}

let browserClock: boolean | undefined;

/**
 * Whether the browser's own default reads 24-hour, whatever language is picked: what a browser's
 * push subscription reports (schema 22). The server applies it on an automatic language only, where
 * the app shows this same clock; a picked language reads its own there (Dev 1).
 */
export function browserUses24h(): boolean {
  if (browserClock === undefined) {
    try {
      const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions()
        .hourCycle;
      browserClock = cycle === 'h23' || cycle === 'h24';
    } catch {
      browserClock = false;
    }
  }
  return browserClock;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/**
 * French writes the first of a month "1er" beside the month's name ("1er déc.", "lun. 1er
 * décembre"), which Intl doesn't (PL-148). Not in numbers ("01/12/2026"), and not a day number
 * with no month beside it (a calendar's grid).
 */
export function withFirstOfMonth<Part extends Intl.DateTimeFormatPart>(parts: Part[]): Part[] {
  const named = parts.some((part) => part.type === 'month' && /\p{L}/u.test(part.value));
  if (!named) return parts;
  return parts.map((part) =>
    part.type === 'day' && part.value === '1' ? { ...part, value: '1er' } : part,
  );
}

type DateTimeFormatClass = new (
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
) => Intl.DateTimeFormat;

let french: DateTimeFormatClass | undefined;

/**
 * Intl's dates, with French's "1er" (withFirstOfMonth) in all four ways of formatting. Made on
 * first use, not at load: the server's quick add runs this module where Intl may be missing.
 */
function frenchDateTimeFormat(): DateTimeFormatClass {
  french ??= class FrenchDateTimeFormat extends Intl.DateTimeFormat {
    override formatToParts(date?: Date | number): Intl.DateTimeFormatPart[] {
      return withFirstOfMonth(super.formatToParts(date));
    }
    // A method, not Intl's bound getter: call it on the format, never detached (`fmt.format`).
    override format(date?: Date | number): string {
      const text = super.format(date);
      // Most dates have no lone 1 to change: those skip the parts (Dev 1, about twice as fast).
      if (!/(^|\D)1(\D|$)/.test(text)) return text;
      return this.formatToParts(date)
        .map((part) => part.value)
        .join('');
    }
    override formatRangeToParts(
      start: Date | number | bigint,
      end: Date | number | bigint,
    ): Intl.DateTimeRangeFormatPart[] {
      return withFirstOfMonth(super.formatRangeToParts(start, end));
    }
    override formatRange(start: Date | number | bigint, end: Date | number | bigint): string {
      return this.formatRangeToParts(start, end)
        .map((part) => part.value)
        .join('');
    }
  };
  return french;
}

/** Calendars whose months and days are Gregorian, only the year numbered differently. */
// Not ISO 8601: ICU prints no month names in it (" 1" for Dec 1 in en-GB; Dev 1).
const GREGORIAN_MONTHS = new Set(['gregory', 'buddhist', 'japanese', 'roc']);

/**
 * `new Intl.DateTimeFormat(locale, options)`, made once; no locale means the one set above. Every
 * date in the app is Gregorian (due dates, the month grid), so a locale whose own calendar has
 * other months (Persian, Islamic, Hebrew, Chinese) gets the Gregorian one, still named in its
 * language and digits: fa's own would name months the grid doesn't have (Dev 1, PL-148). One with
 * Gregorian months keeps its own year (Thai's Buddhist 2569, Manager): the year rules compare
 * Gregorian years, and only the number shown differs.
 */
export function dateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const used = locale ?? preferred;
  const key = `${used ?? ''}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    let made = options;
    format = new Intl.DateTimeFormat(used, made);
    if (!GREGORIAN_MONTHS.has(format.resolvedOptions().calendar)) {
      made = { ...options, calendar: 'gregory' };
      format = new Intl.DateTimeFormat(used, made);
    }
    if (format.resolvedOptions().locale.split('-')[0] === 'fr') {
      format = new (frenchDateTimeFormat())(used, made);
    }
    formats.set(key, format);
  }
  return format;
}

/** A date in the language set above (`toLocaleDateString`, with French's "1er" too). */
export function formatDateIn(
  date: Date | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return dateTimeFormat(undefined, options).format(date);
}

/**
 * A date format to keep at module level that still follows the language: each call formats in
 * the locale set at that moment, not the one when the module loaded.
 */
export function localeDateFormat(
  options: Intl.DateTimeFormatOptions,
): Pick<Intl.DateTimeFormat, 'format' | 'formatToParts'> {
  return {
    format: (date) => dateTimeFormat(undefined, options).format(date),
    formatToParts: (date) => dateTimeFormat(undefined, options).formatToParts(date),
  };
}

const collators = new Map<string, Intl.Collator>();

/** `new Intl.Collator(locale, options)` in the locale set above, made once. */
export function collator(options: Intl.CollatorOptions): Intl.Collator {
  const key = `${preferred ?? ''}|${JSON.stringify(options)}`;
  let made = collators.get(key);
  if (!made) {
    made = new Intl.Collator(preferred, options);
    collators.set(key, made);
  }
  return made;
}
