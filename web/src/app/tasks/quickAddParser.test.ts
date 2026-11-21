import { describe, expect, it } from 'vitest';
import { loadLocaleDateParser, type Fetch } from '../../adapters/chrono-locales.ts';
import { preloadQuickAddParser, quickAddParsers } from './quickAddParser.ts';

const NOW = new Date(2026, 10, 21, 10, 0);

const offline = () => new TypeError('Failed to fetch dynamically imported module');

/**
 * The parser's files over a network that works while `online` says so, counting the tries: the
 * outer part (chrono-locales) and, for a language with its own chrono, the locale's part.
 */
function network() {
  const state = { online: true, fetches: 0, localeFetches: 0 };
  const localeFetch: Fetch = (load) => {
    state.localeFetches += 1;
    return state.online ? load() : Promise.reject(offline());
  };
  const load = () => {
    state.fetches += 1;
    return state.online
      ? Promise.resolve({
          loadLocaleDateParser: (language: string) => loadLocaleDateParser(language, localeFetch),
        })
      : Promise.reject(offline());
  };
  return { state, load };
}

describe("quick add's date parser offline", () => {
  it('reads dates with no network once it was fetched ahead of time', async () => {
    const { state, load } = network();
    const parsers = quickAddParsers(load);
    await parsers('en');
    state.online = false;
    const parser = await parsers('en');
    expect(parser.find('Call mom tomorrow', NOW)).toHaveLength(1);
    expect(state.fetches).toBe(1);
  });

  it('does not keep a fetch that failed: the next use fetches again and reads dates', async () => {
    const { state, load } = network();
    const parsers = quickAddParsers(load);
    state.online = false;
    await expect(parsers('en')).rejects.toThrow(/dynamically imported module/);
    state.online = true;
    const parser = await parsers('en');
    expect(parser.find('Call mom tomorrow', NOW)).toHaveLength(1);
    expect(state.fetches).toBe(2);
  });

  it('reads English while the language’s own part did not load, and the language once it does', async () => {
    const { state, load } = network();
    // The outer part came while online; then the German part fails (offline, no service worker).
    const outer = await load();
    const parsers = quickAddParsers(() => Promise.resolve(outer));
    state.online = false;
    const english = await parsers('de');
    expect(english.find('Arzt morgen', NOW)).toHaveLength(0);
    expect(english.find('Doctor tomorrow', NOW)).toHaveLength(1);
    // Back online, the next use loads German instead of keeping English, and keeps that.
    state.online = true;
    expect((await parsers('de')).find('Arzt morgen', NOW)).toHaveLength(1);
    await parsers('de');
    expect(state.localeFetches).toBe(2);
  });

  it('fetches each language once', async () => {
    const { state, load } = network();
    const parsers = quickAddParsers(load);
    await Promise.all([parsers('de'), parsers('de'), parsers('en')]);
    expect(state.fetches).toBe(2);
    expect((await parsers('de')).find('Arzt morgen', NOW)).toHaveLength(1);
  });

  it('fetches ahead the parser for the language the app speaks', async () => {
    const parser = await preloadQuickAddParser();
    expect(parser.find('Call mom tomorrow 3pm', NOW)).toHaveLength(1);
  });
});
