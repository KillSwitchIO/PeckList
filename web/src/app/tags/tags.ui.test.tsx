import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTag, findTagByName } from '../../core/tags.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const tagNav = () => screen.getByRole('list', { name: 'Tags' });

/** Render with tags `home`, `home/yard` and `work`, and tasks tagged with them. */
async function renderSeeded(path: string) {
  const store = testStore();
  const result = await renderApp(path, store);
  store.getState().apply((ctx, ws) => {
    const listId = inboxList(ws).id;
    let next = createTag(ctx, ws, 'home/yard', '#A8DCC0').workspace;
    next = createTag(ctx, next, 'work', '#A7C7E7').workspace;
    const yard = findTagByName(next, 'home/yard')!.id;
    const work = findTagByName(next, 'work')!.id;
    next = createTask(ctx, next, { title: 'Mow lawn', listId, tags: [yard] }).workspace;
    next = createTask(ctx, next, { title: 'Write report', listId, tags: [work] }).workspace;
    return createTask(ctx, next, { title: 'Call vet', listId }).workspace;
  });
  // Phones have no sidebar; elsewhere wait for the seeded tags to show.
  if (screen.queryByRole('list', { name: 'Tags' })) {
    await waitFor(() => expect(within(tagNav()).getByText('work')).toBeInTheDocument());
  }
  return result;
}

