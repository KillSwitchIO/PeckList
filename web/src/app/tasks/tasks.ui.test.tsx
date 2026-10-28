import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { putEntity } from '../../core/collections.ts';
import { inboxList } from '../../core/lists.ts';
import { createEntity, updateEntity } from '../../core/ops.ts';
import { createTask } from '../../core/tasks.ts';
import type { Section } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function addTasks(...titles: string[]) {
  const input = screen.getByRole('textbox', { name: /add task/i });
  for (const title of titles) {
    await userEvent.type(input, `${title}{Enter}`);
  }
}

describe('tasks in a list', () => {
  it('adds tasks to the Inbox in order and ignores blank input', async () => {
    await renderApp('/inbox');
    await addTasks('Mow the lawn', 'Call the vet');
    await userEvent.type(screen.getByRole('textbox', { name: /add task/i }), '   {Enter}');
    const rows = screen.getAllByRole('button', { name: /^Open / });
    expect(rows.map((row) => row.textContent)).toEqual(['Mow the lawn', 'Call the vet']);
  });

  it('lets the small Undo button be swiped away', async () => {
    await renderApp('/inbox');
    await addTasks('Feed the cat');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Feed the cat' }));
    const button = screen.getByRole('button', { name: 'Undo' });
    fireEvent.pointerDown(button, { clientX: 40, pointerId: 4 });
    fireEvent.pointerMove(window, { clientX: 70, pointerId: 4 });
    fireEvent.pointerMove(window, { clientX: 110, pointerId: 4 });
    fireEvent.pointerUp(window, { clientX: 110, pointerId: 4 });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
    // Still done: swiping it away is not undoing.
    expect(screen.getByRole('checkbox', { name: 'Reopen Feed the cat' })).toBeInTheDocument();
  });

  it('completes a task, offers undo, and undo brings it back', async () => {
    await renderApp('/inbox');
    await addTasks('Mow the lawn');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Mow the lawn' }));
    // It moves down to Completed.
    expect(screen.queryByRole('checkbox', { name: 'Complete Mow the lawn' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Reopen Mow the lawn' })).toBeInTheDocument();
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await screen.findByRole('checkbox', { name: 'Complete Mow the lawn' }),
    ).toBeInTheDocument();
  });

  it('shows completed tasks in a Completed group and can reopen them', async () => {
    await renderApp('/inbox');
    await addTasks('Mow the lawn');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Mow the lawn' }));
    expect(screen.getByRole('button', { name: 'Closed 1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Reopen Mow the lawn' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Completed \d/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('checkbox', { name: 'Complete Mow the lawn' })).toBeInTheDocument();
  });
});

describe('task details', () => {
  it('edits title, priority, dates and notes', async () => {
    await renderApp('/inbox');
    await addTasks('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    const details = await screen.findByRole('region', { name: 'Task details' });

    const title = within(details).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Mow the lawn{Enter}');
    await userEvent.click(within(details).getByRole('button', { name: 'Priority: None' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'High' }));
    await userEvent.click(within(details).getByRole('button', { name: /^Due:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Due' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    await userEvent.click(within(details).getByRole('button', { name: /^Start date:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Start date' })).getByRole('button', {
        name: 'Today',
      }),
    );
    const notes = await within(details).findByRole('textbox', { name: 'Notes' });
    await userEvent.type(notes, 'Front and back');
    await userEvent.click(within(details).getByLabelText('Title'));

    const row = screen.getByRole('button', { name: 'Open Mow the lawn' });
    // Rows show only the start date or time; the due date lives in the details and calendar.
    expect(within(row.parentElement!).getByTestId('task-date')).toHaveTextContent(/^Today$/);
    expect(row).not.toHaveTextContent('Tomorrow');
    expect(within(details).getByRole('button', { name: 'Priority: High' })).toBeInTheDocument();
    expect(within(details).getByRole('textbox', { name: 'Notes' })).toHaveTextContent(
      'Front and back',
    );
  });

  it('on a phone keeps comments, dates and history in a panel that slides up', async () => {
    mockViewport('phone');
    await renderApp('/inbox');
    await addTasks('Call the plumber');
    await userEvent.click(screen.getByRole('button', { name: 'Open Call the plumber' }));
    expect(screen.queryByTestId('task-dates')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Comments and history' }));
    const panel = await screen.findByRole('dialog', { name: 'Comments and history' });
    expect(within(panel).getByTestId('task-dates')).toHaveTextContent(/^Created Today/);
  });

  it('expands the quick add bar into the full task form, filled with what was typed', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    const bar = screen.getByRole('textbox', { name: 'Add task to Mess Drawer' });
    await userEvent.type(bar, 'Buy paint !high');
    await userEvent.click(screen.getByRole('button', { name: 'Expand into the task form' }));
    const form = await screen.findByRole('dialog');
    expect(within(form).getByLabelText('Title')).toHaveValue('Buy paint');
    expect(within(form).getByRole('button', { name: 'Priority: High' })).toBeInTheDocument();
    expect(bar).toHaveValue('');
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Opened empty and closed empty: no "Untitled" task is left, not even in the trash.
    await userEvent.click(screen.getByRole('button', { name: 'Expand into the task form' }));
    await screen.findByRole('dialog');
    const count = () =>
      store.getState().workspace!.entities.tasks.filter((task) => task.title === '').length;
    expect(count()).toBe(1);
    // While its form is open the blank task stays out of the list behind it (R-FB-93).
    expect(screen.queryByRole('button', { name: 'Open Untitled task', hidden: true })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull());
    await waitFor(() =>
      expect(
        store
          .getState()
          .workspace!.entities.tasks.filter((task) => task.title === '' && task.deletedAt === null),
      ).toHaveLength(0),
    );
    expect(screen.queryByRole('button', { name: /^Open $/ })).toBeNull();
  });

  it('on a tablet the first Escape leaves the notes and the second closes the details', async () => {
    mockViewport('tablet');
    await renderApp('/inbox');
    await addTasks('Plan the trip');
    await userEvent.click(screen.getByRole('button', { name: 'Open Plan the trip' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    const notes = await within(details).findByRole('textbox', { name: 'Notes' });
    await userEvent.click(notes);
    // The editor takes focus a beat after the click on a busy machine; Escape before that would
    // close the details instead.
    await waitFor(() => expect(notes).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('region', { name: 'Task details' })).toBeInTheDocument();
    // Likewise the editor lets go of focus a beat later; the next Escape is for the details.
    await waitFor(() => expect(notes).not.toHaveFocus());
    // Focus sits on the page for a moment until the drawer's focus trap (an interval) takes it
    // back; an Escape on the page would never reach the drawer.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    await userEvent.keyboard('{Escape}');
    // Its closing transition runs on timers, slow under the coverage run.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull(), {
      timeout: 3000,
    });
  });

  it('attaches files to a task, shows pictures as thumbnails, and removes them with undo', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    await addTasks('Fix the gate');
    await userEvent.click(screen.getByRole('button', { name: 'Open Fix the gate' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.upload(within(details).getByTestId('attach-input'), [
      new File(['hinge'], 'hinge.png', { type: 'image/png' }),
      new File(['quote'], 'quote.pdf', { type: 'application/pdf' }),
    ]);
    const files = await within(details).findByRole('region', { name: 'Files' });
    await within(files).findByRole('listitem', { name: 'quote.pdf, 5 B' });
    const picture = within(files).getByRole('listitem', { name: 'hinge.png, 5 B' });
    await waitFor(() => expect(picture.querySelector('img')).toHaveAttribute('src', 'blob:test'));
    // Kept under the SHA-256 of their bytes: "hinge" hashes to this.
    const stored = store.getState().workspace!.entities.attachments;
    expect(stored.map((each) => each.name)).toEqual(['hinge.png', 'quote.pdf']);
    expect(stored[0]!.sha256).toBe(
      '7706c3c94d5f9b598a2bc7385eb7c51aba74f4eed2aa467bfcb2c611a0897fa2',
    );

    await userEvent.click(within(files).getByRole('button', { name: 'Remove quote.pdf' }));
    await waitFor(() =>
      expect(within(files).queryByRole('listitem', { name: /^quote\.pdf/ })).toBeNull(),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(
      await within(files).findByRole('listitem', { name: 'quote.pdf, 5 B' }),
    ).toBeInTheDocument();
  });

  it('pins a task to the top of its list and of All, and completing it unpins it', async () => {
    await renderApp('/inbox');
    await addTasks('First', 'Second', 'Third');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Third' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pin to the top' }));
    const pinned = await screen.findByRole('heading', { level: 2, name: /^Pinned/ });
    const group = pinned.closest('section')!;
    expect(within(group).getByRole('button', { name: 'Open Third' })).toBeInTheDocument();

    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByRole('button', { name: /^All/ }));
    const inAll = (await screen.findByRole('heading', { level: 2, name: /^Pinned/ })).closest(
      'section',
    )!;
    expect(within(inAll).getByRole('button', { name: 'Open Third' })).toBeInTheDocument();

    await userEvent.click(within(inAll).getByRole('checkbox', { name: 'Complete Third' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 2, name: /^Pinned/ })).toBeNull(),
    );
  });

  it('opens the notes in the full editor, with the formatting toolbar, and keeps what was typed', async () => {
    await renderApp('/inbox');
    await addTasks('Shopping');
    await userEvent.click(screen.getByRole('button', { name: 'Open Shopping' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await within(details).findByRole('textbox', { name: 'Notes' });
    await userEvent.click(within(details).getByRole('button', { name: 'Full editor' }));
    const full = await screen.findByRole('dialog', { name: 'Shopping' });
    expect(within(full).getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    await userEvent.type(await within(full).findByRole('textbox', { name: 'Notes' }), 'Milk');
    await userEvent.click(within(full).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(within(details).getByRole('textbox', { name: 'Notes' })).toHaveTextContent('Milk');
  });

  it('resizes the details panel and remembers the width', async () => {
    await renderApp('/inbox');
    await addTasks('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    const handle = await screen.findByRole('separator', { name: 'Resize details' });
    // Drag the edge left by 100px: the panel gets wider.
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 800, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 800, pointerId: 1 });
    expect(Number(localStorage.getItem('punchlist.detailWidth'))).toBeGreaterThan(0);
    await userEvent.dblClick(handle);
    expect(localStorage.getItem('punchlist.detailWidth')).toBeNull();
  });

  it('opens details full screen and back', async () => {
    await renderApp('/inbox');
    await addTasks('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Task details' })).getByRole('button', {
        name: 'Full screen',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('region', { name: 'Task details' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Exit full screen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Task details' })).toBeInTheDocument();
  });

  it("marks won't do, reopens, deletes and closes", async () => {
    await renderApp('/inbox');
    await addTasks('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    // Won't do lives in the title's right-click menu.
    fireEvent.contextMenu(within(details).getByLabelText('Title'));
    await userEvent.click(await screen.findByRole('menuitem', { name: "Won't do" }));
    expect(screen.getByText("Marked won't do")).toBeInTheDocument();
    // The header checkbox reopens, completes and reopens again.
    await userEvent.click(within(details).getByRole('checkbox', { name: 'Reopen Mow' }));
    await userEvent.click(within(details).getByRole('checkbox', { name: 'Complete Mow' }));
    await userEvent.click(within(details).getByRole('checkbox', { name: 'Reopen Mow' }));
    await userEvent.click(within(details).getByRole('button', { name: 'Delete task' }));
    expect(screen.queryByRole('region', { name: 'Task details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Mow' })).not.toBeInTheDocument();
    expect(screen.getByText('Task deleted')).toBeInTheDocument();
  });

  it('sets progress with the slider in the right-click menu; rows show a ring by the date', async () => {
    await renderApp('/inbox');
    await addTasks('Paint fence');
    const row = screen.getByRole('button', { name: 'Open Paint fence' });
    fireEvent.contextMenu(row);
    const slider = await screen.findByRole('slider', { name: 'Progress' });
    slider.focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(slider).toHaveAttribute('aria-valuetext', '40%');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(within(row.parentElement!).getByRole('img', { name: '40%' })).toBeInTheDocument();
    // Back to 0 clears it.
    fireEvent.contextMenu(row);
    (await screen.findByRole('slider', { name: 'Progress' })).focus();
    await userEvent.keyboard('{Home}{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(within(row.parentElement!).queryByRole('img')).toBeNull();
  });

  it('opens the task menu from the header checkbox and shows when the task was made', async () => {
    await renderApp('/inbox');
    await addTasks('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    // Made and changed just now: one date, formatted like every other date.
    expect(within(details).getByTestId('task-dates')).toHaveTextContent(
      /^Created Today \d{1,2}:\d{2}/,
    );
    fireEvent.contextMenu(within(details).getByRole('checkbox', { name: 'Complete Mow' }));
    expect(await screen.findByRole('menuitem', { name: "Won't do" })).toBeInTheDocument();
  });

  it('Escape closes the details (a picker first, then the panel)', async () => {
    await renderApp('/inbox');
    await addTasks('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: /^Start date:/ }));
    await screen.findByRole('dialog', { name: 'Start date' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('region', { name: 'Task details' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull();
  });

  it('Shift+Return confirms a dialog', async () => {
    await renderApp('/today');
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Garage{Shift>}{Enter}{/Shift}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Garage' })).toBeInTheDocument();
  });

  it('shows a due date on the row when there is no start date', async () => {
    await renderApp('/inbox');
    await addTasks('Concrete');
    await userEvent.click(screen.getByRole('button', { name: 'Open Concrete' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: /^Due:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Due' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    const row = screen.getByRole('button', { name: 'Open Concrete' });
    expect(within(row.parentElement!).getByTestId('task-date')).toHaveTextContent('Tomorrow');
    expect(
      within(row.parentElement!).getByRole('img', { name: 'Due Tomorrow' }),
    ).toBeInTheDocument();
  });

  it('clicking a row date edits it without opening the task', async () => {
    await renderApp('/inbox');
    await addTasks('Paint');
    const row = screen.getByRole('button', { name: 'Open Paint' }).parentElement!;
    // Undated: the date spot adds a start date.
    await userEvent.click(within(row).getByRole('button', { name: 'Add date' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Start date' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    // It moves to the Tomorrow group, so find the row again.
    const moved = screen.getByRole('button', { name: 'Open Paint' }).parentElement!;
    expect(within(moved).getByTestId('task-date')).toHaveTextContent('Tomorrow');
    expect(screen.queryByRole('region', { name: 'Task details' })).toBeNull();
  });

  it('explains when the opened task no longer exists', async () => {
    await renderApp('/inbox?task=01NOPE00000000000000000000');
    expect(screen.getByText('This task no longer exists.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('This task no longer exists.')).not.toBeInTheDocument();
  });

  it('opens as a drawer on tablets', async () => {
    mockViewport('tablet');
    await renderApp('/inbox');
    await addTasks('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    expect(await screen.findByRole('region', { name: 'Task details' })).toBeInTheDocument();
  });
});

describe('task row', () => {
  it('shows the full start date in every view and no list for the Mess Drawer', async () => {
    await renderApp('/inbox');
    await addTasks('Water plants');
    await userEvent.click(screen.getByRole('button', { name: 'Open Water plants' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: /^Start date:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Start date' })).getByRole('button', {
        name: 'Today',
      }),
    );
    const inList = screen.getByRole('button', { name: 'Open Water plants' });
    expect(within(inList.parentElement!).getByTestId('task-date')).toHaveTextContent('Today');

    await userEvent.click(within(screen.getAllByRole('navigation')[0]!).getByText('Today'));
    const inToday = await screen.findByRole('button', { name: 'Open Water plants' });
    // Same full date in every view, and no list name for the Mess Drawer.
    expect(within(inToday.parentElement!).getByTestId('task-date')).toHaveTextContent('Today');
    expect(within(inToday).getByTestId('task-meta')).not.toHaveTextContent('Mess Drawer');
  });
});

describe('Mess Drawer', () => {
  it('is the default list everywhere, with a fixed name and no color', async () => {
    await renderApp('/inbox');
    expect(screen.getByRole('heading', { level: 1, name: 'Mess Drawer' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add task to Mess Drawer' })).toBeInTheDocument();
    // Nothing to edit, archive or delete: no list menu at all.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});

describe('lists and sections', () => {
  it('creates a list from the sidebar and adds a task to it', async () => {
    await renderApp('/today');
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Home');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Pastel green' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    await addTasks('Fix gate');
    const nav = screen.getAllByRole('navigation')[0]!;
    expect(within(nav).getByRole('button', { name: /Home\s*1/ })).toBeInTheDocument();
  });

  it('gives a list an icon, shown where its color dot was', async () => {
    await renderApp('/today');
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Groceries');
    await userEvent.click(within(dialog).getByRole('radio', { name: '🛒' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    const nav = screen.getAllByRole('navigation')[0]!;
    // The icon is decoration: the button is still named by the list.
    expect(await within(nav).findByRole('button', { name: /^Groceries/ })).toHaveTextContent('🛒');

    // Search finds emoji (and icons) by name (R-FB-117).
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit list' }));
    const edit = await screen.findByRole('dialog');
    const search = within(edit).getByRole('searchbox', { name: 'Search icons and emoji' });
    await userEvent.type(search, 'carrot');
    await userEvent.click(await within(edit).findByRole('radio', { name: '🥕' }));
    // An emoji the catalog lacks can be typed in and used.
    await userEvent.clear(search);
    await userEvent.type(search, '🫎');
    expect(within(edit).getByRole('radio', { name: 'Use 🫎' })).toBeInTheDocument();
    await userEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: /^Groceries/ })).toHaveTextContent('🥕'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit list' }));
    const again = await screen.findByRole('dialog');
    await userEvent.click(within(again).getByRole('radio', { name: 'No icon' }));
    await userEvent.click(within(again).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: /^Groceries/ })).not.toHaveTextContent('🥕'),
    );
  });

  it('gives a list a line icon in its color instead of an emoji', async () => {
    await renderApp('/today');
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Work');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'work icon' }));
    expect(within(dialog).getByRole('radio', { name: 'work icon' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    const nav = screen.getAllByRole('navigation')[0]!;
    const row = await within(nav).findByRole('button', { name: /^Work/ });
    expect(row.querySelector('svg[data-testid="WorkOutlineRoundedIcon"]')).not.toBeNull();
    // The stored name is never shown as text.
    expect(row).not.toHaveTextContent('symbol:');
  });

  it('has no sections: ones in old data fold into their list, in the order they showed', async () => {
    const store = testStore();
    await store.getState().init();
    store.getState().apply((ctx, ws) => {
      const inbox = inboxList(ws).id;
      const section = createEntity<Section>(ctx, { listId: inbox, name: 'Yard', order: 'm' });
      let next = putEntity(ws, 'sections', section);
      const rake = createTask(ctx, next, { title: 'Rake', listId: inbox });
      next = putEntity(
        rake.workspace,
        'tasks',
        updateEntity(ctx, rake.task, { sectionId: section.id, order: 'a' }),
      );
      // Old data: a task outside any section, ordered on its own (after Rake's key).
      const loose = createTask(ctx, next, { title: 'Loose', listId: inbox });
      return putEntity(loose.workspace, 'tasks', updateEntity(ctx, loose.task, { order: 'z' }));
    });
    await store.getState().flush();
    localStorage.setItem(
      'punchlist.listGrouping',
      JSON.stringify({ [inboxList(store.getState().workspace!).id]: 'section' }),
    );
    await renderApp('/inbox', store);
    await waitFor(() =>
      expect(
        store
          .getState()
          .workspace!.entities.sections.every((section) => section.deletedAt !== null),
      ).toBe(true),
    );
    expect(
      store.getState().workspace!.entities.tasks.every((task) => task.sectionId === null),
    ).toBe(true);
    await screen.findByRole('button', { name: 'Open Rake' });
    expect(screen.queryByRole('heading', { level: 2, name: /^Yard/ })).toBeNull();
    const titles = screen
      .getAllByRole('button', { name: /^Open / })
      .map((row) => row.getAttribute('aria-label'));
    expect(titles).toEqual(['Open Loose', 'Open Rake']);
    // A list grouped by section before now shows its own order.
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(await screen.findByRole('menuitem', { name: 'Group by none' })).toHaveClass(
      'Mui-selected',
    );
    expect(screen.queryByRole('menuitem', { name: 'Group by section' })).toBeNull();
  });

  it('edits, archives and deletes lists', async () => {
    const store = testStore();
    await renderApp('/today', store);
    await userEvent.click(screen.getByRole('button', { name: 'New list' }));
    await userEvent.type(
      within(await screen.findByRole('dialog')).getByLabelText('Name'),
      'Work{Enter}',
    );
    await screen.findByRole('heading', { level: 1, name: 'Work' });

    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit list' }));
    const name = within(await screen.findByRole('dialog')).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Job{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Job' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete list' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mess Drawer' }),
    ).toBeInTheDocument();
    expect(screen.getByText('List deleted')).toBeInTheDocument();
  });

  it('shows a message for unknown lists', async () => {
    await renderApp('/lists/01NOPE00000000000000000000');
    expect(screen.getByText('This list no longer exists.')).toBeInTheDocument();
  });
});

describe('smart views', () => {
  it('Today adds tasks scheduled for today and shows overdue ones first', async () => {
    const store = testStore();
    await renderApp('/today', store);
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title: 'Old chore',
          listId: inboxList(ws).id,
          schedule: { start: '2020-01-01', end: null, allDay: true, timeZone: 'UTC' },
        }).workspace,
    );
    await addTasks('Water plants');
    expect(await screen.findByRole('heading', { level: 2, name: /^Overdue/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Water plants' })).toBeInTheDocument();
  });

  it('Upcoming, Completed and Trash with restore', async () => {
    const store = testStore();
    await renderApp('/upcoming', store);
    // Every coming day is listed, empty ones too.
    expect(screen.getAllByText('Nothing planned').length).toBeGreaterThan(6);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title: 'Soon',
          listId: inboxList(ws).id,
          schedule: { start: tomorrow, end: null, allDay: true, timeZone: 'UTC' },
        }).workspace,
    );
    expect(await screen.findByRole('button', { name: 'Open Soon' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Soon' }));
    // Completed and Trash sit in the "More" group, closed at first.
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByRole('button', { name: /^More/ }));
    await userEvent.click(within(nav).getByText('Closed'));
    expect(await screen.findByRole('button', { name: 'Open Soon' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open Soon' }));
    await userEvent.click(
      within(await screen.findByRole('region', { name: 'Task details' })).getByRole('button', {
        name: 'Delete task',
      }),
    );
    await userEvent.click(within(screen.getAllByRole('navigation')[0]!).getByText('Trash'));
    expect(await screen.findByText('Soon')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText('The trash is empty.')).toBeInTheDocument();
  });

  it('Upcoming also shows overdue and today', async () => {
    const store = testStore();
    await renderApp('/upcoming', store);
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title: 'Old chore',
          listId: inboxList(ws).id,
          schedule: { start: '2020-01-01', end: null, allDay: true, timeZone: 'UTC' },
        }).workspace,
    );
    await addTasks('Water plants');
    expect(await screen.findByRole('heading', { level: 2, name: /^Overdue/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Today/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Water plants' })).toBeInTheDocument();
  });

  it('Completed and Trash start empty', async () => {
    await renderApp('/completed');
    expect(screen.getByText('Nothing completed yet.')).toBeInTheDocument();
  });
});

describe('phone', () => {
  it('More lists the remaining views and lists', async () => {
    mockViewport('phone');
    await renderApp('/more');
    await userEvent.click(screen.getByRole('button', { name: 'Trash' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument();
  });

  it('More is edited like the desktop sidebar: hide a view, then Done', async () => {
    mockViewport('phone');
    await renderApp('/more');
    await userEvent.click(screen.getByRole('button', { name: 'Edit sidebar' }));
    const bar = screen.getByRole('toolbar', { name: 'Edit sidebar' });
    await userEvent.click(screen.getByRole('button', { name: 'Hide All' }));
    await userEvent.click(within(bar).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('toolbar', { name: 'Edit sidebar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Upcoming' })).toBeInTheDocument();
  });

  it('the bottom bar is picked and ordered on More: take one out, add another', async () => {
    mockViewport('phone');
    const store = testStore();
    await renderApp('/more', store);
    const bar = () => screen.getByRole('navigation', { name: 'Punchlist' });
    const tabs = () =>
      within(bar())
        .getAllByRole('button')
        .map((tab) => tab.textContent);
    expect(tabs()).toEqual(['Today', 'Mess Drawer', 'Calendar', 'Search', 'More']);

    await userEvent.click(screen.getByRole('button', { name: 'Edit sidebar' }));
    const editor = screen.getByRole('list', { name: 'Bottom bar' });
    expect(within(editor).getByText('Calendar')).toBeInTheDocument();
    // Full: nothing more can be added until one comes out.
    expect(screen.getByRole('button', { name: 'Add Upcoming to the bottom bar' })).toBeDisabled();
    await userEvent.click(
      within(editor).getByRole('button', { name: 'Remove Calendar from the bottom bar' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add Due dates to the bottom bar' }));
    // Nothing changes until Done.
    expect(tabs()).toContain('Calendar');
    await userEvent.click(
      within(screen.getByRole('toolbar', { name: 'Edit sidebar' })).getByRole('button', {
        name: 'Done',
      }),
    );
    expect(tabs()).toEqual(['Today', 'Mess Drawer', 'Search', 'Due dates', 'More']);
    expect(store.getState().workspace!.entities.settings[0]!.bottomBar).toEqual([
      'today',
      'inbox',
      'search',
      'due',
    ]);
  });
});

describe('completion date', () => {
  it('rows show when a task was completed; details let you change or clear it', async () => {
    await renderApp('/inbox');
    await addTasks('Mow', 'Rake');
    // A start date of tomorrow, then complete: the row shows the completion day instead.
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    // An open task has no Completed field.
    expect(within(details).queryByRole('button', { name: /^Completed:/ })).toBeNull();
    await userEvent.click(within(details).getByRole('button', { name: /^Start date:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Start date' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    await userEvent.click(within(details).getByRole('checkbox', { name: 'Complete Mow' }));
    const row = screen.getByRole('button', { name: 'Open Mow' });
    expect(within(row.parentElement!).getByTestId('task-date')).toHaveTextContent('Today');
    expect(within(details).getByRole('button', { name: /^Completed: Today \d/ }));

    // Change it from the details.
    await userEvent.click(within(details).getByRole('button', { name: /^Completed:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Completed' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    expect(
      within(screen.getByRole('button', { name: 'Open Mow' }).parentElement!).getByTestId(
        'task-date',
      ),
    ).toHaveTextContent('Tomorrow');
  });

  it('completes on a chosen date from the right-click menu', async () => {
    await renderApp('/inbox');
    await addTasks('Rake');
    await userEvent.click(screen.getByRole('button', { name: 'Open Rake' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Rake' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Complete on date...' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Complete on date...' })).getByRole(
        'button',
        { name: 'Tomorrow' },
      ),
    );
    // Done right away, dated as picked, with undo.
    expect(within(details).getByRole('checkbox', { name: 'Reopen Rake' })).toBeInTheDocument();
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    expect(
      within(screen.getByRole('button', { name: 'Open Rake' }).parentElement!).getByTestId(
        'task-date',
      ),
    ).toHaveTextContent('Tomorrow');
  });
});
