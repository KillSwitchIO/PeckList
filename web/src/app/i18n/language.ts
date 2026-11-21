// Which language the app speaks (PL-148): the person's choice in Settings (synced), or automatic,
// the first of the browser's languages there is a catalog for. A copy of the choice is kept on
// this device, so the next start paints in it before the workspace has loaded.
import { intlLocale, setIntlLocale } from '../../core/intl.ts';
import {
  currentLanguage,
  preferredLanguage,
  resolveLanguage,
  setLocale,
  setLocaleWithin,
} from './i18n.ts';

const DEVICE_KEY = 'pecklist.language';

/** Languages whose catalog a machine drafted and no person has checked yet. */
export const MACHINE_TRANSLATED: ReadonlySet<string> = new Set<string>();

/**
 * The browser's languages, most wanted first. Only real tags: a webview or a stand-in navigator
 * may give no list or no language at all, which means English rather than an error.
 */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  const listed = navigator.languages?.length ? navigator.languages : [navigator.language];
  return listed.filter((each): each is string => typeof each === 'string' && each.trim() !== '');
}

/** The catalog a choice speaks: the picked language, or automatic (null) from the browser. */
export function languageFor(choice: string | null): string {
  return choice ? resolveLanguage(choice) : preferredLanguage(browserLanguages());
}

/** The choice this device last saw, for the first paint; null: automatic. */
export function rememberedChoice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY) || null;
  } catch {
    return null;
  }
}

function remember(choice: string | null) {
  try {
    if (choice) localStorage.setItem(DEVICE_KEY, choice);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Private windows and blocked storage: the next start uses the browser's language first.
  }
}

/** Counts the choices made, so only the latest one sets dates once its catalog is in. */
let latestChoice = 0;

/**
 * Speak `choice` from now on: t() in its catalog (loaded first if needed), dates and numbers in it
 * when it was picked, or in the browser's own locale when it is automatic. `limit` bounds the
 * wait, for the first paint. Resolves once both have switched.
 */
export async function applyLanguageChoice(choice: string | null, limit?: number): Promise<string> {
  const request = ++latestChoice;
  remember(choice);
  const target = languageFor(choice);
  const spoken = await (limit === undefined ? setLocale(target) : setLocaleWithin(target, limit));
  // A later choice made while this catalog loaded decides the dates (Dev 1): French still loading
  // when German, cached, is picked must not leave German strings with the browser's dates.
  if (request !== latestChoice) return currentLanguage();
  // A picked language whose catalog did not load stays wholly English, dates included.
  setIntlLocale(choice && spoken === target ? choice : undefined);
  return spoken;
}

/** What the page shows now, as one value: the catalog and the date locale. */
export function shownLanguage(): string {
  return `${currentLanguage()}|${intlLocale() ?? ''}`;
}

/** A language's name in itself, as a picker lists it: "Deutsch", "Português (Brasil)". */
export function ownName(language: string): string {
  try {
    const name = new Intl.DisplayNames([language], { type: 'language' }).of(language) ?? language;
    return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
  } catch {
    return language;
  }
}