describe('tags in the sidebar', () => {
  it('shows nested tags as a tree that can collapse', async () => {
    await renderSeeded('/today');
    const nav = tagNav();
    expect(
      within(nav)
        .getAllByRole('button')
        .map((item) => item.getAttribute('aria-label') ?? item.textContent),
    ).toEqual(['New tag', 'home1', 'Hide tags in home', 'yard1', 'work1']);
    await userEvent.click(within(nav).getByRole('button', { name: 'Hide tags in home' }));
    expect(within(nav).queryByText('yard')).not.toBeInTheDocument();
    await userEvent.click(within(nav).getByRole('button', { name: 'Show tags in home' }));
    expect(within(nav).getByText('yard')).toBeInTheDocument();
  });

  it('creates a nested tag and opens its view', async () => {
    await renderSeeded('/today');
    await userEvent.click(screen.getByRole('button', { name: 'New tag' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'attic');
    await userEvent.click(within(dialog).getByLabelText('Nest under'));
    await userEvent.click(screen.getByRole('option', { name: 'home' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'attic' })).toBeInTheDocument();
    expect(within(tagNav()).getByText('attic')).toBeInTheDocument();
  });

  it('refuses a name that is already taken', async () => {
    await renderSeeded('/today');
    await userEvent.click(screen.getByRole('button', { name: 'New tag' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Work');
    expect(within(dialog).getByText('A tag with this name already exists')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});

describe('tag view', () => {
  it('filters tasks by tag, nested tags included', async () => {
    await renderSeeded('/today');
    await userEvent.click(within(tagNav()).getByRole('button', { name: /^home/ }));
    await screen.findByRole('heading', { level: 1, name: 'home' });
    const titles = () =>
      screen
        .getAllByRole('button', { name: /^Open / })
        .map((row) => row.getAttribute('aria-label'));
    expect(titles()).toEqual(['Open Mow lawn']);
    await userEvent.click(within(tagNav()).getByRole('button', { name: /^work/ }));
    await screen.findByRole('heading', { level: 1, name: 'work' });
    expect(titles()).toEqual(['Open Write report']);
  });

  it('adds new tasks with the tag, into the Mess Drawer', async () => {
    const { store } = await renderSeeded('/today');
    await userEvent.click(within(tagNav()).getByRole('button', { name: /^work/ }));
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Add task tagged work' }),
      'Plan sprint{Enter}',
    );
    const row = await screen.findByRole('button', { name: 'Open Plan sprint' });
    expect(within(row).getByTestId('task-tags')).toHaveTextContent('work');
    const ws = store.getState().workspace!;
    const task = ws.entities.tasks.find((item) => item.title === 'Plan sprint')!;
    expect(task.listId).toBe(inboxList(ws).id);
  });

  it('renames a tag and deletes it with undo', async () => {
    await renderSeeded('/today');
    await userEvent.click(within(tagNav()).getByRole('button', { name: /^home/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit tag' }));
    const name = within(screen.getByRole('dialog')).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'house{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'house' })).toBeInTheDocument();
    expect(within(tagNav()).getByText('yard')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete tag' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(within(tagNav()).queryByText('house')).not.toBeInTheDocument();
    expect(within(tagNav()).queryByText('yard')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(within(tagNav()).getByText('yard')).toBeInTheDocument());
  });
});

describe('tag picker', () => {
  it('tags a task from its details, creating a tag on Enter', async () => {
    await renderSeeded('/inbox');
    await userEvent.click(screen.getByRole('button', { name: 'Open Call vet' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Tags: Add tags' }));
    const picker = screen.getByRole('dialog', { name: 'Tags' });

    await userEvent.click(within(picker).getByRole('checkbox', { name: 'work' }));
    expect(within(picker).getByRole('checkbox', { name: 'work' })).toBeChecked();
    await userEvent.type(
      within(picker).getByRole('textbox', { name: 'Search or create a tag' }),
      'pets{Enter}',
    );
    expect(within(picker).getByRole('checkbox', { name: 'pets' })).toBeChecked();
    // Searching shows full paths; picking an exact match with Enter toggles it.
    await userEvent.type(within(picker).getByRole('textbox'), 'yard');
    expect(
      within(picker)
        .getAllByRole('checkbox')
        .map((item) => item.textContent),
    ).toEqual(['home/yard']);
    await userEvent.keyboard('{Escape}');

    const row = screen.getByRole('button', { name: 'Open Call vet' });
    expect(within(row).getByTestId('task-tags')).toHaveTextContent('petswork');
    expect(within(details).getByRole('button', { name: 'Tags: pets, work' })).toBeInTheDocument();
  });

  it('shows at most two chips on a row', async () => {
    await renderSeeded('/inbox');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow lawn' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: /^Tags:/ }));
    const picker = screen.getByRole('dialog', { name: 'Tags' });
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'home' }));
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'work' }));
    await userEvent.keyboard('{Escape}');
    const row = screen.getByRole('button', { name: 'Open Mow lawn' });
    expect(within(row).getByTestId('task-tags')).toHaveTextContent('homeyard+1');
  });
});

describe('tags on phones', () => {
  it('puts row tags on a second line under the title', async () => {
    mockViewport('phone');
    await renderSeeded('/inbox');
    const row = screen.getByRole('button', { name: 'Open Mow lawn' });
    const title = within(row).getByText('Mow lawn');
    // Same block as the title, not in the right-hand meta column.
    expect(title.parentElement).toContainElement(within(row).getByTestId('task-tags'));
    expect(within(row).getByTestId('task-meta')).not.toContainElement(
      within(row).getByTestId('task-tags'),
    );
  });
});

describe('tag dialog', () => {
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'New tag' }));
    return screen.getByRole('dialog');
  };
  const checked = (dialog: HTMLElement) =>
    within(dialog)
      .getAllByRole('radio')
      .find((radio) => radio.getAttribute('aria-checked') === 'true')
      ?.getAttribute('aria-label');

  it('nests when a path is typed, and keeps names lowercase', async () => {
    await renderSeeded('/today');
    const dialog = await open();
    const name = within(dialog).getByLabelText('Name');
    await userEvent.type(name, 'Home/Test');
    expect(name).toHaveValue('test');
    expect(within(dialog).getByRole('combobox', { name: 'Nest under' })).toHaveTextContent('home');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'test' })).toBeInTheDocument();
    // Icon-only buttons (New tag, the collapse toggle) have no text.
    const nav = within(tagNav())
      .getAllByRole('button')
      .map((item) => item.textContent)
      .filter(Boolean);
    expect(nav).toEqual(['home1', 'test', 'yard1', 'work1']);
  });

  it('offers a path that does not exist yet as a new parent', async () => {
    const { store } = await renderSeeded('/today');
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'cars/oil');
    expect(within(dialog).getByRole('combobox', { name: 'Nest under' })).toHaveTextContent(
      'cars (new)',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await screen.findByRole('heading', { level: 1, name: 'oil' });
    const ws = store.getState().workspace!;
    const colors = ['cars', 'cars/oil'].map((path) => findTagByName(ws, path)!.color);
    expect(new Set(colors).size).toBe(2);
  });

  it('suggests an unused color, the next in the family for nested tags', async () => {
    // Seed: home pastel red, home/yard pastel green, work pastel blue.
    await renderSeeded('/today');
    const dialog = await open();
    expect(checked(dialog)).toBe('Pastel orange');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'work/');
    expect(checked(dialog)).toBe('Pastel violet');
    // A pick sticks even when the parent changes.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vivid' }));
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Vivid red' }));
    await userEvent.type(within(dialog).getByLabelText('Name'), 'x/');
    expect(checked(dialog)).toBe('Vivid red');
  });

  it('takes any custom color', async () => {
    const { store } = await renderSeeded('/today');
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'night');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Custom color' }));
    const hex = within(dialog).getByRole('textbox', { name: 'Hex color' });
    await userEvent.clear(hex);
    await userEvent.type(hex, '123abc');
    expect(checked(dialog)).toBe('Custom color');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await screen.findByRole('heading', { level: 1, name: 'night' });
    expect(findTagByName(store.getState().workspace!, 'night')!.color).toBe('#123ABC');
  });
});
