import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createList } from '../../core/lists.ts';
import { createTag } from '../../core/tags.ts';
import { loadSymbolCatalog } from '../lists/listSymbols.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

// The list dialog's icon picker loads the icon catalog: in before the test, not after it ends.
beforeAll(() => loadSymbolCatalog());

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

// Pages load on first visit: room for a busy CI runner.
const slow = { timeout: 10_000 };

describe('Settings, Lists and tags', () => {
  it('opens from Settings and edits, pins, archives and deletes lists and tags', async () => {
    const store = testStore();
    await renderApp('/settings', store);
    store.getState().apply((ctx, ws) => {
      let next = createList(ctx, ws, { name: 'Moving house', color: '#F3E1A0' }).workspace;
      next = createList(ctx, next, { name: 'Garden', color: '#CFE3A3' }).workspace;
      return createTag(ctx, next, 'errands', '#A7C7E7').workspace;
    });
    await userEvent.click(await screen.findByRole('link', { name: /Lists and tags/ }, slow));

    const lists = () => screen.getByRole('list', { name: 'Your lists' });
    expect(await screen.findByRole('list', { name: 'Your lists' }, slow)).toBeInTheDocument();
    expect(within(lists()).getAllByText('Only you')).toHaveLength(2);

    // Rename from its row.
    await userEvent.click(within(lists()).getAllByRole('button', { name: 'Edit Garden' })[0]!);
    const name = await screen.findByRole('textbox', { name: /Name/ });
    await userEvent.clear(name);
    await userEvent.type(name, 'Yard{Enter}');
    expect(await within(lists()).findByText('Yard')).toBeInTheDocument();

    // Pinned to the menu.
    const pin = (pressed: boolean) =>
      within(lists()).queryByRole('button', { name: /Yard/, pressed });
    await userEvent.click(pin(false)!);
    await waitFor(() => expect(pin(true)).not.toBeNull());

    // Archived: it moves down to Archived lists, and back.
    await userEvent.click(within(lists()).getByRole('button', { name: 'Archive Moving house' }));
    const archived = await screen.findByRole('list', { name: 'Archived lists' });
    expect(within(archived).getByText('Moving house')).toBeInTheDocument();
    await userEvent.click(within(archived).getByRole('button', { name: 'Unarchive Moving house' }));
    expect(await within(lists()).findByText('Moving house')).toBeInTheDocument();

    // Deleted after asking.
    await userEvent.click(within(lists()).getByRole('button', { name: 'Delete Yard' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(lists()).queryByText('Yard')).toBeNull());

    const tags = screen.getByRole('list', { name: 'Your tags' });
    expect(within(tags).getByText('errands')).toBeInTheDocument();
    await userEvent.click(within(tags).getByRole('button', { name: 'Delete tag errands' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(tags).queryByText('errands')).toBeNull());
  });
});
