import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { AppRoutes } from '../routes.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { forgetViewAs, takeViewAs, ViewAsContext } from './viewAs.ts';

afterEach(() => {
  forgetViewAs();
  window.history.replaceState(null, '', '/');
});

describe('viewing as someone', () => {
  it('takes the token from the address once, keeps it for this tab, and clears the address', () => {
    window.history.replaceState(null, '', '/today#view-as=abc%2Bdef&name=sam');
    expect(takeViewAs()).toEqual({ token: 'abc+def', username: 'sam' });
    expect(window.location.hash).toBe('');
    // A reload of this tab still knows.
    expect(takeViewAs()).toEqual({ token: 'abc+def', username: 'sam' });
    forgetViewAs();
    expect(takeViewAs()).toBeNull();
  });

  it('when the view runs out it offers the way back instead of a sign-in', async () => {
    const backend = new FakeBackend();
    const store = testStore();
    const sync = createSyncEngine({
      transport: backend.device(),
      workspace: store,
      storage: createMemoryStorage(),
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    render(
      <ViewAsContext.Provider value={{ token: 't', username: 'sam' }}>
        <AppProviders store={store} sync={sync}>
          <MemoryRouter initialEntries={['/today']}>
            <AppRoutes />
          </MemoryRouter>
        </AppProviders>
      </ViewAsContext.Provider>,
    );
    expect(await screen.findByRole('heading', { name: 'This view has ended' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to admin' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in to Punchlist' })).toBeNull();
  });
});
