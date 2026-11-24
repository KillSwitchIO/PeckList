import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { isLive } from '../../core/collections.ts';
import { createList } from '../../core/lists.ts';
import { createTask, setTaskStatus } from '../../core/tasks.ts';
import { blankTask, createTemplate, templatesOf } from '../../core/templates.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const today = () => todayIn(localTimeZone(), Date.now());
const tasks = (ws: WorkspaceFile) => ws.entities.tasks.filter(isLive);

describe('templates (PL-140)', () => {
  it('are made, filled in and used from their own page', async () => {
    const store = testStore();
    await renderApp('/templates', store);
    expect(await screen.findByText(/No task templates yet/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New template' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New task template' }));
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Template name' }),
      'Trip{Enter}',
    );

    // Straight on to the editor: a subtask, and due two days after it is used.
    const editor = await screen.findByRole('dialog', { name: 'Edit template' });
    // The title starts as the name.
    const title = within(editor).getByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('Trip');
    await userEvent.clear(title);
    await userEvent.type(title, 'Pack');
    await userEvent.type(
      within(editor).getByRole('textbox', { name: 'Add subtask' }),
      'Socks{Enter}',
    );
    const due = within(editor).getByText('Due').parentElement!;
    await userEvent.click(within(due).getByRole('button', { name: 'Add date' }));
    const days = within(editor).getByRole('spinbutton', { name: 'Days from use' });
    await userEvent.clear(days);
    await userEvent.type(days, '2');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    const group = await screen.findByRole('list', { name: 'Tasks' });
    expect(within(group).getByText('Trip')).toBeInTheDocument();
    expect(within(group).getByText('1 subtask, Due in 2 days')).toBeInTheDocument();
    // A template is not a task: nothing in the views yet.
    expect(tasks(store.getState().workspace!)).toHaveLength(0);

    await userEvent.click(within(group).getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(tasks(store.getState().workspace!)).toHaveLength(2));
    const made = tasks(store.getState().workspace!).find((task) => task.parentId === null)!;
    expect(made).toMatchObject({ title: 'Pack', due: { at: addDays(today(), 2), allDay: true } });
    expect(templatesOf(store.getState().workspace!)[0]!.uses).toBe(1);

    // Opened full screen; closed, one Undo takes back everything it made.
    expect(await screen.findByDisplayValue('Pack')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(tasks(store.getState().workspace!)).toHaveLength(0));
  });

  it("edit their notes like a task's: formatted, in the full editor with its toolbar (PL-149)", async () => {
    const store = testStore();
    await renderApp('/templates', store);
    await userEvent.click(await screen.findByRole('button', { name: 'New template' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New task template' }));
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Template name' }),
      'Trip{Enter}',
    );
    const editor = await screen.findByRole('dialog', { name: 'Edit template' });
    await within(editor).findByRole('textbox', { name: 'Notes' });
    await userEvent.click(within(editor).getByRole('button', { name: 'Full editor' }));
    const full = await screen.findByRole('dialog', { name: 'Trip' });
    expect(within(full).getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
    await userEvent.type(await within(full).findByRole('textbox', { name: 'Notes' }), 'Passport');
    await userEvent.click(within(full).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Trip' })).toBeNull());
    expect(within(editor).getByRole('textbox', { name: 'Notes' })).toHaveTextContent('Passport');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    // Used, the task it makes has them.
    const group = await screen.findByRole('list', { name: 'Tasks' });
    await userEvent.click(within(group).getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(tasks(store.getState().workspace!)).toHaveLength(1));
    expect(tasks(store.getState().workspace!)[0]!.notes).toBe('Passport');
  });

  it('keep notes typed inline when Save is clicked straight away', async () => {
    const store = testStore();
    await renderApp('/templates', store);
    await userEvent.click(await screen.findByRole('button', { name: 'New template' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New task template' }));
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Template name' }),
      'Trip{Enter}',
    );
    const editor = await screen.findByRole('dialog', { name: 'Edit template' });
    // The editor commits on blur: Save's press takes the focus, so what was typed is saved.
    await userEvent.type(await within(editor).findByRole('textbox', { name: 'Notes' }), 'Tickets');
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    const group = await screen.findByRole('list', { name: 'Tasks' });
    await userEvent.click(within(group).getByRole('button', { name: 'Use' }));
    await waitFor(() => expect(tasks(store.getState().workspace!)).toHaveLength(1));
    expect(tasks(store.getState().workspace!)[0]!.notes).toBe('Tickets');
  });

  it('close the task they opened when Undo takes it back', async () => {
    const store = testStore();
    await renderApp('/templates', store);
    store
      .getState()
      .apply(
        (ctx, ws) =>
          createTemplate(ctx, ws, { name: 'Trip', kind: 'task', body: blankTask('Pack') })
            .workspace,
      );
    const group = await screen.findByRole('list', { name: 'Tasks' });
    await userEvent.click(within(group).getByRole('button', { name: 'Use' }));
    expect(await screen.findByDisplayValue('Pack')).toBeInTheDocument();

    // Undo with the task still open full screen: the view closes, back to the templates, instead
    // of staying up to say the task no longer exists. The toast is drawn above the full view for a
    // pointer, while the view, a modal, hides it from the accessibility tree: hence `hidden`.
    await userEvent.click(screen.getByRole('button', { name: 'Undo', hidden: true }));
    await waitFor(() => expect(tasks(store.getState().workspace!)).toHaveLength(0));
    await waitFor(() => expect(screen.queryByDisplayValue('Pack')).toBeNull());
    expect(screen.queryByText('This task no longer exists.')).toBeNull();
    // Back on the templates page once the view has gone.
    const back = await screen.findByRole('list', { name: 'Tasks' });
    expect(within(back).getByText('Trip')).toBeInTheDocument();
  });

  it('are offered in quick add, with the words typed so far as the title', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    // No templates, no extra button.
    expect(screen.queryByRole('button', { name: 'From template' })).toBeNull();
    store.getState().apply((ctx, ws) => {
      const body = { ...blankTask('Pack'), subtasks: [blankTask('Socks')] };
      return createTemplate(ctx, ws, { name: 'Trip', kind: 'task', body }).workspace;
    });
    const field = screen.getByRole('textbox', { name: /Add task/ });
    // Words quick add reads (a date) are left out: the template has its own dates.
    await userEvent.type(field, 'Pack for Rome tomorrow');
    await userEvent.click(await screen.findByRole('button', { name: 'From template' }));
    const picker = await screen.findByRole('dialog', { name: 'Pick a task template' });
    await userEvent.type(within(picker).getByRole('textbox', { name: 'Search templates' }), 'tr');
    await userEvent.click(within(picker).getByRole('button', { name: /Trip/ }));

    await waitFor(() => expect(tasks(store.getState().workspace!)).toHaveLength(2));
    const made = tasks(store.getState().workspace!);
    expect(made.map((task) => task.title).sort()).toEqual(['Pack for Rome', 'Socks']);
    expect(field).toHaveValue('');
    // Opened full screen, ready to tweak.
    expect(await screen.findByDisplayValue('Pack for Rome')).toBeInTheDocument();
  });

  it('make a new list, tasks and all, from the new list dialog', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    store.getState().apply(
      (ctx, ws) =>
        createTemplate(ctx, ws, {
          name: 'Camping',
          kind: 'list',
          body: { name: 'Camping', color: '#2e7d32', icon: null, tasks: [blankTask('Tent')] },
        }).workspace,
    );
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByRole('button', { name: 'New list' }));
    const dialog = await screen.findByRole('dialog', { name: 'New list' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'From template' }));
    await userEvent.click(await screen.findByRole('button', { name: /Camping/ }));
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Camping');
    await userEvent.clear(name);
    await userEvent.type(name, 'Camping in May');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(
        store.getState().workspace!.entities.lists.some((list) => list.name === 'Camping in May'),
      ).toBe(true),
    );
    const ws = store.getState().workspace!;
    const list = ws.entities.lists.find((each) => each.name === 'Camping in May')!;
    expect(
      tasks(ws)
        .filter((task) => task.listId === list.id)
        .map((task) => task.title),
    ).toEqual(['Tent']);
  });

  it("are saved from a task's menu and a list's menu", async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    let listId = '';
    store.getState().apply((ctx, ws) => {
      const list = createList(ctx, ws, { name: 'Camping', color: '#2e7d32', icon: null });
      listId = list.list.id;
      const tent = createTask(ctx, list.workspace, {
        title: 'Tent',
        listId,
        due: { at: addDays(today(), 3), allDay: true, timeZone: localTimeZone() },
      });
      let next = createTask(ctx, tent.workspace, {
        title: 'Pegs',
        listId,
        parentId: tent.task.id,
      }).workspace;
      const old = createTask(ctx, next, { title: 'Old poles', listId, parentId: tent.task.id });
      next = setTaskStatus(ctx, old.workspace, old.task.id, 'done');
      return next;
    });
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(await within(nav).findByRole('button', { name: /^Camping/ }));

    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Open Tent' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Save as template' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save as template' });
    expect(within(dialog).getByRole('textbox', { name: 'Template name' })).toHaveValue('Tent');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(templatesOf(store.getState().workspace!, 'task')).toHaveLength(1));
    const task = templatesOf(store.getState().workspace!, 'task')[0]!;
    // Its due date as days from today, and only its open subtasks.
    expect(task.body).toMatchObject({ title: 'Tent', due: { inDays: 3, time: null } });
    expect((task.body.subtasks as { title: string }[]).map((each) => each.title)).toEqual(['Pegs']);

    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Save as template' }));
    const forList = await screen.findByRole('dialog', { name: 'Save as template' });
    const name = within(forList).getByRole('textbox', { name: 'Template name' });
    // Starts as the list's name.
    expect(name).toHaveValue('Camping');
    await userEvent.clear(name);
    await userEvent.type(name, 'Trip{Enter}');
    await waitFor(() => expect(templatesOf(store.getState().workspace!, 'list')).toHaveLength(1));
    const list = templatesOf(store.getState().workspace!, 'list')[0]!;
    expect(list.name).toBe('Trip');
    expect(list.body).toMatchObject({ name: 'Camping', color: '#2e7d32' });
  });

  it('sit with the other pages on a phone', async () => {
    mockViewport('phone');
    await renderApp('/more', testStore());
    // In the More group, as on the sidebar.
    await userEvent.click(await screen.findByRole('button', { name: /^More/, expanded: false }));
    await userEvent.click(await screen.findByRole('button', { name: /Templates/ }));
    expect(await screen.findByRole('heading', { name: 'Templates' })).toBeInTheDocument();
  });
});
