// Minimal string catalog. Every user-facing string goes through t() so the app can be
// translated later (R-NFR-09). Swap for a full i18n library behind this function if needed.
import { en, type MessageKey } from './en.ts';

const catalogs: Record<string, Record<MessageKey, string>> = { en };
let active: Record<MessageKey, string> = en;

export function setLocale(locale: string): void {
  active = catalogs[locale.split('-')[0] ?? 'en'] ?? en;
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  // A missing string (a catalog behind the code, e.g. a stale dev reload or an incomplete
  // translation) falls back to English, then to the key, instead of crashing the page.
  const message = (active[key] as string | undefined) ?? (en[key] as string | undefined) ?? key;
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export type { MessageKey };
