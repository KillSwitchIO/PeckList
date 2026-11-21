// The app's date parser for quick add in the language it speaks (PL-148): English always, and the
// language's own chrono loaded only when it is wanted, so the other locales stay out of the app.
// The server's bundle imports all of them instead (quickAddServer.ts).
import { quickAddLanguage } from '../core/quickAddWords.ts';
import type { DateParser } from '../ports/dateParser.ts';
import { createChronoDateParser, type ChronoLocale } from './chrono-date-parser.ts';

type LocaleModule = { casual: ChronoLocale['casual'] };

const LOADERS: Readonly<Record<string, () => Promise<LocaleModule>>> = {
  de: () => import('chrono-node/de'),
  es: () => import('chrono-node/es'),
  fr: () => import('chrono-node/fr'),
};

/** How a caller fetches a split-off part, and again when it fails (the app's importAgain); by default, once. */
export type Fetch = <T>(load: () => Promise<T>) => Promise<T>;

/**
 * A date parser for `language` (its base: "de-AT" reads German), English alone for one quick add
 * doesn't read. `complete` is false when the language's own chrono failed to load and the parser
 * reads English only: the caller should not keep that one, and ask again later (PL-148, offline).
 */
export async function loadLocaleDateParser(
  language: string,
  fetch: Fetch = (load) => load(),
): Promise<{ parser: DateParser; complete: boolean }> {
  const base = quickAddLanguage(language);
  const load = LOADERS[base];
  if (!load) return { parser: createChronoDateParser(), complete: true };
  try {
    const { casual } = await fetch(load);
    return { parser: createChronoDateParser({ language: base, casual }), complete: true };
  } catch {
    return { parser: createChronoDateParser(), complete: false };
  }
}

/** {@link loadLocaleDateParser}'s parser alone: a locale that fails to load gives English, as before PL-148. */
export async function loadDateParser(language: string): Promise<DateParser> {
  return (await loadLocaleDateParser(language)).parser;
}
