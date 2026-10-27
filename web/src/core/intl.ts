// Intl formatters cost far more to make than to use, and views format a date for every task on
// every render: one formatter per locale and set of options, kept for the session.

const formats = new Map<string, Intl.DateTimeFormat>();

/** `new Intl.DateTimeFormat(locale, options)`, made once. */
export function dateTimeFormat(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    formats.set(key, format);
  }
  return format;
}
