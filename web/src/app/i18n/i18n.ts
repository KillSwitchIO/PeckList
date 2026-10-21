// Minimal string catalog. Every user-facing string goes through t() so the app can be
// translated later (R-NFR-09). Swap for a full i18n library behind this function if needed.
import { en, type MessageKey } from './en.ts';

type Catalog = Record<MessageKey, string>;

let english: Catalog = en;
const catalogs: Record<string, Catalog> = { en };
let activeLocale = 'en';

function active(): Catalog {
  return catalogs[activeLocale] ?? english;
}

export function setLocale(locale: string): void {
  const language = locale.split('-')[0] ?? 'en';
  activeLocale = language in catalogs ? language : 'en';
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  // A missing string (an incomplete translation) falls back to English, then to the key,
  // instead of crashing the page.
  const message =
    (active()[key] as string | undefined) ?? (english[key] as string | undefined) ?? key;
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

// Dev only: take catalog edits in place. Without this, an open tab could keep the old catalog
// while components using new strings hot-reload, and show raw keys like "task.siblings".
if (import.meta.hot) {
  import.meta.hot.accept('./en.ts', (next) => {
    const updated = (next as { en?: Catalog } | undefined)?.en;
    if (updated) {
      english = updated;
      catalogs.en = updated;
    }
  });
}

export type { MessageKey };
