import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAjvValidator } from '../../adapters/ajv-validator.ts';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createUlidGenerator } from '../../adapters/ulid-ids.ts';
import { addAttachment } from '../../core/attachments.ts';
import { sha256Hex } from '../../core/sha256.ts';
import { createTask, updateTask } from '../../core/tasks.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { createWorkspaceStore, type WorkspaceStore } from '../store/workspaceStore.ts';
import { serializeWorkspace } from '../../core/workspace.ts';
import {
  createSyncEngine,
  FIRST_LOAD_RETRY_MAX_MS,
  FIRST_LOAD_RETRY_MS,
  STALE_SYNC_MS,
  type SyncEngine,
  type SyncEngineDependencies,
} from './syncEngine.ts';

const engines: SyncEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.getState().stop();
});

let clock = Date.UTC(2026, 9, 21, 9);

async function device(
  backend: FakeBackend,
  node: string,
  options: Partial<Pick<SyncEngineDependencies, 'readOnly' | 'phoneTasks'>> = {},
) {
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
    ...options,
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
    vi.useFakeTimers();
    const backend = new FakeBackend();
    const { engine, transport } = await device(backend, 'dev1');
    try {
      const info = vi.fn(() => Promise.resolve(null));
      transport.info = info;
      await engine.getState().start();
      expect(engine.getState().phase).toBe('standalone');
      // No PeckList server here: nothing to ask again.
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_RETRY_MAX_MS * 2);
      expect(info).toHaveBeenCalledTimes(1);
    } finally {
      engine.getState().stop();
      vi.useRealTimers();
    }
  });

  it('keeps asking a server that did not answer at the first load (audit C5)', async () => {
    vi.useFakeTimers();
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine, transport } = await device(backend, 'dev1');
    try {
      // The server is restarting as the tab opens.
      transport.offline = true;
      await engine.getState().start();
      expect(engine.getState().phase).toBe('standalone');
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_RETRY_MS);
      expect(engine.getState().phase).toBe('standalone');
      // Back: the next look finds it, as a reload would.
      transport.offline = false;
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_RETRY_MS * 2);
      expect(engine.getState().phase).toBe('signed-out');
    } finally {
      engine.getState().stop();
      vi.useRealTimers();
    }
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
    // The device has a task of its own: asked first (audit W5), then it joins.
    expect(engine.getState().phase).toBe('join-question');
    expect(backend.server.rows.size).toBe(0);
    await engine.getState().answerJoin(true);
    expect(engine.getState().phase).toBe('ready');
    expect(engine.getState().status).toBe('idle');
    expect(engine.getState().lastSynced).not.toBeNull();
    // The device's data now belongs to the account, and the server has it.
    expect(store.getState().workspace!.owner).toBe(ben.id);
    const onServer = [...backend.server.rows.values()].map((row) => row.change.entity);
    expect(onServer.some((entity) => (entity as { title?: string }).title === 'Mow')).toBe(true);
  });

  it('holds a file back while the server takes no more uploads today, and sends it later (audit S5)', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const laptop = await device(backend, 'laptop');
    await laptop.engine.getState().start();
    await laptop.engine.getState().signIn('ben', 'correct horse battery');
    const task = addTask(laptop.store, 'Paint the fence');
    const bytes = new TextEncoder().encode('red');
    const sha256 = sha256Hex(bytes);
    await laptop.engine.getState().blobs.put(sha256, new Blob([bytes], { type: 'text/plain' }));
    laptop.store.getState().apply(
      (ctx, ws) =>
        addAttachment(ctx, ws, {
          taskId: task,
          name: 'colour.txt',
          size: 3,
          mime: 'text/plain',
          sha256,
        }).workspace,
    );

    backend.uploadsWait = true;
    await laptop.engine.getState().syncNow();
    expect(backend.files.has(sha256)).toBe(false);
    expect(laptop.engine.getState().notice?.filesWaiting).toEqual(['colour.txt']);
    // Not "too large": it is not kept back for good, and the attachment is not on the server yet.
    expect(laptop.engine.getState().notice?.filesKept).toBeUndefined();
    const onServer = () =>
      [...backend.server.rows.values()].some((row) => row.change.collection === 'attachments');
    expect(onServer()).toBe(false);

    // The next day: it goes on its own.
    backend.uploadsWait = false;
    await laptop.engine.getState().syncNow();
    expect(backend.files.has(sha256)).toBe(true);
    expect(onServer()).toBe(true);
  });

  it('sends a file before the attachment that names it, and keeps a too-large one on the device', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    backend.maxFileBytes = 5;
    const laptop = await device(backend, 'laptop');
    const phone = await device(backend, 'phone');
    for (const each of [laptop, phone]) {
      await each.engine.getState().start();
      await each.engine.getState().signIn('ben', 'correct horse battery');
    }
    const task = addTask(laptop.store, 'Paint the fence');
    const attach = async (name: string, text: string) => {
      const bytes = new TextEncoder().encode(text);
      const sha256 = sha256Hex(bytes);
      await laptop.engine.getState().blobs.put(sha256, new Blob([bytes], { type: 'text/plain' }));
      laptop.store.getState().apply(
        (ctx, ws) =>
          addAttachment(ctx, ws, {
            taskId: task,
            name,
            size: bytes.length,
            mime: 'text/plain',
            sha256,
          }).workspace,
      );
      return sha256;
    };
    const small = await attach('colour.txt', 'red');
    const big = await attach('swatches.txt', 'far too many bytes');
    await laptop.engine.getState().syncNow();

    expect(backend.files.has(small)).toBe(true);
    expect(backend.files.has(big)).toBe(false);
    expect(laptop.engine.getState().notice?.filesKept).toEqual(['swatches.txt']);

    // The phone learns only of the file it can fetch.
    await phone.engine.getState().syncNow();
    const names = phone.store
      .getState()
      .workspace!.entities.attachments.map((attachment) => attachment.name);
    expect(names).toEqual(['colour.txt']);
    expect(await (await phone.transport.files.download(small))!.text()).toBe('red');
    // Asked again, the laptop does not tell twice.
    laptop.engine.getState().dismissNotice();
    await laptop.engine.getState().syncNow();
    expect(laptop.engine.getState().notice).toBeNull();
  });

  it('two devices converge, including edits made offline', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const laptop = await device(backend, 'laptop');
    const phone = await device(backend, 'phone');
    addTask(laptop.store, 'Mow');
    await laptop.engine.getState().start();
    await laptop.engine.getState().signIn('ben', 'correct horse battery');
    await laptop.engine.getState().answerJoin(true);
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

  it('takes many pages of changes in together, not page by page (R-FB-94)', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const laptop = await device(backend, 'laptop');
    const phone = await device(backend, 'phone');
    await laptop.engine.getState().start();
    await laptop.engine.getState().signIn('ben', 'correct horse battery');
    await phone.engine.getState().start();
    await phone.engine.getState().signIn('ben', 'correct horse battery');

    // The phone was away while the laptop added a lot.
    for (let index = 0; index < 30; index += 1) addTask(laptop.store, `Task ${index}`);
    await laptop.engine.getState().syncNow();
    backend.server.pageSize = 5;
    let pages = 0;
    const sync = phone.transport.sync.bind(phone.transport);
    phone.transport.sync = (request) => {
      pages += 1;
      return sync(request);
    };
    let updates = 0;
    const stop = phone.store.subscribe((state, previous) => {
      if (state.workspace !== previous.workspace) updates += 1;
    });
    await phone.engine.getState().syncNow();
    stop();
    expect(titles(phone.store)).toHaveLength(30);
    expect(pages).toBeGreaterThanOrEqual(6);
    // The first page at once, the rest together.
    expect(updates).toBeLessThanOrEqual(3);
    // Where the sync stands is kept only with the data it stands for: the next sync asks for nothing old.
    pages = 0;
    await phone.engine.getState().syncNow();
    expect(pages).toBe(1);
  });

  it('starts over when a sync has hung, instead of queueing behind it forever', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const laptop = await device(backend, 'laptop');
    // The phone's engine keeps its own clock, so the hang can be aged without waiting.
    const storage = createMemoryStorage();
    const store = createWorkspaceStore({
      storage,
      validator: createAjvValidator(),
      ids: createUlidGenerator(),
      node: 'phone',
      now: () => (clock += 1000),
      saveDelayMs: 0,
    });
    await store.getState().init();
    const transport = backend.device();
    transport.device = 'phone';
    let phoneClock = clock;
    const engine = createSyncEngine({
      transport,
      device: 'phone',
      workspace: store,
      storage,
      debounceMs: 60_000,
      intervalMs: 600_000,
      now: () => phoneClock,
    });
    engines.push(engine);
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    await laptop.engine.getState().start();
    await laptop.engine.getState().signIn('ben', 'correct horse battery');

    // The next request never answers (the page was paused while it was out).
    const real = transport.sync.bind(transport);
    let hung = false;
    transport.sync = (request) => {
      if (hung) return real(request);
      hung = true;
      return new Promise(() => undefined);
    };
    void engine.getState().syncNow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hung).toBe(true);
    addTask(store, 'Water the plants');
    // Soon after, a sync only queues behind the hung one.
    phoneClock += 10_000;
    const queued = engine.getState().syncNow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await laptop.engine.getState().syncNow();
    expect(titles(laptop.store)).toEqual([]);
    // Once it has hung long enough, a sync starts afresh and the change goes through.
    phoneClock += STALE_SYNC_MS;
    await engine.getState().syncNow();
    await laptop.engine.getState().syncNow();
    expect(titles(laptop.store)).toEqual(['Water the plants']);
    expect(engine.getState().status).toBe('idle');
    void queued;
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

  it('takes the server copy back when a change is refused', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine, store } = await device(backend, 'dev1');
    const id = addTask(store, 'Mow');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    await engine.getState().answerJoin(true);

    backend.server.refuse.add(id);
    store.getState().apply((ctx, ws) => updateTask(ctx, ws, id, { title: 'Not allowed' }));
    await engine.getState().syncNow();
    expect(titles(store)).toEqual(['Mow']);
    // It stays put: nothing is pushed again.
    const calls = backend.server.calls;
    await engine.getState().syncNow();
    expect(backend.server.calls).toBe(calls + 1);
    expect(titles(store)).toEqual(['Mow']);

    // A refused new entity the user may not see leaves the device.
    const other = addTask(store, 'Sneaky');
    backend.server.refuse.add(other);
    await engine.getState().syncNow();
    expect(titles(store)).toEqual(['Mow']);
  });

  // Audit C1: one change the server could not take used to fail every sync after it.
  it('keeps a change the server sets aside and syncs everything after it', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine, store } = await device(backend, 'dev1');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');

    const odd = addTask(store, 'Odd one');
    backend.invalid.set(odd, 'invalid_change');
    await engine.getState().syncNow();
    expect(engine.getState().status).toBe('idle');
    expect(engine.getState().notice).toMatchObject({ setAside: 1 });
    // It stays on this device.
    expect(titles(store)).toEqual(['Odd one']);

    const next = addTask(store, 'Rake');
    await engine.getState().syncNow();
    expect(engine.getState().status).toBe('idle');
    const onServer = [...backend.server.rows.keys()];
    expect(onServer).toContain(next);
    expect(onServer).not.toContain(odd);
    // Not sent again, so not set aside again.
    expect(engine.getState().notice).toMatchObject({ setAside: 1 });
  });

  it("says once when this device's clock is well off the server's", async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine, store } = await device(backend, 'dev1');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    expect(engine.getState().notice).toBeNull();

    // A server ten minutes behind: this device is ahead.
    backend.serverTime = Date.now() - 10 * 60_000;
    addTask(store, 'Mow');
    await engine.getState().syncNow();
    expect(engine.getState().notice).toMatchObject({ clock: 'ahead' });

    engine.getState().dismissNotice();
    addTask(store, 'Rake');
    await engine.getState().syncNow();
    expect(engine.getState().notice).toBeNull();
  });

  it('takes a server within a few minutes of this device as on time', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    backend.serverTime = Date.now() + 2 * 60_000;
    const { engine, store } = await device(backend, 'dev1');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    addTask(store, 'Mow');
    await engine.getState().syncNow();
    expect(engine.getState().notice).toBeNull();
  });

  it('viewing as someone shows only what their account has and never writes to it (audit C4)', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const laptop = await device(backend, 'laptop');
    await laptop.engine.getState().start();
    await laptop.engine.getState().signIn('ben', 'correct horse battery');
    addTask(laptop.store, 'Mow');
    await laptop.engine.getState().syncNow();
    const rows = backend.server.rows.size;

    const viewing = await device(backend, 'viewas', { readOnly: true });
    await viewing.engine.getState().start();
    await viewing.engine.getState().signIn('ben', 'correct horse battery');
    const seen = viewing.store.getState().workspace!;
    expect(titles(viewing.store)).toEqual(['Mow']);
    // Ben's own Mess Drawer, not a second one this tab made up.
    expect(seen.entities.lists.map((list) => list.id)).toEqual(
      laptop.store.getState().workspace!.entities.lists.map((list) => list.id),
    );
    expect(backend.server.rows.size).toBe(rows);

    addTask(viewing.store, 'Admin was here');
    await viewing.engine.getState().syncNow();
    expect(backend.server.rows.size).toBe(rows);
    await laptop.engine.getState().syncNow();
    expect(titles(laptop.store)).toEqual(['Mow']);
  });

  it("a first sign-in leaves a device's own tasks out when told to (audit W5)", async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const laptop = await device(backend, 'laptop');
    await laptop.engine.getState().start();
    await laptop.engine.getState().signIn('ben', 'correct horse battery');
    addTask(laptop.store, 'Ben on the laptop');
    await laptop.engine.getState().syncNow();

    // A shared computer with a stranger's standalone tasks on it.
    const shared = await device(backend, 'shared');
    addTask(shared.store, "A stranger's diary");
    await shared.engine.getState().start();
    await shared.engine.getState().signIn('ben', 'correct horse battery');
    expect(shared.engine.getState().phase).toBe('join-question');
    await shared.engine.getState().answerJoin(false);
    expect(shared.engine.getState().phase).toBe('ready');
    expect(titles(shared.store)).toEqual(['Ben on the laptop']);
    await laptop.engine.getState().syncNow();
    expect(titles(laptop.store)).toEqual(['Ben on the laptop']);
  });

  it('adds the tasks a phone made without a server, after asking (PL-070)', async () => {
    const backend = new FakeBackend();
    const ben = backend.addAccount('ben', 'correct horse battery');
    // The Android app's "this device only" data, handed over on connecting.
    const standalone = await device(backend, 'standalone');
    addTask(standalone.store, 'Pick up the garlic');
    let handed: string | null = serializeWorkspace(standalone.store.getState().workspace!);
    const phoneTasks = {
      peek: () => Promise.resolve(handed),
      clear: () => {
        handed = null;
        return Promise.resolve();
      },
      label: 'Add tasks from this phone',
    };
    const { engine, store } = await device(backend, 'phone', { phoneTasks });
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    expect(engine.getState().phase).toBe('join-question');
    expect(engine.getState().join).toBe('phone');
    expect(await engine.getState().answerJoin(true)).toBe('ok');
    expect(engine.getState().phase).toBe('ready');
    expect(engine.getState().join).toBeNull();
    expect(handed).toBeNull();
    expect(titles(store)).toEqual(['Pick up the garlic']);
    expect(store.getState().workspace!.owner).toBe(ben.id);
    const onServer = [...backend.server.rows.values()].map((row) => row.change.entity);
    expect(
      onServer.some((entity) => (entity as { title?: string }).title === 'Pick up the garlic'),
    ).toBe(true);
    // Asked once: the next start goes straight in.
    await engine.getState().start();
    expect(engine.getState().phase).toBe('ready');
  });

  it("leaves a phone's tasks on the phone when told to, adding nothing (PL-070)", async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const standalone = await device(backend, 'standalone');
    addTask(standalone.store, 'A private note to self');
    let handed: string | null = serializeWorkspace(standalone.store.getState().workspace!);
    const phoneTasks = {
      peek: () => Promise.resolve(handed),
      clear: () => {
        handed = null;
        return Promise.resolve();
      },
      label: 'Add tasks from this phone',
    };
    const { engine, store } = await device(backend, 'phone', { phoneTasks });
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    expect(engine.getState().join).toBe('phone');
    expect(await engine.getState().answerJoin(false)).toBe('ok');
    expect(engine.getState().phase).toBe('ready');
    expect(handed).toBeNull();
    expect(titles(store)).toEqual([]);
    // The phone's own copy is untouched.
    expect(titles(standalone.store)).toEqual(['A private note to self']);
  });

  it('a first sign-in on a device with nothing of its own asks nothing', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine } = await device(backend, 'dev1');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    expect(engine.getState().phase).toBe('ready');
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
    await engine.getState().answerJoin(true);
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

  it('after the server is restored from a backup, devices start over from what it has', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine, store } = await device(backend, 'dev1');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    addTask(store, 'Kept');
    await engine.getState().syncNow();
    // The backup is taken here.
    const backup = new Map(backend.server.rows);
    addTask(store, 'After the backup');
    await engine.getState().syncNow();
    expect(titles(store)).toEqual(['After the backup', 'Kept']);

    // The admin restores it: the server forgets the later task and its data gets a new epoch.
    backend.server.rows.clear();
    for (const [id, row] of backup) backend.server.rows.set(id, row);
    backend.epoch = 'epoch-2';
    // Meanwhile this device changed something of the data before the restore.
    addTask(store, 'Typed before it noticed');
    await engine.getState().syncNow();
    expect(titles(store)).toEqual(['Kept']);
    // None of it was written over the restored data (audit C6).
    const onServer = () =>
      [...backend.server.rows.values()].map(
        (row) => (row.change.entity as { title?: string }).title,
      );
    expect(onServer()).not.toContain('Typed before it noticed');
    // And carries on normally.
    addTask(store, 'New');
    await engine.getState().syncNow();
    expect(onServer()).toContain('New');
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

  it('finds its account again when a synced device opened while the server was down (audit C5)', async () => {
    vi.useFakeTimers();
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine, transport, store, storage } = await device(backend, 'dev1');
    let again: SyncEngine | null = null;
    try {
      await engine.getState().start();
      await engine.getState().signIn('ben', 'correct horse battery');
      engine.getState().stop();

      // The tab opens with the server restarting: it works offline, with no account to show yet.
      transport.offline = true;
      again = createSyncEngine({
        transport,
        device: 'dev1',
        workspace: store,
        storage,
        debounceMs: 60_000,
        intervalMs: 600_000,
      });
      await again.getState().start();
      expect(again.getState().phase).toBe('ready');
      expect(again.getState().account).toBeNull();

      // Back: the next look brings the account back, as only a reload used to.
      transport.offline = false;
      await vi.advanceTimersByTimeAsync(FIRST_LOAD_RETRY_MS);
      expect(again.getState().account?.username).toBe('ben');
      expect(again.getState().status).toBe('idle');
    } finally {
      again?.getState().stop();
      engine.getState().stop();
      vi.useRealTimers();
    }
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

  it('signing out leaves nothing readable, not even offline (audit W1)', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const first = await device(backend, 'dev1');
    await first.engine.getState().start();
    await first.engine.getState().signIn('ben', 'correct horse battery');
    addTask(first.store, 'Diary');
    await first.engine.getState().blobs.put('a'.repeat(64), new Blob(['photo']));
    await first.engine.getState().syncNow();

    expect((await first.engine.getState().signOut()).kind).toBe('signed-out');
    expect(first.engine.getState().phase).toBe('signed-out');
    expect(titles(first.store)).toEqual([]);
    expect(JSON.stringify(await first.storage.load())).not.toContain('Diary');
    expect(await first.storage.loadMeta('sync')).toBeNull();
    expect(await first.engine.getState().blobs.has('a'.repeat(64))).toBe(false);

    // Started again with no connection: no account to fall back on, so no way in to Ben's data.
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
    expect(again.getState().phase).not.toBe('ready');
    expect(titles(first.store)).toEqual([]);
  });

  it('asks before signing out would lose changes the server has not taken', async () => {
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { engine, store, transport } = await device(backend, 'dev1');
    await engine.getState().start();
    await engine.getState().signIn('ben', 'correct horse battery');
    transport.offline = true;
    addTask(store, 'Written on the train');

    expect(await engine.getState().signOut()).toEqual({ kind: 'unsynced', count: 1 });
    expect(engine.getState().phase).toBe('ready');
    expect(titles(store)).toEqual(['Written on the train']);

    expect((await engine.getState().signOut({ discard: true })).kind).toBe('signed-out');
    expect(titles(store)).toEqual([]);

    // The server never heard of that sign-out: the next start that reaches it ends the session
    // first, instead of signing straight back in.
    transport.offline = false;
    expect(await transport.me()).not.toBeNull();
    await engine.getState().start();
    expect(engine.getState().phase).toBe('signed-out');
    expect(await transport.me()).toBeNull();
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
