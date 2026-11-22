// Another account's export imported on the same server (1.0): the server keeps each id with the
// account that made it, so the file's own ids were all refused and undone. They come in with
// fresh ids now, references and all, and nothing is undone.
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createList } from '../../core/lists.ts';
import { members } from '../../core/ops.ts';
import { createTag } from '../../core/tags.ts';
import { createTask } from '../../core/tasks.ts';
import { createTemplate, templateOfList } from '../../core/templates.ts';
import type { Task, WorkspaceFile } from '../../core/types.ts';
import { serializeWorkspace } from '../../core/workspace.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** A device signed in to `backend` as `username`, synced once. */
async function device(backend: FakeBackend, username: string) {
  const store = testStore();
  await store.getState().init();
  const sync = createSyncEngine({
    transport: Object.assign(backend.device(), { session: username }),
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await sync.getState().start();
  return { store, sync };
}

/** What `owner` holds on the server, by collection. */
function serverRows(backend: FakeBackend, owner: string, collection: string) {
  return [...backend.server.rows.values()]
    .filter((row) => row.owner === owner && row.change.collection === collection)
    .map((row) => row.change.entity);
}

describe("importing another account's export on the same server", () => {
  it('brings it all in as this account’s own, with nothing undone, and again changes nothing', async () => {
    const backend = new FakeBackend();
    const ann = backend.addAccount('ann', 'correct horse battery');
    const ben = backend.addAccount('ben', 'battery staple horse');

    // Ann's list with a tagged task and a subtask, and a template of it, on the server.
    const annDevice = await device(backend, 'ann');
    annDevice.store.getState().apply((ctx, ws) => {
      const listed = createList(ctx, ws, { name: 'Camping', color: '#CFE3A3' });
      const tagged = createTag(ctx, listed.workspace, 'outdoors');
      const tent = createTask(ctx, tagged.workspace, {
        title: 'Tent',
        listId: listed.list.id,
        tags: [tagged.tag.id],
      });
      const pegs = createTask(ctx, tent.workspace, {
        title: 'Pegs',
        listId: listed.list.id,
        parentId: tent.task.id,
      });
      return createTemplate(ctx, pegs.workspace, {
        name: 'Camping trip',
        kind: 'list',
        body: templateOfList(pegs.workspace, listed.list.id, '2026-11-22'),
      }).workspace;
    });
    await act(() => annDevice.sync.getState().syncNow());
    const annFile = annDevice.store.getState().workspace!;
    const annTent = annFile.entities.tasks.find((task) => task.title === 'Tent')!;
    expect(serverRows(backend, ann.id, 'tasks').map((task) => task.id)).toContain(annTent.id);

    // Ben imports Ann's file on his own device.
    const { store, sync } = await device(backend, 'ben');
    await store.getState().flush();
    await renderApp('/settings/data', store, sync);
    const data = await screen.findByRole('region', { name: 'Your data' });
    const upload = () =>
      userEvent.upload(
        within(data).getByLabelText('Import a file', { selector: 'input' }),
        new File([serializeWorkspace(annFile)], 'pecklist.json', { type: 'application/json' }),
      );
    await upload();
    expect(
      await within(data).findByText(
        'Imported: 2 new tasks, 1 new list, 1 new tag and 1 new template.',
      ),
    ).toBeInTheDocument();
    await act(() => sync.getState().syncNow());
    expect(screen.queryByText(/did not accept/)).not.toBeInTheDocument();

    // Ben's own now, on the server and here: fresh ids, the subtask under the new Tent, the tag
    // on it, the list his, and Ann's rows as they were.
    const bens = (collection: string) => serverRows(backend, ben.id, collection);
    const tent = bens('tasks').find((task) => (task as Task).title === 'Tent') as Task;
    const pegs = bens('tasks').find((task) => (task as Task).title === 'Pegs') as Task;
    expect(tent.id).not.toBe(annTent.id);
    expect(tent.createdBy).toBe(ben.id);
    expect(pegs.parentId).toBe(tent.id);
    const tag = bens('tags').find(
      (each) => (each as unknown as { name: string }).name === 'outdoors',
    )!;
    expect(members(tent.tags)).toEqual([tag.id]);
    const camping = bens('lists').find(
      (list) => (list as unknown as { name: string }).name === 'Camping',
    )!;
    expect(tent.listId).toBe(camping.id);
    expect(bens('templates')).toHaveLength(1);
    expect(serverRows(backend, ann.id, 'tasks').map((task) => task.id)).toContain(annTent.id);
    const here = (ws: WorkspaceFile) => ws.entities.tasks.filter((task) => task.deletedAt === null);
    expect(here(store.getState().workspace!).map((task) => task.title)).toEqual(
      expect.arrayContaining(['Tent', 'Pegs']),
    );

    // The same file again: the same fresh ids, so nothing new.
    await upload();
    expect(
      await within(data).findByText(
        'Imported: 0 new tasks, 0 new lists, 0 new tags and 0 new templates.',
      ),
    ).toBeInTheDocument();
    await act(() => sync.getState().syncNow());
    expect(screen.queryByText(/did not accept/)).not.toBeInTheDocument();
    expect(bens('tasks').filter((task) => (task as Task).title === 'Tent')).toHaveLength(1);
  });
});
