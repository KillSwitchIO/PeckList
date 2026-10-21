import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewport, renderApp } from '../test/renderApp.tsx';
import { setLocale, t } from './i18n/i18n.ts';
import { activeItem, SIDEBAR_ITEMS } from './layout/navigation.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('app shell', () => {
  it('redirects / to Today and shows the empty state', async () => {
    mockViewport('desktop');
    await renderApp('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('All punched out.')).toBeInTheDocument();
  });

  it('shows the permanent sidebar on desktop and navigates', async () => {
    mockViewport('desktop');
    await renderApp('/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByText('Inbox'));
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('nav.openMenu') })).not.toBeInTheDocument();
  });

  it('uses bottom navigation on phones', async () => {
    mockViewport('phone');
    await renderApp('/today');
    expect(screen.queryByRole('button', { name: t('nav.openMenu') })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('This view arrives in milestone 0.3.')).toBeInTheDocument();
  });

  it('opens a drawer from the menu button on tablets', async () => {
    mockViewport('tablet');
    await renderApp('/today');
    await userEvent.click(screen.getByRole('button', { name: t('nav.openMenu') }));
    await userEvent.click(await screen.findByText('Trash'));
    // The drawer hides the page from assistive tech until its exit transition ends.
    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument();
  });

  it('cycles the theme mode and remembers it', async () => {
    mockViewport('desktop', true);
    await renderApp('/today');
    const toggle = screen.getByRole('button', { name: /switch theme \(currently system\)/i });
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: /currently light/i })).toBeInTheDocument();
    expect(localStorage.getItem('punchlist.themeMode')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: /currently light/i }));
    expect(screen.getByRole('button', { name: /currently dark/i })).toBeInTheDocument();
  });

  it('restores a stored theme mode', async () => {
    mockViewport('desktop');
    localStorage.setItem('punchlist.themeMode', 'dark');
    await renderApp('/today');
    expect(screen.getByRole('button', { name: /currently dark/i })).toBeInTheDocument();
  });

  it('shows a not-found page', async () => {
    mockViewport('desktop');
    await renderApp('/nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('navigation helpers', () => {
  it('matches nested paths to their nav item', () => {
    expect(activeItem(SIDEBAR_ITEMS, '/inbox/123')).toBe('/inbox');
    expect(activeItem(SIDEBAR_ITEMS, '/elsewhere')).toBe(false);
  });
});

describe('i18n', () => {
  it('interpolates parameters and falls back to English', () => {
    setLocale('fr-FR');
    expect(t('empty.comingSoon', { milestone: '0.3' })).toBe('This view arrives in milestone 0.3.');
    expect(t('empty.comingSoon')).toBe('This view arrives in milestone {milestone}.');
    setLocale('en');
  });
});
