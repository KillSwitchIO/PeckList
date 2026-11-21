import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  availableLanguages,
  currentLanguage,
  onLanguageChange,
  preferredLanguage,
  registerLanguage,
  resolveLanguage,
  setLocale,
  setLocaleWithin,
  t,
  type Catalog,
  type MessageKey,
} from './i18n.ts';

afterEach(async () => {
  vi.useRealTimers();
  await setLocale('en');
});

describe('t', () => {
  it('fills parameters', () => {
    expect(t('tag.preview', { path: 'home/yard' })).toBe('Will be saved as home/yard');
  });

  it('falls back to the key instead of crashing on a missing string', () => {
    expect(t('missing.key' as MessageKey)).toBe('missing.key');
  });

  it('keeps a parameter that was not given', () => {
    expect(t('calendar.openMonth')).toBe('Open {month}');
  });
});

describe('languages (PL-148)', () => {
  it('loads a language only when it is picked, once, and falls back to English per key', async () => {
    const load = vi.fn(async (): Promise<Catalog> => ({ 'nav.today': 'Heute' }));
    registerLanguage('xa', load);
    expect(load).not.toHaveBeenCalled();
    expect(t('nav.today')).toBe('Today');

    await expect(setLocale('xa-DE')).resolves.toBe('xa');
    expect(currentLanguage()).toBe('xa');
    expect(t('nav.today')).toBe('Heute');
    expect(t('nav.inbox')).toBe('Mess Drawer');

    await setLocale('en');
    expect(t('nav.today')).toBe('Today');
    await setLocale('xa');
    expect(t('nav.today')).toBe('Heute');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("formats a language's plurals by its own rules", async () => {
    registerLanguage('pl', async () => ({
      'tasks.showMore':
        '{count, plural, one {# zadanie} few {# zadania} many {# zadań} other {# zadania}}',
    }));
    await setLocale('pl');
    expect(t('tasks.showMore', { count: 1 })).toBe('1 zadanie');
    expect(t('tasks.showMore', { count: 3 })).toBe('3 zadania');
    expect(t('tasks.showMore', { count: 5 })).toBe('5 zadań');
  });

  it('lets the later of two switches win', async () => {
    let finish: (catalog: Catalog) => void = () => {};
    registerLanguage('xc', () => new Promise<Catalog>((resolve) => (finish = resolve)));
    const slow = setLocale('xc');
    await setLocale('en');
    finish({ 'nav.today': 'Later' });
    await expect(slow).resolves.toBe('en');
    expect(currentLanguage()).toBe('en');
    expect(t('nav.today')).toBe('Today');
  });

  it('shares one load between two switches to the same language', async () => {
    let finish: (catalog: Catalog) => void = () => {};
    const load = vi.fn(() => new Promise<Catalog>((resolve) => (finish = resolve)));
    registerLanguage('xh', load);
    const first = setLocale('xh');
    const second = setLocale('xh');
    finish({ 'nav.today': 'Shared' });
    await expect(Promise.all([first, second])).resolves.toEqual(['xh', 'xh']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(t('nav.today')).toBe('Shared');
  });

  it('says the language it ended on when a load fails after a later switch', async () => {
    let fail: (error: Error) => void = () => {};
    registerLanguage('xi', () => new Promise<Catalog>((_, reject) => (fail = reject)));
    registerLanguage('xj', async () => ({ 'nav.today': 'Jay' }));
    const stale = setLocale('xi');
    await setLocale('xj');
    fail(new Error('offline'));
    await expect(stale).resolves.toBe('xj');
    expect(t('nav.today')).toBe('Jay');
  });

  it('starts in English when the first language takes longer than the limit', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let finish: (catalog: Catalog) => void = () => {};
    registerLanguage('xk', () => new Promise<Catalog>((resolve) => (finish = resolve)));
    const settled = setLocaleWithin('xk', 3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(settled).resolves.toBe('en');
    finish({ 'nav.today': 'Too late' });
    await vi.advanceTimersByTimeAsync(0);
    expect(currentLanguage()).toBe('en');
    expect(t('nav.today')).toBe('Today');
    // Cached now: next time it is there at once.
    await expect(setLocaleWithin('xk', 3_000)).resolves.toBe('xk');
  });

  it('takes a language that loads within the limit', async () => {
    registerLanguage('xl', async () => ({ 'nav.today': 'Quick' }));
    await expect(setLocaleWithin('xl', 3_000)).resolves.toBe('xl');
    expect(t('nav.today')).toBe('Quick');
  });

  it('stays in English when a catalog fails to load', async () => {
    registerLanguage('xd', () => Promise.reject(new Error('offline')));
    await expect(setLocale('xd')).resolves.toBe('en');
    expect(t('nav.today')).toBe('Today');
  });

  it('tells listeners when the language changes, and only then', async () => {
    registerLanguage('xe', async () => ({}));
    const heard: string[] = [];
    const stop = onLanguageChange((language) => heard.push(language));
    await setLocale('xe');
    await setLocale('xe');
    await setLocale('en');
    stop();
    await setLocale('xe');
    expect(heard).toEqual(['xe', 'en']);
  });

  it('resolves a locale to its exact catalog, then its base language, then English', () => {
    registerLanguage('xf', async () => ({}));
    registerLanguage('xf-BR', async () => ({}));
    expect(resolveLanguage('xf-BR')).toBe('xf-BR');
    expect(resolveLanguage('xf_br')).toBe('xf-BR');
    expect(resolveLanguage('xf_BR_x')).toBe('xf');
    expect(resolveLanguage('xf-PT')).toBe('xf');
    expect(resolveLanguage('zz-ZZ')).toBe('en');
  });

  it("picks the first of the browser's languages there is a catalog for", () => {
    registerLanguage('xg', async () => ({}));
    expect(preferredLanguage(['zz', 'xg-CH', 'en-US'])).toBe('xg');
    expect(preferredLanguage(['en-GB', 'xg'])).toBe('en');
    expect(preferredLanguage(['zz'])).toBe('en');
    expect(preferredLanguage([])).toBe('en');
  });

  it('has a loader for every catalog file in locales/', () => {
    const files = readdirSync('src/app/i18n/locales').filter((name) => name.endsWith('.json'));
    expect(files).toContain('en.json');
    for (const file of files) {
      expect(availableLanguages()).toContain(file.slice(0, -'.json'.length));
    }
  });
});
