// The language picker (PL-148): Settings > Language and time > Language, synced, with automatic
// following the browser.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSettings } from '../../core/settings.ts';
import { registerLanguage, setLocale } from '../i18n/i18n.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

// A German catalog of a few strings: the rest falls back to English.
registerLanguage('de', async () => ({
  'settings.language': 'Sprache',
  'settings.category.dates': 'Sprache und Zeit',
  'nav.today': 'Heute',
}));

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

afterEach(async () => {
  await setLocale('en');
  document.documentElement.lang = 'en';
});

const subject = (name: RegExp) =>
  within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('link', { name });

const languageSelect = () => screen.findByRole('combobox', { name: /^(Language|Sprache)$/ });

describe('settings: language', () => {
  it('lists automatic first, then each language in its own name', async () => {
    await renderApp('/settings/dates', testStore());
    expect(await screen.findByRole('region', { name: 'Language' })).toBeInTheDocument();
    expect(subject(/^Language and time/)).toBeInTheDocument();
    const select = await languageSelect();
    expect(select).toHaveTextContent('Automatic (English)');
    await userEvent.click(select);
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Automatic (English)',
      'English',
      'Deutsch',
    ]);
  });

  it('picking a language syncs it, speaks it at once, and keeps a copy for the next start', async () => {
    const store = testStore();
    await renderApp('/settings/dates', store);
    await userEvent.click(await languageSelect());
    await userEvent.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: 'Deutsch' }),
    );

    expect(store.getState().workspace!.entities.settings[0]!.language).toBe('de');
    expect(await screen.findByRole('region', { name: 'Sprache' })).toBeInTheDocument();
    expect(subject(/^Sprache und Zeit/)).toBeInTheDocument();
    expect(await languageSelect()).toHaveTextContent('Deutsch');
    expect(document.documentElement.lang).toBe('de');
    expect(localStorage.getItem('pecklist.language')).toBe('de');

    await userEvent.click(await languageSelect());
    await userEvent.click(
      within(screen.getByRole('listbox')).getByRole('option', { name: 'Automatic (English)' }),
    );
    expect(store.getState().workspace!.entities.settings[0]!.language).toBeNull();
    expect(await screen.findByRole('region', { name: 'Language' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('pecklist.language')).toBeNull();
  });

  it('follows a language picked on another device when it syncs in', async () => {
    const store = testStore();
    await renderApp('/today', store);
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { language: 'de' })));
    expect(await screen.findByRole('heading', { name: 'Heute' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('de');
  });

  it('automatic takes the first browser language there is a catalog for', async () => {
    vi.stubGlobal('navigator', { ...navigator, languages: ['fr-CA', 'de-AT', 'en'] });
    await renderApp('/settings/dates', testStore());
    await waitFor(() => expect(document.documentElement.lang).toBe('de'));
    expect(await screen.findByRole('region', { name: 'Sprache' })).toBeInTheDocument();
    expect(await languageSelect()).toHaveTextContent('Automatic (Deutsch)');
  });
});
