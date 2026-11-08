import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setBottomBar } from '../../core/bottomBar.ts';
import { createList, deleteList, restoreList, updateList } from '../../core/lists.ts';
import { createTag } from '../../core/tags.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

const bar = () => screen.getByRole('navigation', { name: 'PeckList' });
const tabs = () =>
  within(bar())
    .getAllByRole('button')
    .map((tab) => tab.textContent);

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('phone');
});

async function withGarden(path: string) {
  const store = testStore();
  await renderApp(path, store);
  let listId = '';
  let tagId = '';
  act(() =>
    store.getState().apply((ctx, ws) => {
      const made = createList(ctx, ws, { name: 'Garden', color: '#A7C7E7' });
      const tagged = createTag(ctx, made.workspace, 'home/beds');
      listId = made.list.id;
      tagId = tagged.tag.id;
      return tagged.workspace;
    }),
  );
  return { store, listId, tagId };
}

describe('lists and tags on the bottom bar (R-FB-164)', () => {
  it('are put on the bar from their own rows on More, and open their page from the bar', async () => {
    const { store, listId, tagId } = await withGarden('/more');
    await userEvent.click(screen.getByRole('button', { name: 'Edit sidebar' }));
    // One list, no second one for the bar.
    expect(screen.queryByRole('list', { name: 'Bottom bar' })).toBeNull();
    // The Mess Drawer is offered once, as the view it is, and it is on the bar already.
    expect(screen.queryByRole('button', { name: 'Add Mess Drawer to the bottom bar' })).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'Remove Mess Drawer from the bottom bar' }),
    ).toHaveLength(1);

    for (const name of ['Calendar', 'Search']) {
      await userEvent.click(
        screen.getByRole('button', { name: `Remove ${name} from the bottom bar` }),
      );
    }
    // Taken out, Search is offered once, on its own row.
    expect(screen.getAllByRole('button', { name: 'Add Search to the bottom bar' })).toHaveLength(1);
    await userEvent.click(
      within(screen.getByRole('list', { name: 'Lists' })).getByRole('button', {
        name: 'Add Garden to the bottom bar',
      }),
    );
    // A tag is named in full here, where two of the same last name can be told apart.
    await userEvent.click(screen.getByRole('button', { name: 'Add home/beds to the bottom bar' }));
    // On the bar, each row shows which tab it is: they go on in the order they were added.
    const beds = screen.getByRole('button', { name: 'Remove home/beds from the bottom bar' });
    expect(beds).toHaveAttribute('aria-pressed', 'true');
    expect(beds).toHaveTextContent('4');
    expect(
      screen.getByRole('button', { name: 'Remove Garden from the bottom bar' }),
    ).toHaveTextContent('3');
    await userEvent.click(
      within(screen.getByRole('toolbar', { name: 'Edit sidebar' })).getByRole('button', {
        name: 'Done',
      }),
    );

    expect(tabs()).toEqual(['Today', 'Mess Drawer', 'Garden', 'beds', 'More']);
    expect(store.getState().workspace!.entities.settings[0]!.bottomBar).toEqual([
      'today',
      'inbox',
      `list:${listId}`,
      `tag:${tagId}`,
    ]);

    await userEvent.click(within(bar()).getByRole('button', { name: 'Garden' }));
    expect(await screen.findByRole('heading', { name: 'Garden' })).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Garden' })).toHaveClass('Mui-selected');

    await userEvent.click(within(bar()).getByRole('button', { name: 'beds' }));
    expect(within(bar()).getByRole('button', { name: 'beds' })).toHaveClass('Mui-selected');
    expect(within(bar()).getByRole('button', { name: 'Garden' })).not.toHaveClass('Mui-selected');
  });

  it('follow a rename, and a deleted list leaves until it is restored', async () => {
    const { store, listId } = await withGarden('/today');
    act(() =>
      store.getState().apply((ctx, ws) => setBottomBar(ctx, ws, ['today', `list:${listId}`])),
    );
    expect(tabs()).toEqual(['Today', 'Garden', 'More']);

    act(() => store.getState().apply((ctx, ws) => updateList(ctx, ws, listId, { name: 'Yard' })));
    expect(tabs()).toEqual(['Today', 'Yard', 'More']);

    act(() => store.getState().apply((ctx, ws) => deleteList(ctx, ws, listId)));
    expect(tabs()).toEqual(['Today', 'More']);

    act(() => store.getState().apply((ctx, ws) => restoreList(ctx, ws, listId)));
    expect(tabs()).toEqual(['Today', 'Yard', 'More']);
  });

  it('are not offered while editing the sidebar on a computer, which has no bottom bar', async () => {
    mockViewport('desktop');
    await withGarden('/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    // Right-click starts editing, as a hold or a drag does.
    fireEvent.contextMenu(within(nav).getByText('Calendar'));
    expect(within(nav).getByRole('toolbar', { name: 'Edit sidebar' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Pin Garden' })).toBeInTheDocument();
    expect(
      screen.queryAllByRole('button', { name: /to the bottom bar|from the bottom bar/ }),
    ).toEqual([]);
  });
});
