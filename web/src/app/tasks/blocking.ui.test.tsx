import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addBlocker } from '../../core/blocking.ts';
import { inboxList } from '../../core/lists.ts';
import { setElement } from '../../core/ops.ts';
import { createTask, setTaskStatus, updateTask } from '../../core/tasks.ts';
import type { Id, Task } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

/** A task in a list no one shared with this account: only its id ever arrives. */
const UNSEEN = '01TESTUNSEEN0000000000000A';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** The Mess Drawer with Buy paint, Paint the bedroom and Hang the pictures. */
async function house() {
  const store = testStore();
  await renderApp('/inbox', store);
  const ids: Record<string, Id> = {};
  store.getState().apply((ctx, ws) => {
    let next = ws;
    for (const title of ['Buy paint', 'Paint the bedroom', 'Hang the pictures']) {
      const made = createTask(ctx, next, { title, listId: inboxList(next).id });
      ids[title] = made.task.id;
      next = made.workspace;
    }
    return next;
  });
  await screen.findByRole('button', { name: 'Open Hang the pictures' });
  const task = (title: string): Task =>
    store.getState().workspace!.entities.tasks.find((each) => each.id === ids[title])!;
  const link = (blocked: string, blocker: string) =>
    store.getState().apply((ctx, ws) => addBlocker(ctx, ws, ids[blocked]!, ids[blocker]!));
  // The row: the title button and what sits beside it (under it on a phone).
  const row = (title: string) =>
    document.querySelector<HTMLElement>(`[data-task-row="${ids[title]!}"]`)!.parentElement!;
  const mark = (title: string) => within(row(title)).queryByTestId('waiting-mark');
  const openDetails = async (title: string) => {
    await userEvent.click(screen.getByRole('button', { name: `Open ${title}` }));
    return screen.findByRole('region', { name: 'Task details' });
  };
  return { store, ids, task, link, row, mark, openDetails };
}

