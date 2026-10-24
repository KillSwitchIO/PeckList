import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { shareList } from '../../core/sharing.ts';
import { createTask } from '../../core/tasks.ts';
import type { User } from '../../core/types.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const SAM = '01TESTMEMBER0000000000SAM1';

/** A list shared with Sam, holding one task; its details open. */
async function sharedTask() {
  const store = testStore();
  await renderApp('/today', store);
  let listId = '';
  act(() =>
    store.getState().apply((ctx, ws) => {
      const sam = createEntity<User>(
        ctx,
        {
          handle: 'sam@tasks.example.com',
          displayName: 'Sam Lee',
          avatarColor: '#A8DCC0',
          homeServer: 'tasks.example.com',
        },
        SAM,
      );
      let next = { ...ws, entities: { ...ws.entities, users: [...ws.entities.users, sam] } };
      const list = createList(ctx, next, { name: 'Shed', color: '#A7C7E7' });
      listId = list.list.id;
      next = shareList(ctx, list.workspace, listId, `user:${SAM}`, 'editor');
      return createTask(ctx, next, { title: 'Paint the shed', listId }).workspace;
    }),
  );
  const nav = screen.getAllByRole('navigation')[0]!;
  await userEvent.click(within(nav).getByRole('button', { name: /^Shed/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Open Paint the shed' }));
  const details = await screen.findByRole('region', { name: 'Task details' });
  return { store, details };
}

describe('comments', () => {
  it('posts with Ctrl+Enter, mentions people on the task, edits and deletes', async () => {
    const { details } = await sharedTask();
    const box = within(details).getByRole('textbox', { name: /Add a comment/ });
    await userEvent.type(box, 'Blue? ask @sa');
    const people = await screen.findByRole('menu', { name: 'People to mention' });
    await userEvent.click(within(people).getByRole('menuitem', { name: /Sam Lee/ }));
    expect(box).toHaveValue('Blue? ask @sam ');
    await userEvent.type(box, '**today**{Control>}{Enter}{/Control}');

    const comments = within(details).getByRole('region', { name: 'Comments' });
    expect(comments).toHaveTextContent('Comments (1)');
    const mine = within(comments).getByRole('listitem', { name: 'Comment by You' });
    expect(mine).toHaveTextContent('Blue? ask @sam today');
    expect(within(mine).getByText('today').tagName).toBe('STRONG');
    expect(box).toHaveValue('');

    await userEvent.click(
      within(mine).getByRole('button', { name: 'Actions for the comment by You' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const editor = within(mine).getByRole('textbox', { name: 'Edit the comment' });
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Green after all');
    await userEvent.click(within(mine).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mine).toHaveTextContent(/Green after all/));
    expect(mine).toHaveTextContent('edited');

    await userEvent.click(
      within(mine).getByRole('button', { name: 'Actions for the comment by You' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(within(details).queryByRole('listitem', { name: 'Comment by You' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(
      await within(details).findByRole('listitem', { name: 'Comment by You' }),
    ).toHaveTextContent('Green after all');
  });
});
