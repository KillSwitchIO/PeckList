// The app's date parser for quick add in the language it speaks (PL-148): English always, and the
// language's own chrono loaded only when it is wanted, so the other locales stay out of the app.
// The server's bundle imports all of them instead (quickAddServer.ts).
import { quickAddLanguage } from '../core/quickAddWords.ts';
import type { DateParser } from '../ports/dateParser.ts';
import { createChronoDateParser, type ChronoLocale } from './chrono-date-parser.ts';

const LOADERS: Readonly<Record<string, () => Promise<ChronoLocale['casual']>>> = {
  de: () => import('chrono-node/de').then((module) => module.casual),
  es: () => import('chrono-node/es').then((module) => module.casual),
  fr: () => import('chrono-node/fr').then((module) => module.casual),
};

/**
 * A date parser for `language` (its base: "de-AT" reads German), English alone for one quick add
 * doesn't read. A locale that fails to load gives the English parser, as before PL-148.
 */
export async function loadDateParser(language: string): Promise<DateParser> {
  const base = quickAddLanguage(language);
  const load = LOADERS[base];
  if (!load) return createChronoDateParser();
  try {
    return createChronoDateParser({ language: base, casual: await load() });
  } catch {
    return createChronoDateParser();
  }
}
