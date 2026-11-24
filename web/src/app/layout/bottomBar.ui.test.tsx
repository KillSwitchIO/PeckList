import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
      screen.getAllByRole('button', {
        name: 'Mess Drawer, tab 2 on the bottom bar: change the order',
      }),
    ).toHaveLength(1);

    // A numbered button opens the bar's order, where tabs come off too (PL-149).
    await userEvent.click(
      screen.getByRole('button', { name: 'Calendar, tab 3 on the bottom bar: change the order' }),
    );
    const order = await screen.findByRole('dialog', { name: 'Bottom bar order' });
    for (const name of ['Calendar', 'Search']) {
      await userEvent.click(
        within(order).getByRole('button', { name: `Remove ${name} from the bottom bar` }),
      );
    }
    await userEvent.click(within(order).getByRole('button', { name: 'Done' }));
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
    const beds = screen.getByRole('button', {
      name: 'home/beds, tab 4 on the bottom bar: change the order',
    });
    expect(beds).toHaveAttribute('aria-pressed', 'true');
    expect(beds).toHaveTextContent('4');
    expect(
      screen.getByRole('button', { name: 'Garden, tab 3 on the bottom bar: change the order' }),
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

  it('are put in order in a popup from a numbered button, with a preview, on Done (PL-149)', async () => {
    const { store } = await withGarden('/more');
    await userEvent.click(screen.getByRole('button', { name: 'Edit sidebar' }));
    const openOrder = async () => {
      await userEvent.click(
        screen.getByRole('button', { name: 'Search, tab 4 on the bottom bar: change the order' }),
      );
      return screen.findByRole('dialog', { name: 'Bottom bar order' });
    };
    const preview = (order: HTMLElement) =>
      within(within(order).getByRole('group', { name: 'How the bar will look' }))
        .getAllByText(/./)
        .map((label) => label.textContent);

    // Cancel changes nothing.
    let order = await openOrder();
    expect(preview(order)).toEqual(['Today', 'Mess Drawer', 'Calendar', 'Search', 'More']);
    within(order)
      .getByRole('button', { name: 'Move Search: drag, or use the up and down arrow keys' })
      .focus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(preview(order)).toEqual(['Search', 'Today', 'Mess Drawer', 'Calendar', 'More']);
    await userEvent.click(within(order).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen.getByRole('button', { name: 'Search, tab 4 on the bottom bar: change the order' }),
    ).toBeInTheDocument();

    // Done puts the order in the edit, and the editor's Done saves it.
    order = await openOrder();
    within(order)
      .getByRole('button', { name: 'Move Search: drag, or use the up and down arrow keys' })
      .focus();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.click(within(order).getByRole('button', { name: 'Done' }));
    expect(
      screen.getByRole('button', { name: 'Search, tab 3 on the bottom bar: change the order' }),
    ).toHaveTextContent('3');
    await userEvent.click(
      within(screen.getByRole('toolbar', { name: 'Edit sidebar' })).getByRole('button', {
        name: 'Done',
      }),
    );
    expect(tabs()).toEqual(['Today', 'Mess Drawer', 'Search', 'Calendar', 'More']);
    expect(store.getState().workspace!.entities.settings[0]!.bottomBar).toEqual([
      'today',
      'inbox',
      'search',
      'calendar',
    ]);
  });

  it('move the tab asked for in the order popup when a list on the bar goes meanwhile', async () => {
    const { store, listId } = await withGarden('/more');
    act(() =>
      store
        .getState()
        .apply((ctx, ws) =>
          setBottomBar(ctx, ws, ['today', `list:${listId}`, 'calendar', 'search']),
        ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit sidebar' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Search, tab 4 on the bottom bar: change the order' }),
    );
    const order = await screen.findByRole('dialog', { name: 'Bottom bar order' });
    // Deleted on another device while the popup is open: its row goes, the others move up.
    act(() => store.getState().apply((ctx, ws) => deleteList(ctx, ws, listId)));
    within(order)
      .getByRole('button', { name: 'Move Search: drag, or use the up and down arrow keys' })
      .focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(
      within(within(order).getByRole('group', { name: 'How the bar will look' }))
        .getAllByText(/./)
        .map((label) => label.textContent),
    ).toEqual(['Today', 'Search', 'Calendar', 'More']);
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
    expect(screen.queryAllByRole('button', { name: /bottom bar/ })).toEqual([]);
  });

  // Ben, rc.3: opening the order popup shifted the page left. Each row's unseen status line was
  // as wide as its row (MUI reads a bare 1 as 100%), so it poked past a phone's edge and the
  // popup's scroll lock took that for a scrollbar to make room for.
  it("take no room for their rows' unseen status lines, so nothing pokes past the screen", async () => {
    await withGarden('/more');
    await userEvent.click(screen.getByRole('button', { name: 'Edit sidebar' }));
    const statuses = screen
      .getAllByRole('status')
      .filter((status) => status.closest('[role="button"]') !== null);
    expect(statuses.length).toBeGreaterThan(5);
    for (const status of statuses) {
      expect(getComputedStyle(status)).toMatchObject({ width: '1px', height: '1px' });
    }
  });
});
