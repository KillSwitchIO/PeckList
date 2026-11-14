import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { shareList } from '../../core/sharing.ts';
import { createTask } from '../../core/tasks.ts';
import type { Group, GroupMember, User } from '../../core/types.ts';
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
  // A long flow: under a full parallel run with coverage it can pass 15 seconds.
  it('posts with Ctrl+Enter, mentions people on the task, edits and deletes', async () => {
    const { details } = await sharedTask();
    const box = within(details).getByRole('textbox', { name: /Add a comment/ });
    await userEvent.type(box, 'Blue? ask @sa');
    const people = await screen.findByRole('menu', { name: 'People and groups to mention' });
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
  }, 30_000);

  // Ben, 2026-11-12: a group in the @ list writes each member who can see the task (the server
  // notifies by name, and only people who can see the task); the others are left out.
  it('mentions a group as its members who can see the task', async () => {
    const { store, details } = await sharedTask();
    const ANA = '01TESTMEMBER0000000000ANA1';
    const KIM = '01TESTMEMBER0000000000KIM1';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const person = (id: string, name: string, handle: string) =>
          createEntity<User>(
            ctx,
            { handle, displayName: name, avatarColor: '#A8DCC0', homeServer: 'tasks.example.com' },
            id,
          );
        const ana = person(ANA, 'Ana Cole', 'ana@tasks.example.com');
        const kim = person(KIM, 'Kim Park', 'kim@tasks.example.com');
        const group = createEntity<Group>(ctx, {
          name: 'Home garden',
          color: '#7FB77E',
          ownerId: ctx.userId,
          archived: false,
        });
        const members = [SAM, ANA, KIM].map((userId) =>
          createEntity<GroupMember>(ctx, {
            groupId: group.id,
            userId,
            joinedAt: '2026-11-12T10:00:00Z',
            state: 'active',
          }),
        );
        const listId = ws.entities.tasks.find((each) => each.title === 'Paint the shed')!.listId;
        const next = {
          ...ws,
          entities: {
            ...ws.entities,
            users: [...ws.entities.users, ana, kim],
            groups: [...ws.entities.groups, group],
            groupMembers: [...ws.entities.groupMembers, ...members],
          },
        };
        // Ana sees the task through the list; Kim does not.
        return shareList(ctx, next, listId, `user:${ANA}`, 'viewer');
      }),
    );

    const box = within(details).getByRole('textbox', { name: /Add a comment/ });
    await userEvent.type(box, 'Seeds, (@gar');
    const menu = await screen.findByRole('menu', { name: 'People and groups to mention' });
    const garden = within(menu).getByRole('menuitem', { name: /Home garden/ });
    expect(garden).toHaveTextContent('@ana @sam');
    expect(garden).not.toHaveTextContent('@kim');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('Seeds, (@ana @sam ');
  }, 30_000);
});
