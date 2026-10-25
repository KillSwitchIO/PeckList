import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('archiving a list', () => {
  it('moves it to Archived, keeps its tasks out of All, and brings it back', async () => {
    const store = testStore();
    await renderApp('/all', store);
    store.getState().apply((ctx, ws) => {
      const made = createList(ctx, ws, { name: 'Taxes 2025', color: '#F3E1A0' });
      return createTask(ctx, made.workspace, { title: 'File return', listId: made.list.id })
        .workspace;
    });
    expect(await screen.findByRole('button', { name: 'Open File return' })).toBeInTheDocument();
    const lists = () => screen.getByRole('list', { name: 'Lists' });
    await userEvent.click(within(lists()).getByText('Taxes 2025'));

    await userEvent.click(await screen.findByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive list' }));
    await waitFor(() => expect(within(lists()).queryByText('Taxes 2025')).toBeNull());

    // Its tasks leave All; the Archived group holds the list.
    await userEvent.click(within(screen.getAllByRole('navigation')[0]!).getByText('All'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open File return' })).toBeNull(),
    );
    await userEvent.click(within(lists()).getByRole('button', { name: /Archived/ }));
    await userEvent.click(within(lists()).getByText('Taxes 2025'));
    expect(await screen.findByText(/This list is archived/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open File return' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    await waitFor(() => expect(screen.queryByText(/This list is archived/)).toBeNull());
    expect(within(lists()).queryByRole('button', { name: /Archived/ })).toBeNull();
  });
});
