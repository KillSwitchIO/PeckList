import { act, screen, within } from '@testing-library/react';
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
  it('are added on More, in groups, and open their page from the bar', async () => {
    const { store, listId, tagId } = await withGarden('/more');
    await userEvent.click(screen.getByRole('button', { name: 'Edit sidebar' }));
    const add = screen.getByRole('list', { name: 'Add to the bottom bar' });
    expect(within(add).getByText('Lists')).toBeInTheDocument();
    expect(within(add).getByText('Tags')).toBeInTheDocument();
    // The Mess Drawer is offered once, as the view it is, and it is on the bar already.
    expect(screen.queryByRole('button', { name: 'Add Mess Drawer to the bottom bar' })).toBeNull();

    const editor = screen.getByRole('list', { name: 'Bottom bar' });
    for (const name of ['Calendar', 'Search']) {
      await userEvent.click(
        within(editor).getByRole('button', { name: `Remove ${name} from the bottom bar` }),
      );
    }
    // Taken out, Search is offered once.
    expect(screen.getAllByRole('button', { name: 'Add Search to the bottom bar' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Add Garden to the bottom bar' }));
    // A tag is named in full here, where two of the same last name can be told apart.
    await userEvent.click(screen.getByRole('button', { name: 'Add home/beds to the bottom bar' }));
    expect(
      within(editor).getByRole('button', { name: 'Remove home/beds from the bottom bar' }),
    ).toBeInTheDocument();
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
});
