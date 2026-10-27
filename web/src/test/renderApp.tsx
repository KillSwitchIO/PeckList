// Render the whole app (routes, store, theme) for UI tests.
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { createMemoryStorage } from '../adapters/memory-storage.ts';
import { createUlidGenerator } from '../adapters/ulid-ids.ts';
import { AppProviders } from '../app/providers.tsx';
import { preloadPages } from '../app/lazyPages.ts';
import { AppRoutes } from '../app/routes.tsx';
import { createAppTheme } from '../app/theme/theme.ts';
import { createWorkspaceStore, type WorkspaceStore } from '../app/store/workspaceStore.ts';
import type { SyncEngine } from '../app/sync/syncEngine.ts';

export type Viewport = 'phone' | 'tablet' | 'desktop';
const WIDTH: Record<Viewport, number> = { phone: 390, tablet: 800, desktop: 1400 };

/** jsdom has no layout: answer MUI's width queries for the chosen viewport. */
export function mockViewport(viewport: Viewport, prefersDark = false) {
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

export function testStore(): WorkspaceStore {
  return createWorkspaceStore({
    storage: createMemoryStorage(),
    validator: createAjvValidator(),
    ids: createUlidGenerator(),
    node: 'test',
  });
}

export async function renderApp(
  path: string,
  store: WorkspaceStore = testStore(),
  sync?: SyncEngine,
) {
  // Pages that load on first visit are fetched first, as the app does once idle.
  await preloadPages();
  const result = render(
    <AppProviders store={store} {...(sync ? { sync } : {})}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  // The first render in a file loads the lazy routes cold, slow on a shared runner with coverage.
  await screen.findByRole('heading', { level: 1 }, { timeout: 10_000 });
  return { ...result, store };
}

/** Render a component with the app theme (components read Punchlist's color tokens from it). */
export function renderThemed(ui: ReactElement) {
  const theme = createAppTheme('light');
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    ),
  });
}
