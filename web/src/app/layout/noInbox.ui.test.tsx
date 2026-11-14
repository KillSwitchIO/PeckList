import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace } from '../../core/workspace.ts';
import { testContext } from '../../test/fixtures.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** A store whose workspace has no Inbox yet, as on a new device before its first sync. */
async function storeWithoutInbox() {
  const store = testStore();
  await store.getState().init();
  const ws = createWorkspace(testContext());
  await store.getState().reset({ ...ws, entities: { ...ws.entities, lists: [] } });
  return store;
}

// Opening a page straight away on a new device (a settings link before the first sync) used to
// stop the whole app at "Something went wrong": the sidebar asked for the Inbox and it threw.
describe('a workspace with no Inbox yet', () => {
  it.each(['/settings', '/today', '/upcoming', '/calendar', '/all'])(
    'still opens %s, sidebar and all',
    async (path) => {
      await renderApp(path, await storeWithoutInbox());
      expect(screen.queryByText('Something went wrong')).toBeNull();
      expect(screen.getAllByRole('navigation')[0]).toHaveTextContent('Mess Drawer');
    },
  );

  it('shows the Mess Drawer page as waiting for the first sync, with nothing to add to', async () => {
    await renderApp('/inbox', await storeWithoutInbox());
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(
      screen.getByText('Your Mess Drawer shows up here once this device has synced.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /add/i })).toBeNull();
  });
});
