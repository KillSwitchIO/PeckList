// Quick add's date parser, split off the app's first load (PL-148: in the language the app speaks,
// with English).
import type { DateParser } from '../../ports/dateParser.ts';
import { currentLanguage } from '../i18n/i18n.ts';
import { importAgain } from '../loadOnce.ts';

type Locales = Pick<typeof import('../../adapters/chrono-locales.ts'), 'loadLocaleDateParser'>;

const importLocales = () => importAgain(() => import('../../adapters/chrono-locales.ts'));

/**
 * The date parser for a language, fetched once per language. A fetch that fails is not kept: the
 * next use tries again, by a new address (importAgain), so a moment without network does not
 * leave quick add reading no dates until the page is reloaded. The same goes one level down: a
 * language whose own chrono failed to load reads English for this use, and the next use fetches
 * the language again.
 */
export function quickAddParsers(
  load: () => Promise<Locales> = importLocales,
): (language: string) => Promise<DateParser> {
  const parsers = new Map<string, Promise<DateParser>>();
  const forget = (language: string, loading: Promise<DateParser>) => {
    if (parsers.get(language) === loading) parsers.delete(language);
  };
  return (language) => {
    const kept = parsers.get(language);
    if (kept) return kept;
    let complete = true;
    const loading = load()
      .then((locales) => locales.loadLocaleDateParser(language, importAgain))
      .then((loaded) => {
        complete = loaded.complete;
        return loaded.parser;
      });
    parsers.set(language, loading);
    loading.then(
      () => {
        if (!complete) forget(language, loading);
      },
      () => forget(language, loading),
    );
    return loading;
  };
}

export const loadQuickAddParser = quickAddParsers();

/**
 * Fetches the parser for the language the app speaks ahead of time (App.tsx, once the page is
 * idle), so quick add reads dates offline too. A service worker keeps the parser's files for an
 * installed app, but a page without one (a server over plain http, which the Android app allows
 * on a home network) has only what it already fetched.
 */
export function preloadQuickAddParser(): Promise<DateParser> {
  return loadQuickAddParser(currentLanguage());
}
