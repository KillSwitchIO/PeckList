// ICU MessageFormat through intl-messageformat (FormatJS). Only messages with an ICU argument
// (`{count, plural, ...}`, `select`, `number`...) are parsed, once per locale and message; the rest
// take the plain path, which keeps a missing `{name}` visible the way t() always has.
import { IntlMessageFormat } from 'intl-messageformat';
import type { MessageFormatter } from '../ports/messageFormat.ts';
import { fillPlain } from './plain-message-format.ts';

const ICU_ARGUMENT = /\{\s*\w+\s*,\s*(plural|selectordinal|select|number|date|time)\b/;

// null: the message did not parse, so it takes the plain path from then on.
const parsed = new Map<string, IntlMessageFormat | null>();

function compiled(message: string, locale: string): IntlMessageFormat | null {
  const key = `${locale}\u0000${message}`;
  let format = parsed.get(key);
  if (format === undefined) {
    try {
      format = new IntlMessageFormat(message, locale);
    } catch {
      format = null;
    }
    parsed.set(key, format);
  }
  return format;
}

export const icuMessageFormat: MessageFormatter = {
  format(message, params, locale) {
    if (!ICU_ARGUMENT.test(message)) return fillPlain(message, params);
    const format = compiled(message, locale);
    if (format) {
      try {
        const text = format.format(params);
        if (typeof text === 'string') return text;
      } catch {
        // A parameter the message needs was not given: fall through to the plain fill.
      }
    }
    return fillPlain(message, params);
  },
};
