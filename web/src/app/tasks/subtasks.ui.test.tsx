import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { createTag } from '../../core/tags.ts';
import { createTask, setTaskTag } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** Render the Mess Drawer with "Plan trip" > ("Book flights" > "Compare prices"), "Pack". */
async function renderTree(path = '/inbox') {
  const store = testStore();
  const result = await renderApp(path, store);
  store.getState().apply((ctx, ws) => {
    const listId = inboxList(ws).id;
    const trip = createTask(ctx, ws, { title: 'Plan trip', listId });
    const flights = createTask(ctx, trip.workspace, {
      title: 'Book flights',
      listId,
      parentId: trip.task.id,
    });
    const prices = createTask(ctx, flights.workspace, {
      title: 'Compare prices',
      listId,
      parentId: flights.task.id,
    });
    return createTask(ctx, prices.workspace, { title: 'Pack', listId, parentId: trip.task.id })
      .workspace;
  });
  await screen.findByRole('button', { name: 'Open Plan trip' });
  return result;
}

// Rows in the main column only (the details panel has its own "Open ..." buttons).
const rowTitles = () =>
  within(screen.getByRole('main'))
    .getAllByRole('button', { name: /^Open / })
    .map((row) => row.getAttribute('aria-label'));

const subtaskLines = (details: HTMLElement) =>
  within(within(details).getByRole('region', { name: 'Subtasks' }))
    .getAllByRole('textbox', { name: 'Subtask title' })
    .map((input) => (input as HTMLInputElement).value);

