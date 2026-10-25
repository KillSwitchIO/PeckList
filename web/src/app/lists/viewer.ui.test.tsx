import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { putEntity } from '../../core/collections.ts';
import { createList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { createTask } from '../../core/tasks.ts';
import type { Role } from '../../core/sharing.ts';
import type { ListMember } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

const SAM = '01JBSAM0000000000000000002';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** Sam's list "Garden" with "Fix fence", shared with me in `role`, as it syncs to my device. */
async function samsList(role: Role) {
  const store = testStore();
  await store.getState().init();
  let listId = '';
  store.getState().apply((ctx, ws) => {
    const created = createList(ctx, ws, { name: 'Garden', color: '#CFE3A3' });
    const list = { ...created.list, createdBy: SAM, visibility: 'shared' as const };
    listId = list.id;
    const task = createTask(ctx, putEntity(created.workspace, 'lists', list), {
      title: 'Fix fence',
      listId,
    });
    const member = createEntity<ListMember>(ctx, {
      listId,
      principal: `user:${ctx.userId}`,
      role,
    });
    return putEntity(task.workspace, 'listMembers', member);
  });
  await store.getState().flush();
  await renderApp(`/lists/${listId}`, store);
  return store;
}

describe('a list I can only view', () => {
  it('shows its tasks without the controls that change them', async () => {
    await samsList('viewer');
    expect(await screen.findByText(/You can view this list/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Add task/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Complete Fix fence' })).toBeDisabled();

    // Only the view options: no list actions at all.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'View options' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Group by date' })).toBeInTheDocument();
    expect(within(menu).queryByText('Edit list')).toBeNull();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'Open Fix fence' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    expect(within(details).getByRole('textbox', { name: 'Title' })).toHaveAttribute('readonly');
    // Empty fields are left out; set ones show but do not open.
    expect(within(details).queryByRole('button', { name: /^Due:/ })).toBeNull();
    expect(within(details).queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(within(details).getByRole('button', { name: /^Start date:/ })).toBeDisabled();
    expect(within(details).queryByRole('button', { name: 'Delete task' })).toBeNull();
    expect(within(details).queryByRole('button', { name: 'Task actions' })).toBeNull();
    expect(within(details).queryByRole('textbox', { name: 'Add subtask' })).toBeNull();
  });

  it('editors change tasks but not the list', async () => {
    await samsList('editor');
    expect(await screen.findByRole('textbox', { name: /Add task/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Complete Fix fence' })).toBeEnabled();
    // The list itself is the owner's: no edit, archive or delete.
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'View options' })).toBeInTheDocument();
  });
});
