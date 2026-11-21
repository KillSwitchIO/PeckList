// The plain formatter: fills `{name}` parameters and nothing else (no plurals or selects). What
// t() always did, and the ICU adapter's path for the many messages that need nothing more.
import type { MessageFormatter, MessageParams } from '../ports/messageFormat.ts';

export function fillPlain(message: string, params: MessageParams): string {
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export const plainMessageFormat: MessageFormatter = {
  format: (message, params) => fillPlain(message, params),
};