describe('subtasks in a list', () => {
  it('shows subtasks indented under their parent and collapses them', async () => {
    await renderTree();
    expect(rowTitles()).toEqual([
      'Open Plan trip',
      'Open Book flights',
      'Open Compare prices',
      'Open Pack',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Hide subtasks of Plan trip' }));
    expect(rowTitles()).toEqual(['Open Plan trip']);
    expect(within(screen.getByRole('button', { name: 'Open Plan trip' })).getByText('0/2'));
    await userEvent.click(screen.getByRole('button', { name: 'Show subtasks of Plan trip' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hide subtasks of Book flights' }));
    expect(rowTitles()).toEqual(['Open Plan trip', 'Open Book flights', 'Open Pack']);
  });

  it('moves a completed subtask to Completed and counts it on the parent', async () => {
    await renderTree();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Pack' }));
    expect(screen.queryByRole('checkbox', { name: 'Complete Pack' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Reopen Pack' })).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'Open Plan trip' })).getByText('1/2'));
  });
});

describe('subtasks in the details', () => {
  async function openDetails(title: string) {
    await userEvent.click(screen.getByRole('button', { name: `Open ${title}` }));
    return screen.findByRole('region', { name: 'Task details' });
  }

  it('lists the subtree and adds subtasks with Enter', async () => {
    await renderTree();
    const details = await openDetails('Plan trip');
    expect(subtaskLines(details)).toEqual(['Book flights', 'Compare prices', 'Pack']);
    const add = within(details).getByRole('textbox', { name: 'Add subtask' });
    await userEvent.type(add, 'Passports{Enter}Chargers{Enter}');
    expect(subtaskLines(details)).toEqual([
      'Book flights',
      'Compare prices',
      'Pack',
      'Passports',
      'Chargers',
    ]);
    expect(add).toHaveFocus();
  });

  it('Enter on a line adds the next one; Tab and Shift+Tab nest and un-nest', async () => {
    await renderTree();
    const details = await openDetails('Plan trip');
    const pack = within(details).getAllByRole('textbox', { name: 'Subtask title' })[2]!;
    await userEvent.click(pack);
    await userEvent.keyboard('{End}{Enter}Snacks');
    expect(subtaskLines(details)).toEqual(['Book flights', 'Compare prices', 'Pack', 'Snacks']);
    await userEvent.keyboard('{Tab}');
    // Snacks nests under Pack, keeps focus, and the list shows it under Pack.
    expect(document.activeElement).toHaveValue('Snacks');
    expect(rowTitles()).toEqual([
      'Open Plan trip',
      'Open Book flights',
      'Open Compare prices',
      'Open Pack',
      'Open Snacks',
    ]);
    expect(
      within(within(screen.getByRole('main')).getByRole('button', { name: 'Open Pack' })).getByText(
        '0/1',
      ),
    );
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(within(screen.getByRole('button', { name: 'Open Plan trip' })).getByText('0/3'));
  });

  it('Backspace on an empty line deletes it with undo; blank lines do not stick', async () => {
    await renderTree();
    const details = await openDetails('Plan trip');
    const pack = within(details).getAllByRole('textbox', { name: 'Subtask title' })[2]!;
    await userEvent.clear(pack);
    await userEvent.keyboard('{Backspace}');
    expect(subtaskLines(details)).toEqual(['Book flights', 'Compare prices']);
    expect(screen.getByText('Subtask deleted')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(subtaskLines(details)).toEqual(['Book flights', 'Compare prices', 'Pack']),
    );
    // Enter, then Enter again on the blank line: no empty subtask is left behind.
    await userEvent.click(within(details).getAllByRole('textbox', { name: 'Subtask title' })[2]!);
    await userEvent.keyboard('{End}{Enter}{Enter}');
    expect(subtaskLines(details)).toEqual(['Book flights', 'Compare prices', 'Pack']);
    expect(within(details).getByRole('textbox', { name: 'Add subtask' })).toHaveFocus();
  });

  it('shows the parent trail on a subtask and opens the parent from it', async () => {
    await renderTree();
    const details = await openDetails('Compare prices');
    const trail = within(details).getByRole('navigation', { name: 'Parent tasks' });
    expect(
      within(trail)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['Plan trip', 'Book flights', '1', '']);
    await userEvent.click(within(trail).getByRole('button', { name: 'Plan trip' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Task details' })).getByLabelText('Title'),
      ).toHaveValue('Plan trip'),
    );
  });
});

describe('subtask layers in the details', () => {
  async function openDetails(title: string) {
    await userEvent.click(
      within(screen.getByRole('main')).getByRole('button', { name: `Open ${title}` }),
    );
    return screen.findByRole('region', { name: 'Task details' });
  }

  it('switches between sibling subtasks', async () => {
    await renderTree();
    const details = await openDetails('Pack');
    await userEvent.click(within(details).getByRole('button', { name: '2 subtasks of Plan trip' }));
    const switcher = screen.getByRole('dialog', { name: 'Subtasks of Plan trip' });
    expect(
      within(switcher)
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(['Book flights', 'Pack']);
    await userEvent.click(within(switcher).getByRole('button', { name: 'Book flights' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Task details' })).getByLabelText('Title'),
      ).toHaveValue('Book flights'),
    );
  });

  it('removes a subtask from its parent, with undo', async () => {
    await renderTree();
    const details = await openDetails('Compare prices');
    await userEvent.click(within(details).getByRole('button', { name: 'Remove from parent' }));
    expect(within(details).queryByRole('navigation', { name: 'Parent tasks' })).toBeNull();
    // Now a top-level task right after its old top task.
    expect(rowTitles()).toEqual([
      'Open Plan trip',
      'Open Book flights',
      'Open Pack',
      'Open Compare prices',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(rowTitles()).toEqual([
        'Open Plan trip',
        'Open Book flights',
        'Open Compare prices',
        'Open Pack',
      ]),
    );
  });

  it('gives a new subtask the parent tags', async () => {
    const { store } = await renderTree();
    store.getState().apply((ctx, ws) => {
      const created = createTag(ctx, ws, 'travel', '#A7C7E7');
      const trip = ws.entities.tasks.find((task) => task.title === 'Plan trip')!;
      return setTaskTag(ctx, created.workspace, trip.id, created.tag.id, true);
    });
    const details = await openDetails('Plan trip');
    await userEvent.type(
      within(details).getByRole('textbox', { name: 'Add subtask' }),
      'Passports{Enter}',
    );
    const passports = store
      .getState()
      .workspace!.entities.tasks.find((task) => task.title === 'Passports')!;
    expect(Object.keys(passports.tags)).toHaveLength(1);
  });
});

describe('subtasks in date views', () => {
  it('nests subtasks under their parent in Today; a dated one nests when it is on the same day', async () => {
    const store = testStore();
    await renderApp('/today', store);
    const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, Date.now());
    const at = (start: string) => ({ start, end: null, allDay: false, timeZone: 'UTC' });
    store.getState().apply((ctx, ws) => {
      const listId = inboxList(ws).id;
      const home = createTask(ctx, ws, {
        title: 'Home today',
        listId,
        schedule: at(`${today}T10:00`),
      });
      const dated = createTask(ctx, home.workspace, {
        title: 'Dated child',
        listId,
        parentId: home.task.id,
        // All-day sorts before 10:00: it still nests under its parent.
        schedule: { start: today, end: null, allDay: true, timeZone: 'UTC' },
      });
      return createTask(ctx, dated.workspace, {
        title: 'Undated child',
        listId,
        parentId: home.task.id,
      }).workspace;
    });
    await screen.findByRole('button', { name: 'Open Home today' });
    expect(rowTitles()).toEqual(['Open Home today', 'Open Dated child', 'Open Undated child']);
    // Nested rows do not repeat the parent name.
    expect(
      within(screen.getByRole('button', { name: 'Open Dated child' })).getByTestId('task-meta'),
    ).not.toHaveTextContent('Home today');
    expect(screen.getByRole('button', { name: 'Hide subtasks of Home today' })).toBeInTheDocument();
  });

  it('shows a dated subtask in Today with its parent named', async () => {
    const store = testStore();
    await renderApp('/today', store);
    const today = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, Date.now());
    store.getState().apply((ctx, ws) => {
      const listId = inboxList(ws).id;
      const trip = createTask(ctx, ws, { title: 'Plan trip', listId });
      return createTask(ctx, trip.workspace, {
        title: 'Call airline',
        listId,
        parentId: trip.task.id,
        schedule: { start: today, end: null, allDay: true, timeZone: 'UTC' },
      }).workspace;
    });
    const row = await screen.findByRole('button', { name: 'Open Call airline' });
    expect(within(row).getByTestId('task-meta')).toHaveTextContent('Plan trip');
  });
});

describe('subtask lines in details', () => {
  it('show the start date on the right and open the task menu on right-click', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    const today = todayIn(localTimeZone(), Date.now());
    store.getState().apply((ctx, ws) => {
      const listId = inboxList(ws).id;
      const trip = createTask(ctx, ws, { title: 'Plan trip', listId });
      return createTask(ctx, trip.workspace, {
        title: 'Book flights',
        listId,
        parentId: trip.task.id,
        schedule: { start: today, end: null, allDay: true, timeZone: 'UTC' },
      }).workspace;
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open Plan trip' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    expect(within(details).getByTestId('subtask-date')).toHaveTextContent('Today');
    fireEvent.contextMenu(within(details).getByDisplayValue('Book flights'));
    expect(await screen.findByRole('menuitem', { name: "Won't do" })).toBeInTheDocument();
  });
});
