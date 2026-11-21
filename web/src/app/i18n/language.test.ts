import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { intlLocale, setIntlLocale } from '../../core/intl.ts';
import { currentLanguage, registerLanguage, setLocale } from './i18n.ts';
import { applyLanguageChoice, languageFor, ownName, rememberedChoice } from './language.ts';

registerLanguage('de', async () => ({ 'nav.today': 'Heute' }));
registerLanguage('fr', () => Promise.reject(new Error('offline')));
// Loads only when a test lets it.
let finishSlow: (catalog: Record<string, string>) => void = () => undefined;
registerLanguage(
  'sv',
  () =>
    new Promise((done) => {
      finishSlow = done;
    }),
);

beforeEach(() => localStorage.clear());
afterEach(async () => {
  vi.unstubAllGlobals();
  setIntlLocale(undefined);
  await setLocale('en');
});

describe('the language choice (PL-148)', () => {
  it('a picked language sets the strings, the dates and the copy on this device', async () => {
    await expect(applyLanguageChoice('de')).resolves.toBe('de');
    expect(currentLanguage()).toBe('de');
    expect(intlLocale()).toBe('de');
    expect(rememberedChoice()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });

  it('automatic takes the browser’s language and leaves dates to the browser', async () => {
    vi.stubGlobal('navigator', { ...navigator, languages: ['de-CH', 'en'] });
    await applyLanguageChoice('de');
    await expect(applyLanguageChoice(null)).resolves.toBe('de');
    expect(intlLocale()).toBeUndefined();
    expect(rememberedChoice()).toBeNull();
    expect(languageFor(null)).toBe('de');
  });

  it('automatic means English when the browser names no language', () => {
    // A webview, or a stand-in navigator that copied none of the browser's own getters.
    vi.stubGlobal('navigator', { ...navigator, languages: undefined, language: undefined });
    expect(languageFor(null)).toBe('en');
    vi.stubGlobal('navigator', { ...navigator, languages: [], language: '' });
    expect(languageFor(null)).toBe('en');
  });

  it('a choice still loading when a later one is made leaves the later one’s dates', async () => {
    const slow = applyLanguageChoice('sv');
    await expect(applyLanguageChoice('de')).resolves.toBe('de');
    finishSlow({ 'nav.today': 'Idag' });
    await slow;
    expect(currentLanguage()).toBe('de');
    expect(intlLocale()).toBe('de');
  });

  it('keeps an English region picked outright for dates', async () => {
    await expect(applyLanguageChoice('en-GB')).resolves.toBe('en');
    expect(intlLocale()).toBe('en-GB');
  });

  it('stays wholly English, dates too, when the picked catalog does not load', async () => {
    await expect(applyLanguageChoice('fr')).resolves.toBe('en');
    expect(intlLocale()).toBeUndefined();
  });

  it('names a language in itself', () => {
    expect(ownName('de')).toBe('Deutsch');
    expect(ownName('es')).toBe('Español');
    expect(ownName('fr')).toBe('Français');
    expect(ownName('pt-BR')).toBe('Português (Brasil)');
  });
});
