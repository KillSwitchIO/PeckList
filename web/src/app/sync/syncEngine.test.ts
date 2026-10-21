import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createAjvValidator } from '../../adapters/ajv-validator.ts';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createUlidGenerator } from '../../adapters/ulid-ids.ts';
import { createTask, updateTask } from '../../core/tasks.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { createWorkspaceStore, type WorkspaceStore } from '../store/workspaceStore.ts';
import { createSyncEngine, type SyncEngine } from './syncEngine.ts';

const engines: SyncEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.getState().stop();
});

let clock = Date.UTC(2026, 9, 21, 9);

async function device(backend: FakeBackend, node: string) {
  const storage = createMemoryStorage();
  const store = createWorkspaceStore({
    storage,
    validator: createAjvValidator(),
    ids: createUlidGenerator(),
    node,
    // Each device's clock moves on; a second apart per change.
    now: () => (clock += 1000),
    saveDelayMs: 0,
  });
  await store.getState().init();
  const transport = backend.device();
  transport.device = node;
  const engine = createSyncEngine({
    transport,
    device: node,
    workspace: store,
    storage,
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  engines.push(engine);
  return { store, storage, transport, engine };
}

const titles = (store: WorkspaceStore) =>
  store
    .getState()
    .workspace!.entities.tasks.filter((task) => task.deletedAt === null)
    .map((task) => task.title)
    .sort();

const inboxOf = (workspace: WorkspaceFile) =>
  workspace.entities.lists.find((list) => list.isInbox)!.id;

function addTask(store: WorkspaceStore, title: string): string {
  let id = '';
  store.getState().apply((ctx, ws) => {
    const result = createTask(ctx, ws, { title, listId: inboxOf(ws) });
    id = result.task.id;
    return result.workspace;
  });
  return id;
}

describe('sync engine', () => {
  it('stays out of the way without a server', async () => {
    const backend = new FakeBackend();
    const { engine, transport } = await device(backend, 'dev1');
    transport.info = () => Promise.resolve(null);
    await engine.getState().start();
    expect(engine.getState().phase).toBe('standalone');
  });

  it('asks for a login, then joins the device to the account', async () => {
    const backend = new FakeBackend();
    const ben = backend.addAccount('ben', 'correct horse battery');
    const { engine, store } = await device(backend, 'dev1');
    addTask(store, 'Mow');
    await engine.getState().start();
    expect(engine.getState().phase).toBe('signed-out');

    expect((await engine.getState().signIn('ben', 'wrong')).kind).toBe('invalid');
    expect((await engine.getState().signIn('ben', 'correct horse battery')).kind).toBe('ok');
    expect(engine.getState().phase).toBe('ready');
    expect(engine.getState().status).toBe('idle');
    expect(engine.getState().lastSynced).not.toBeNull();
    // The device's data now belongs to the account, and the server has it.
    expect(store.getState().workspace!.owner).toBe(ben.id);
    const onServer = [...backend.server.rows.values()].map((row) => row.change.entity);
    expect(onServer.some((entity) => (entity as { title?: string }).title === 'Mow')).toBe(true);
  });

  it('two devices converge, including edits made offline', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const laptop = await device(backend, 'laptop');
    const phone = await device(backend, 'phone');
    addTask(laptop.store, 'Mow');
    await laptop.engine.getState().start();
    await laptop.engine.getState().signIn('ben', 'correct horse battery');
    await phone.engine.getState().start();
    await phone.engine.getState().signIn('ben', 'correct horse battery');
    // The phone joined an account with data: one Mess Drawer, the laptop's task.
    expect(titles(phone.store)).toEqual(['Mow']);
    expect(
      phone.store.getState().workspace!.entities.lists.filter((list) => list.isInbox),
    ).toHaveLength(1);

    // Both go offline and edit.
    laptop.transport.offline = true;
    phone.transport.offline = true;
    const mow = laptop.store.getState().workspace!.entities.tasks[0]!.id;
    laptop.store.getState().apply((ctx, ws) => updateTask(ctx, ws, mow, { title: 'Mow the lawn' }));
    phone.store.getState().apply((ctx, ws) => updateTask(ctx, ws, mow, { priority: 3 }));
    addTask(phone.store, 'Rake');
    await laptop.engine.getState().syncNow();
    expect(laptop.engine.getState().status).toBe('offline');

    // Back online: everything meets in the middle.
    laptop.transport.offline = false;
    phone.transport.offline = false;
    await phone.engine.getState().syncNow();
    await laptop.engine.getState().syncNow();
    await phone.engine.getState().syncNow();
    expect(titles(laptop.store)).toEqual(['Mow the lawn', 'Rake']);
    expect(titles(phone.store)).toEqual(['Mow the lawn', 'Rake']);
    const onPhone = phone.store
      .getState()
      .workspace!.entities.tasks.find((task) => task.id === mow)!;
    expect(onPhone.priority).toBe(3);
    expect(
      laptop.store.getState().workspace!.entities.tasks.find((task) => task.id === mow),
    ).toEqual(onPhone);
  });

  it("another device's change arrives at once, not on the next timer", async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const laptop = await device(backend, 'laptop');
    const phone = await device(backend, 'phone');
    await laptop.engine.getState().start();
    await laptop.engine.getState().signIn('ben', 'correct horse battery');
    await phone.engine.getState().start();
    await phone.engine.getState().signIn('ben', 'correct horse battery');
    // The phone's sign-in pushed its profile, which the laptop hears about and pulls: let it settle.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const before = backend.server.calls;

    addTask(laptop.store, 'Rake');
    await laptop.engine.getState().syncNow();
    await waitFor(() => expect(titles(phone.store)).toEqual(['Rake']));
    // The laptop skipped its own event: one sync for the push, one for the phone's pull.
    expect(backend.server.calls - before).toBe(2);
  });

  it('pushes only what changed', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine, store } = await device(backend, 'dev1');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    const rows = backend.server.rows.size;
    const seqBefore = Math.max(...[...backend.server.rows.values()].map((row) => row.seq));
    await engine.getState().syncNow();
    expect(Math.max(...[...backend.server.rows.values()].map((row) => row.seq))).toBe(seqBefore);
    addTask(store, 'Rake');
    await engine.getState().syncNow();
    expect(backend.server.rows.size).toBe(rows + 1);
  });

  it('another account on the same device starts from that account, not the old data', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const sam = backend.addAccount('sam', 'sams own password');
    const { engine, store } = await device(backend, 'dev1');
    addTask(store, 'Ben stuff');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    await engine.getState().signOut();
    expect(engine.getState().phase).toBe('signed-out');

    await engine.getState().signIn('sam', 'sams own password');
    expect(store.getState().workspace!.owner).toBe(sam.id);
    expect(titles(store)).toEqual([]);
    // Ben's data never reached Sam's account.
    const samRows = [...backend.server.rows.values()].filter((row) => row.owner === sam.id);
    expect(
      samRows.some((row) => (row.change.entity as { title?: string }).title === 'Ben stuff'),
    ).toBe(false);
  });

  it('a password that must change comes first', async () => {
    const backend = new FakeBackend();
    backend.addAccount('admin', 'generated password', { mustChangePassword: true, role: 'admin' });
    const { engine } = await device(backend, 'dev1');
    await engine.getState().start();
    await engine.getState().signIn('admin', 'generated password');
    expect(engine.getState().phase).toBe('password-change');
    expect((await engine.getState().changePassword('generated password', 'short')).kind).toBe(
      'too-short',
    );
    await engine.getState().changePassword('generated password', 'a brand new password');
    expect(engine.getState().phase).toBe('ready');
  });

  it('keeps working offline after an earlier sync', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const first = await device(backend, 'dev1');
    await first.engine.getState().start();
    await first.engine.getState().signIn('ben', 'correct horse battery');

    // The same device later starts with no connection: it knows it is linked.
    const again = createSyncEngine({
      transport: first.transport,
      workspace: first.store,
      storage: first.storage,
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    engines.push(again);
    first.transport.offline = true;
    await again.getState().start();
    expect(again.getState().phase).toBe('ready');
    expect(again.getState().status).toBe('offline');
  });

  it('says when the app or the server needs an update', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    backend.schemaVersion += 1;
    const { engine } = await device(backend, 'dev1');
    await engine.getState().start();
    expect(engine.getState().status).toBe('app-update');

    const older = new FakeBackend();
    older.schemaVersion -= 1;
    const second = await device(older, 'dev2');
    await second.engine.getState().start();
    expect(second.engine.getState().status).toBe('server-behind');
  });
});