describe('blocked-by links (PL-055)', () => {
  it('makes the first link from the task menu, with Undo, and marks the waiting row', async () => {
    const { task, ids, mark } = await house();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Paint the bedroom' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blocked by...' }));
    const picker = await screen.findByRole('dialog', { name: '"Paint the bedroom" is blocked by' });
    // Not itself.
    expect(within(picker).queryByText('Paint the bedroom')).toBeNull();
    await userEvent.type(within(picker).getByRole('textbox', { name: 'Search tasks' }), 'paint');
    await userEvent.click(within(picker).getByText('Buy paint'));

    await waitFor(() =>
      expect(task('Paint the bedroom').blockedBy[ids['Buy paint']!]?.in).toBe(true),
    );
    expect(screen.getByText('Linked to wait on Buy paint')).toBeInTheDocument();
    expect(mark('Paint the bedroom')).toHaveAccessibleName('Waiting on Buy paint');
    // An icon, no words in the row.
    expect(mark('Paint the bedroom')).toHaveTextContent('');
    expect(mark('Buy paint')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mark('Paint the bedroom')).toBeNull());
    expect(task('Paint the bedroom').blockedBy[ids['Buy paint']!]?.in).toBe(false);
  });

  it('the keyboard reaches the menu item and the picker: Enter takes the first match', async () => {
    const { task, ids } = await house();
    const row = screen.getByRole('button', { name: 'Open Hang the pictures' });
    fireEvent.contextMenu(row);
    const item = await screen.findByRole('menuitem', { name: 'Blocked by...' });
    item.focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: '"Hang the pictures" is blocked by' });
    await userEvent.keyboard('bedroom{Enter}');
    await waitFor(() =>
      expect(task('Hang the pictures').blockedBy[ids['Paint the bedroom']!]?.in).toBe(true),
    );
  });

  it('shows both sides in the details only when linked, and removes with Undo', async () => {
    const { link, openDetails, mark } = await house();
    let details = await openDetails('Hang the pictures');
    expect(within(details).queryByRole('button', { name: /^Blocked by:/ })).toBeNull();
    expect(within(details).queryByRole('button', { name: /^Blocks:/ })).toBeNull();

    link('Paint the bedroom', 'Buy paint');
    details = await openDetails('Buy paint');
    expect(
      await within(details).findByRole('button', { name: 'Blocks: Paint the bedroom' }),
    ).toBeInTheDocument();
    expect(within(details).queryByRole('button', { name: /^Blocked by:/ })).toBeNull();

    details = await openDetails('Paint the bedroom');
    await userEvent.click(within(details).getByRole('button', { name: 'Blocked by: Buy paint' }));
    const sheet = await screen.findByRole('dialog', { name: 'Blocked by' });
    await userEvent.click(
      within(sheet).getByRole('button', { name: 'Remove the link to Buy paint' }),
    );
    expect(await screen.findByText('Link to Buy paint removed')).toBeInTheDocument();
    await waitFor(() => expect(mark('Paint the bedroom')).toBeNull());
    await waitFor(() =>
      expect(within(details).queryByRole('button', { name: /^Blocked by:/ })).toBeNull(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await within(details).findByRole('button', { name: 'Blocked by: Buy paint' }),
    ).toBeInTheDocument();
    expect(mark('Paint the bedroom')).toHaveAccessibleName('Waiting on Buy paint');
  });

  it('removes from the Blocks side too, writing on the waiting task', async () => {
    const { link, openDetails, task, ids } = await house();
    link('Paint the bedroom', 'Buy paint');
    const details = await openDetails('Buy paint');
    await userEvent.click(
      await within(details).findByRole('button', { name: 'Blocks: Paint the bedroom' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Blocks' });
    await userEvent.click(
      within(sheet).getByRole('button', { name: 'Remove the link to Paint the bedroom' }),
    );
    await waitFor(() =>
      expect(task('Paint the bedroom').blockedBy[ids['Buy paint']!]?.in).toBe(false),
    );
    expect(screen.getByText('Link to Paint the bedroom removed')).toBeInTheDocument();
  });

  it('the mark goes when every blocker is done or won’t do', async () => {
    const { store, link, ids, mark } = await house();
    link('Hang the pictures', 'Buy paint');
    link('Hang the pictures', 'Paint the bedroom');
    await waitFor(() =>
      expect(mark('Hang the pictures')).toHaveAccessibleName('Waiting on Buy paint and 1 more'),
    );
    store.getState().apply((ctx, ws) => setTaskStatus(ctx, ws, ids['Buy paint']!, 'done'));
    await waitFor(() =>
      expect(mark('Hang the pictures')).toHaveAccessibleName('Waiting on Paint the bedroom'),
    );
    store
      .getState()
      .apply((ctx, ws) => setTaskStatus(ctx, ws, ids['Paint the bedroom']!, 'wontdo'));
    await waitFor(() => expect(mark('Hang the pictures')).toBeNull());
  });

  it('on a phone, a row keeps its second line when its last blocker is done (no height change)', async () => {
    mockViewport('phone');
    const { store, link, ids, row, mark } = await house();
    const meta = () => within(row('Paint the bedroom')).queryByTestId('task-meta');
    // Nothing else to show: no second line.
    expect(meta()).toBeNull();
    link('Paint the bedroom', 'Buy paint');
    await waitFor(() => expect(mark('Paint the bedroom')).not.toBeNull());
    expect(meta()).not.toBeNull();
    store.getState().apply((ctx, ws) => setTaskStatus(ctx, ws, ids['Buy paint']!, 'done'));
    await waitFor(() => expect(mark('Paint the bedroom')).toBeNull());
    // The line stays while the link does, one text line high with nothing in it (QA: 58 to 43 px).
    expect(meta()).not.toBeNull();
    expect(parseFloat(getComputedStyle(meta()!).minHeight)).toBeCloseTo(13 * 1.43, 1);
  });

  it('warns when the waiting task starts before its blocker ends', async () => {
    const { store, link, ids, mark, openDetails } = await house();
    link('Paint the bedroom', 'Buy paint');
    store.getState().apply((ctx, ws) => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const at = updateTask(ctx, ws, ids['Buy paint']!, {
        schedule: { start: '2026-12-01', end: '2026-12-03', allDay: true, timeZone: zone },
      });
      return updateTask(ctx, at, ids['Paint the bedroom']!, {
        schedule: { start: '2026-12-02', end: null, allDay: true, timeZone: zone },
      });
    });
    await waitFor(() =>
      expect(mark('Paint the bedroom')).toHaveAccessibleName(
        'Waiting on Buy paint. Starts before Buy paint ends',
      ),
    );
    const details = await openDetails('Paint the bedroom');
    expect(
      within(details).getByRole('button', {
        name: 'Blocked by: Buy paint. Starts before Buy paint ends',
      }),
    ).toBeInTheDocument();
    // Done, the blocker holds nothing up: no warning left in the details either.
    store.getState().apply((ctx, ws) => setTaskStatus(ctx, ws, ids['Buy paint']!, 'done'));
    expect(
      await within(details).findByRole('button', { name: 'Blocked by: Buy paint' }),
    ).toBeInTheDocument();
  });

  it('a task this account can’t see is counted in the details, never named, and lights no mark', async () => {
    const { store, ids, mark, openDetails } = await house();
    store.getState().apply((ctx, ws) => {
      const task = ws.entities.tasks.find((each) => each.id === ids['Paint the bedroom'])!;
      return updateTask(ctx, ws, task.id, {
        blockedBy: setElement(ctx, task.blockedBy, UNSEEN, true),
      });
    });
    const details = await openDetails('Paint the bedroom');
    await userEvent.click(
      await within(details).findByRole('button', { name: 'Blocked by: A task you cannot see' }),
    );
    expect(mark('Paint the bedroom')).toBeNull();
    const sheet = await screen.findByRole('dialog', { name: 'Blocked by' });
    await userEvent.click(
      within(sheet).getByRole('button', {
        name: 'Remove the link to the task you cannot see',
      }),
    );
    expect(await screen.findByText('Link removed')).toBeInTheDocument();
  });

  it('the picker leaves out a task that would make a loop', async () => {
    const { link } = await house();
    link('Paint the bedroom', 'Buy paint');
    link('Hang the pictures', 'Paint the bedroom');
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open Buy paint' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Blocked by...' }));
    const picker = await screen.findByRole('dialog', { name: '"Buy paint" is blocked by' });
    expect(within(picker).queryByText('Paint the bedroom')).toBeNull();
    expect(within(picker).queryByText('Hang the pictures')).toBeNull();
    expect(within(picker).getByText('No task it could wait on.')).toBeInTheDocument();
  });
});
