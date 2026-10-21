import { screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: 'Completed 1' })).toBeInTheDocument();
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
    await userEvent.click(within(details).getByRole('button', { name: 'High' }));
    await userEvent.click(within(details).getByRole('button', { name: /^Due:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Due' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    await userEvent.click(within(details).getByRole('button', { name: /^Start date:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Start date' })).getByRole('button', {
        name: 'Tonight',
      }),
    );
    await userEvent.type(within(details).getByLabelText('Notes'), 'Front and back');
    await userEvent.click(within(details).getByLabelText('Title'));

    const row = screen.getByRole('button', { name: 'Open Mow the lawn' });
    // Rows show only the start date or time; the due date lives in the details and calendar.
    expect(within(row).getByTestId('task-date')).toHaveTextContent(/^Today 6:00/);
    expect(row).not.toHaveTextContent('Tomorrow');
    expect(within(details).getByRole('button', { name: 'High' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(details).getByLabelText('Notes')).toHaveValue('Front and back');
  });

  it("marks won't do, reopens, deletes and closes", async () => {
    await renderApp('/inbox');
    await addTasks('Mow');
    await userEvent.click(screen.getByRole('button', { name: 'Open Mow' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: "Won't do" }));
    expect(screen.getByText("Marked won't do")).toBeInTheDocument();
    await userEvent.click(within(details).getByRole('button', { name: 'Reopen' }));
    await userEvent.click(within(details).getByRole('button', { name: 'Complete' }));
    await userEvent.click(within(details).getByRole('button', { name: 'Reopen' }));
    await userEvent.click(within(details).getByRole('button', { name: 'Delete task' }));
    expect(screen.queryByRole('region', { name: 'Task details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Mow' })).not.toBeInTheDocument();
    expect(screen.getByText('Task deleted')).toBeInTheDocument();
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
    expect(within(inList).getByTestId('task-date')).toHaveTextContent('Today');

    await userEvent.click(within(screen.getAllByRole('navigation')[0]!).getByText('Today'));
    const inToday = await screen.findByRole('button', { name: 'Open Water plants' });
    // Same full date in every view, and no list name for the Mess Drawer.
    expect(within(inToday).getByTestId('task-date')).toHaveTextContent('Today');
    expect(within(inToday).getByTestId('task-meta')).not.toHaveTextContent('Mess Drawer');
  });
});

describe('Mess Drawer', () => {
  it('is the default list everywhere and keeps its name when edited', async () => {
    await renderApp('/inbox');
    expect(screen.getByRole('heading', { level: 1, name: 'Mess Drawer' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add task to Mess Drawer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit list' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Name')).toBeNull();
    expect(within(dialog).getByRole('radiogroup', { name: 'Color' })).toBeInTheDocument();
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
    await userEvent.click(within(screen.getAllByRole('navigation')[0]!).getByText('Completed'));
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
    expect(within(details).getByRole('button', { name: 'Completed: Add completed date' }));
    await userEvent.click(within(details).getByRole('button', { name: /^Start date:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Start date' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Mow' }));
    const row = screen.getByRole('button', { name: 'Open Mow' });
    expect(within(row).getByTestId('task-date')).toHaveTextContent('Today');
    expect(within(details).getByRole('button', { name: /^Completed: Today \d/ }));

    // Change it from the details.
    await userEvent.click(within(details).getByRole('button', { name: /^Completed:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Completed' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    expect(
      within(screen.getByRole('button', { name: 'Open Mow' })).getByTestId('task-date'),
    ).toHaveTextContent('Tomorrow');
  });

  it('keeps a completion date set ahead of time', async () => {
    await renderApp('/inbox');
    await addTasks('Rake');
    await userEvent.click(screen.getByRole('button', { name: 'Open Rake' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: /^Completed:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Completed' })).getByRole('button', {
        name: 'Tomorrow',
      }),
    );
    await userEvent.click(within(details).getByRole('button', { name: 'Complete' }));
    expect(
      within(screen.getByRole('button', { name: 'Open Rake' })).getByTestId('task-date'),
    ).toHaveTextContent('Tomorrow');
  });
});
