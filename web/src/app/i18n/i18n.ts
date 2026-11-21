// The string catalog (R-NFR-09, PL-148). Every user-facing string goes through t(). English
// (locales/en.json) is the source and is always loaded; other languages are one JSON file each in
// locales/, loaded as their own chunk only when picked. A key a language lacks shows the English
// text. Messages use ICU MessageFormat through the MessageFormatter port.
import { icuMessageFormat } from '../../adapters/icu-message-format.ts';
import type { MessageFormatter, MessageParams } from '../../ports/messageFormat.ts';
import en from './locales/en.json';

export type MessageKey = keyof typeof en;
export type Catalog = Partial<Record<MessageKey, string>>;

const SOURCE = 'en';
let english: Catalog = en;
const formatter: MessageFormatter = icuMessageFormat;

// Every language file but English, as a lazy import (Vite makes each its own chunk).
const loaders = new Map<string, () => Promise<Catalog>>(
  Object.entries(
    import.meta.glob<Catalog>(['./locales/*.json', '!./locales/en.json'], { import: 'default' }),
  ).map(([path, load]) => [path.slice('./locales/'.length, -'.json'.length), load]),
);
const loaded = new Map<string, Catalog>([[SOURCE, en]]);
// Loads under way, so two switches to the same language share one fetch.
const loading = new Map<string, Promise<Catalog>>();
let activeLanguage = SOURCE;
let active: Catalog = en;
let latestRequest = 0;
let latestLanguage = SOURCE;
const listeners = new Set<(language: string) => void>();

/** Add a language's catalog loader (the bundled files register themselves; tests add their own). */
export function registerLanguage(language: string, load: () => Promise<Catalog>): void {
  loaders.set(language, load);
  loaded.delete(language);
  loading.delete(language);
}

/** The languages there is a catalog for, English first. */
export function availableLanguages(): string[] {
  return [SOURCE, ...[...loaders.keys()].sort()];
}

/**
 * The catalog for a BCP 47 locale: the exact one ("pt-BR"), else its base language ("pt"), else
 * English.
 */
export function resolveLanguage(locale: string): string {
  const wanted = locale.trim().replaceAll('_', '-').toLowerCase();
  const known = availableLanguages();
  const exact = known.find((each) => each.toLowerCase() === wanted);
  if (exact) return exact;
  const base = wanted.split('-')[0] ?? '';
  return known.find((each) => each.toLowerCase() === base) ?? SOURCE;
}

/**
 * The first of the browser's languages (`navigator.languages`, most wanted first) there is a
 * catalog for: ["fr-CA", "de"] gives "fr" if there is French, else "de". An English entry before
 * any other match means English.
 */
export function preferredLanguage(locales: readonly string[]): string {
  for (const locale of locales) {
    const language = resolveLanguage(locale);
    if (language !== SOURCE || locale.toLowerCase().startsWith(SOURCE)) return language;
  }
  return SOURCE;
}

/** The language t() speaks now. */
export function currentLanguage(): string {
  return activeLanguage;
}

function activate(language: string, catalog: Catalog) {
  const changed = language !== activeLanguage;
  activeLanguage = language;
  active = catalog;
  if (changed) for (const listener of listeners) listener(language);
}

/**
 * Switch t() to the catalog for `locale`, loading it first if it isn't yet. English and loaded
 * languages switch at once; the promise says which language it settled on. When two calls race,
 * the later one wins. A catalog that fails to load leaves English.
 */
export function setLocale(locale: string): Promise<string> {
  const language = resolveLanguage(locale);
  const request = ++latestRequest;
  latestLanguage = language;
  const ready = loaded.get(language);
  if (ready) {
    activate(language, ready);
    return Promise.resolve(language);
  }
  const load = loaders.get(language);
  if (!load) {
    activate(SOURCE, english);
    return Promise.resolve(SOURCE);
  }
  let pending = loading.get(language);
  if (!pending) {
    pending = load().finally(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending.then(
    (catalog) => {
      loaded.set(language, catalog);
      // A later switch to another language wins; one to this same language shares this load.
      if (request !== latestRequest && latestLanguage !== language) return activeLanguage;
      activate(language, catalog);
      return language;
    },
    () => {
      if (request !== latestRequest && latestLanguage !== language) return activeLanguage;
      activate(SOURCE, english);
      return SOURCE;
    },
  );
}

/**
 * setLocale, but never waiting longer than `limit` ms: past it, t() stays in English and the late
 * catalog is dropped (it is used next time, once cached). For the first paint, which must not
 * wait on a slow network.
 */
export function setLocaleWithin(locale: string, limit = 3_000): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`Loading the ${locale} strings is taking long: starting in English`);
      resolve(setLocale(SOURCE));
    }, limit);
  });
  return Promise.race([setLocale(locale), late]).finally(() => clearTimeout(timer));
}

/** Called with the new language each time t() switches; returns the way to stop. */
export function onLanguageChange(listener: (language: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function t(key: MessageKey, params: MessageParams = {}): string {
  // A string the language lacks (an incomplete translation) falls back to English, then to the
  // key, instead of crashing the page.
  const translated = activeLanguage === SOURCE ? undefined : active[key];
  if (translated !== undefined) return formatter.format(translated, params, activeLanguage);
  return formatter.format(english[key] ?? key, params, SOURCE);
}

// Dev only: take catalog edits in place. Without this, an open tab could keep the old catalog
// while components using new strings hot-reload, and show raw keys like "task.siblings".
if (import.meta.hot) {
  import.meta.hot.accept('./locales/en.json', (next) => {
    const updated = (next as { default?: Catalog } | undefined)?.default;
    if (updated) {
      english = updated;
      loaded.set(SOURCE, updated);
      if (activeLanguage === SOURCE) active = updated;
    }
  });
}
