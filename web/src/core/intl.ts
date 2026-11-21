// Intl formatters cost far more to make than to use, and views format a date for every task on
// every render: one formatter per locale and set of options, kept for the session.
//
// The locale dates and numbers use (PL-148): the language the person picked in Settings, or,
// when it is automatic (undefined), the browser's own, so someone on an en-GB browser keeps their
// day-first dates even though the app speaks plain English.

let preferred: string | undefined;

/** Dates and numbers follow this locale from now on; undefined: the browser's. */
export function setIntlLocale(locale: string | undefined): void {
  preferred = locale;
}

/** The locale dates and numbers use, for `toLocaleString(intlLocale())` and the like. */
export function intlLocale(): string | undefined {
  return preferred;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** `new Intl.DateTimeFormat(locale, options)`, made once; no locale means the one set above. */
export function dateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const used = locale ?? preferred;
  const key = `${used ?? ''}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(used, options);
    formats.set(key, format);
  }
  return format;
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
