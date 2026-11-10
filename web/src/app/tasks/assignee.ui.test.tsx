import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { putEntity } from '../../core/collections.ts';
import { createList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { assigneesOf, setAssignee } from '../../core/sharing.ts';
import { createTask } from '../../core/tasks.ts';
import type { OpContext } from '../../core/ops.ts';
import type { Friendship, GroupMember, User, WorkspaceFile } from '../../core/types.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

const SAM = '01JBSAM0000000000000000002';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** A list with "Fix fence" and a friend, Sam; with a server unless `standalone`. */
async function setup(
  standalone = false,
  extra: (ctx: OpContext, ws: WorkspaceFile, taskId: string) => WorkspaceFile = (_, ws) => ws,
) {
  const store = testStore();
  await store.getState().init();
  let listId = '';
  let taskId = '';
  let sync;
  const backend = new FakeBackend();
  if (!standalone) {
    backend.addAccount('ben', 'correct horse battery');
    sync = createSyncEngine({
      transport: Object.assign(backend.device(), { session: 'ben' }),
      workspace: store,
      storage: createMemoryStorage(),
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    await sync.getState().start();
  }
  store.getState().apply((ctx, ws) => {
    const { workspace, list } = createList(ctx, ws, { name: 'Garden', color: '#CFE3A3' });
    listId = list.id;
    const created = createTask(ctx, workspace, { title: 'Fix fence', listId });
    taskId = created.task.id;
    const sam = createEntity<User>(
      ctx,
      { handle: 'sam', displayName: 'Sam', avatarColor: '#F4B6C2', homeServer: 'local' },
      SAM,
    );
    const friendship = createEntity<Friendship>(ctx, {
      userA: ctx.userId,
      userB: SAM,
      state: 'accepted',
    });
    return extra(
      ctx,
      putEntity(putEntity(created.workspace, 'users', sam), 'friendships', friendship),
      taskId,
    );
  });
  await store.getState().flush();
  await renderApp(`/lists/${listId}`, store, sync);
  await userEvent.click(await screen.findByRole('button', { name: 'Open Fix fence' }));
  const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === taskId)!;
  return { task, backend, me: () => store.getState().context().userId };
}

describe('assigning a task', () => {
  it('assigns friends and me from the details panel', async () => {
    const { task } = await setup();
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Assigned: Nobody' }));
    const picker = await screen.findByRole('dialog', { name: 'Assign to' });
    const items = within(picker).getAllByRole('menuitemcheckbox');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName(/^Me\b/);
    expect(items[1]).toHaveAccessibleName(/^Sam\b/);

    await userEvent.click(within(picker).getByRole('menuitemcheckbox', { name: /Sam/ }));
    expect(assigneesOf(task())).toEqual([`user:${SAM}`]);
    expect(within(picker).getByRole('menuitemcheckbox', { name: /Sam/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(picker).getByRole('menuitemcheckbox', { name: /^Me\b/ }));
    expect(assigneesOf(task())).toHaveLength(2);
    await userEvent.keyboard('{Escape}');
    expect(
      within(details).getByRole('button', { name: /^Assigned: (Sam|Me) and 1 more$/ }),
    ).toBeInTheDocument();
    // The row in the list shows who it is for.
    expect(screen.getByRole('img', { name: /^Assigned to .*Sam/ })).toBeInTheDocument();

    // Taking Sam off leaves just me.
    await userEvent.click(within(details).getByRole('button', { name: /^Assigned:/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Assign to' })).getByRole(
        'menuitemcheckbox',
        { name: /Sam/ },
      ),
    );
    await userEvent.keyboard('{Escape}');
    expect(within(details).getByRole('button', { name: 'Assigned: Me' })).toBeInTheDocument();
  });

  it("shows a task assigned from someone else's list", async () => {
    const store = testStore();
    await store.getState().init();
    store.getState().apply((ctx, ws) => {
      const { workspace, list } = createList(ctx, ws, { name: 'Theirs', color: '#CFE3A3' });
      const created = createTask(ctx, workspace, { title: 'Water beans', listId: list.id });
      const assigned = setAssignee(
        ctx,
        created.workspace,
        created.task.id,
        `user:${ctx.userId}`,
        true,
      );
      // As it arrives from the server: the task without its list.
      return {
        ...assigned,
        entities: {
          ...assigned.entities,
          lists: assigned.entities.lists.filter((each) => each.id !== list.id),
        },
      };
    });
    await store.getState().flush();
    await renderApp('/assigned', store);
    await userEvent.click(await screen.findByRole('button', { name: 'Open Water beans' }));
    const details = await screen.findByRole('region', { name: 'Task details' });
    expect(within(details).getByText("Someone else's list")).toBeInTheDocument();
  });

  it('invites someone by username: a friend request, and the task waits for them', async () => {
    const { task, backend, me } = await setup();
    const kim = backend.addAccount('kim', 'kims own password');
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Assigned: Nobody' }));
    const picker = await screen.findByRole('dialog', { name: 'Assign to' });
    const search = within(picker).getByRole('textbox', { name: 'Search or invite by username' });

    // Typing narrows the list; an unknown name is not found.
    await userEvent.type(search, 'nobody');
    expect(within(picker).queryByRole('menuitemcheckbox')).toBeNull();
    await userEvent.click(within(picker).getByRole('button', { name: /Invite "nobody"/ }));
    expect(await within(picker).findByText('Nobody here goes by that name.')).toBeInTheDocument();

    await userEvent.clear(search);
    await userEvent.type(search, 'kim{Enter}');
    await waitFor(() => expect(assigneesOf(task())).toEqual([`invite:${kim.id}:${me()}`]));
    expect(
      await within(picker).findByRole('menuitemcheckbox', { name: /\(invited\)/ }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('says when there were too many lookups, not that nobody goes by that name (audit S13)', async () => {
    const { task, backend, me } = await setup();
    const kim = backend.addAccount('kim', 'kims own password');
    backend.tooManyLookups = 150;
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Assigned: Nobody' }));
    const picker = await screen.findByRole('dialog', { name: 'Assign to' });
    const search = within(picker).getByRole('textbox', { name: 'Search or invite by username' });
    await userEvent.type(search, 'kim');
    await userEvent.click(within(picker).getByRole('button', { name: /Invite "kim"/ }));
    expect(
      await within(picker).findByText('Too many lookups. Try again in 3 minutes.'),
    ).toBeInTheDocument();
    expect(within(picker).queryByText('Nobody here goes by that name.')).toBeNull();
    expect(assigneesOf(task())).toEqual([]);

    // The wait is over: the same invite goes through.
    backend.tooManyLookups = undefined;
    await userEvent.click(within(picker).getByRole('button', { name: /Invite "kim"/ }));
    await waitFor(() => expect(assigneesOf(task())).toEqual([`invite:${kim.id}:${me()}`]));
    expect(within(picker).queryByText(/Too many lookups/)).toBeNull();
  });

  it('dibs takes a group chore for me', async () => {
    const group = '01JBGR0000000000000000000G';
    const { task } = await setup(false, (ctx, ws, taskId) => {
      const member = createEntity<GroupMember>(ctx, {
        groupId: group,
        userId: ctx.userId,
        joinedAt: new Date().toISOString(),
        state: 'active',
      });
      return setAssignee(
        ctx,
        putEntity(ws, 'groupMembers', member),
        taskId,
        `group:${group}`,
        true,
      );
    });
    const details = await screen.findByRole('region', { name: 'Task details' });
    await userEvent.click(within(details).getByRole('button', { name: 'Dibs' }));
    expect(assigneesOf(task())).toEqual([`user:${task().createdBy}`]);
    expect(within(details).queryByRole('button', { name: 'Dibs' })).toBeNull();
    expect(within(details).getByRole('button', { name: 'Assigned: Me' })).toBeInTheDocument();
  });

  it('is not offered without a server', async () => {
    await setup(true);
    const details = await screen.findByRole('region', { name: 'Task details' });
    expect(within(details).queryByRole('button', { name: /^Assigned:/ })).toBeNull();
  });
});
