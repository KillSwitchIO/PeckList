import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
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

  it('moves a task to a list section from the footer menu', async () => {
    await renderApp('/inbox');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add section' }));
    await userEvent.type(
      within(await screen.findByRole('dialog')).getByLabelText('Section name'),
      'Yard{Enter}',
    );
    await addTasks('Rake');
    await userEvent.click(screen.getByRole('button', { name: 'Open Rake' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'List: Mess Drawer' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Yard' }));
    expect(
      within(details).getByRole('button', { name: 'List: Mess Drawer / Yard' }),
    ).toBeInTheDocument();
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
    expect(within(details).getByLabelText(/^Created \d{8} \d{2}:\d{2}$/)).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    // Nothing to edit: no Edit list, Archive or Delete.
    expect(await screen.findByRole('menuitem', { name: 'Add section' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Edit list' })).toBeNull();
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

    // Any emoji can be typed instead; only its first character is kept.
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit list' }));
    const edit = await screen.findByRole('dialog');
    await userEvent.type(within(edit).getByLabelText('Or type any emoji'), '🥕🥦');
    expect(within(edit).getByLabelText('Or type any emoji')).toHaveValue('🥕');
    await userEvent.click(within(edit).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: /^Groceries/ })).toHaveTextContent('🥕'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit list' }));
    const again = await screen.findByRole('dialog');
    await userEvent.click(within(again).getByRole('radio', { name: 'No icon' }));
    await userEvent.click(within(again).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: /^Groceries/ })).not.toHaveTextContent('🥕'),
    );
  });

  it('adds, renames and deletes a section', async () => {
    await renderApp('/inbox');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Add section' }));
    await userEvent.type(
      within(await screen.findByRole('dialog')).getByLabelText('Section name'),
      'Yard{Enter}',
    );
    expect(await screen.findByRole('heading', { level: 2, name: /^Yard/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add task: Yard' }));
    const inputs = screen.getAllByRole('textbox', { name: /add task/i });
    await userEvent.type(inputs[inputs.length - 1]!, 'Rake leaves{Enter}');
    expect(screen.getByRole('button', { name: 'Open Rake leaves' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More actions: Yard' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const rename = within(await screen.findByRole('dialog')).getByLabelText('Section name');
    await userEvent.clear(rename);
    await userEvent.type(rename, 'Garden{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: /^Garden/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More actions: Garden' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete section' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 2, name: /^Garden/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Open Rake leaves' })).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit list' }));
    const name = within(await screen.findByRole('dialog')).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Job{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Job' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
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

  it('Next 7 days, Completed and Trash with restore', async () => {
    const store = testStore();
    await renderApp('/upcoming', store);
    expect(screen.getByText('Nothing planned for the next 7 days.')).toBeInTheDocument();
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

  it('Next 7 days also shows overdue and today', async () => {
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
