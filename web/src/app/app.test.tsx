import { render, screen, within } from '@testing-library/react';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { createMemoryStorage } from '../adapters/memory-storage.ts';
import { createUlidGenerator } from '../adapters/ulid-ids.ts';
import { createWorkspaceStore } from './store/workspaceStore.ts';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers.tsx';
import { setLocale, t } from './i18n/i18n.ts';
import { activeItem, SIDEBAR_ITEMS } from './layout/navigation.tsx';
import { AppRoutes } from './routes.tsx';

type Viewport = 'phone' | 'tablet' | 'desktop';
const WIDTH: Record<Viewport, number> = { phone: 390, tablet: 800, desktop: 1400 };

/** jsdom has no layout: answer MUI's width queries for the chosen viewport. */
function mockViewport(viewport: Viewport, prefersDark = false) {
  const width = WIDTH[viewport];
  vi.stubGlobal('matchMedia', (query: string) => {
    let matches = false;
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    if (min || max) {
      matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    } else if (query.includes('prefers-color-scheme: dark')) {
      matches = prefersDark;
    }
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
  });
}

function testStore() {
  return createWorkspaceStore({
    storage: createMemoryStorage(),
    validator: createAjvValidator(),
    ids: createUlidGenerator(),
    node: 'test',
  });
}

async function renderAt(path: string, store = testStore()) {
  const result = render(
    <AppProviders store={store}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1 });
  return result;
}

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('app shell', () => {
  it('redirects / to Today and shows the empty state', async () => {
    mockViewport('desktop');
    await renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('All punched out.')).toBeInTheDocument();
  });

  it('shows the permanent sidebar on desktop and navigates', async () => {
    mockViewport('desktop');
    await renderAt('/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByText('Inbox'));
    expect(screen.getByRole('heading', { level: 1, name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('nav.openMenu') })).not.toBeInTheDocument();
  });

  it('uses bottom navigation on phones', async () => {
    mockViewport('phone');
    await renderAt('/today');
    expect(screen.queryByRole('button', { name: t('nav.openMenu') })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByText('This view arrives in milestone 0.3.')).toBeInTheDocument();
  });

  it('opens a drawer from the menu button on tablets', async () => {
    mockViewport('tablet');
    await renderAt('/today');
    await userEvent.click(screen.getByRole('button', { name: t('nav.openMenu') }));
    await userEvent.click(await screen.findByText('Trash'));
    // The drawer hides the page from assistive tech until its exit transition ends.
    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument();
  });

  it('cycles the theme mode and remembers it', async () => {
    mockViewport('desktop', true);
    await renderAt('/today');
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
    await renderAt('/today');
    expect(screen.getByRole('button', { name: /currently dark/i })).toBeInTheDocument();
  });

  it('shows a not-found page', async () => {
    mockViewport('desktop');
    await renderAt('/nope');
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
