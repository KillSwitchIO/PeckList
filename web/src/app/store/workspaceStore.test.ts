import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAjvValidator } from '../../adapters/ajv-validator.ts';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createUlidGenerator } from '../../adapters/ulid-ids.ts';
import { getEntity } from '../../core/collections.ts';
import { inboxList } from '../../core/lists.ts';
import { CURRENT_SCHEMA_VERSION } from '../../core/migrations.ts';
import { createTask, toggleTaskDone, updateTask } from '../../core/tasks.ts';
import type { StorageAdapter } from '../../ports/storage.ts';
import { deviceId, randomId } from './device.ts';
import { createWorkspaceStore } from './workspaceStore.ts';

const validator = createAjvValidator();

function makeStore(storage: StorageAdapter, node = 'tabA') {
  return createWorkspaceStore({
    storage,
    validator,
    ids: createUlidGenerator(),
    node,
    saveDelayMs: 100,
  });
}

function addTask(store: ReturnType<typeof makeStore>, title: string, label?: string) {
  let id = '';
  store.getState().apply((ctx, ws) => {
    const result = createTask(ctx, ws, { title, listId: inboxList(ws).id });
    id = result.task.id;
    return result.workspace;
  }, label);
  return id;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('workspace store', () => {
  it('creates and saves a new workspace on first start', async () => {
    const storage = createMemoryStorage();
    const store = makeStore(storage);
    expect(store.getState().status).toBe('loading');
    await store.getState().init();
    expect(store.getState().status).toBe('ready');
    const saved = (await storage.load()) as { owner: string };
    expect(saved.owner).toBe(store.getState().workspace?.owner);
  });

  it('applies operations in memory immediately and saves after the debounce', async () => {
    const storage = createMemoryStorage();
    const store = makeStore(storage);
    await store.getState().init();
    const id = addTask(store, 'Mow');
    expect(getEntity(store.getState().workspace!, 'tasks', id)?.title).toBe('Mow');
    const before = (await storage.load()) as { entities: { tasks: unknown[] } };
    expect(before.entities.tasks).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);
    const after = (await storage.load()) as { entities: { tasks: unknown[] } };
    expect(after.entities.tasks).toHaveLength(1);
  });

  it('flush saves pending changes right away', async () => {
    const storage = createMemoryStorage();
    const store = makeStore(storage);
    await store.getState().init();
    addTask(store, 'Mow');
    await store.getState().flush();
    expect(
      ((await storage.load()) as { entities: { tasks: unknown[] } }).entities.tasks,
    ).toHaveLength(1);
  });

  it('reopens what was saved', async () => {
    const storage = createMemoryStorage();
    const first = makeStore(storage);
    await first.getState().init();
    const id = addTask(first, 'Persisted');
    await first.getState().flush();
    const second = makeStore(storage, 'tabB');
    await second.getState().init();
    expect(getEntity(second.getState().workspace!, 'tasks', id)?.title).toBe('Persisted');
  });

  it('two tabs editing at once both keep their changes', async () => {
    const storage = createMemoryStorage();
    const a = makeStore(storage, 'tabA');
    await a.getState().init();
    await a.getState().flush();
    const b = makeStore(storage, 'tabB');
    await b.getState().init();
    const fromA = addTask(a, 'from A');
    const fromB = addTask(b, 'from B');
    await a.getState().flush();
    await b.getState().flush();
    await a.getState().reloadFromStorage();
    for (const store of [a, b]) {
      const ws = store.getState().workspace!;
      expect(getEntity(ws, 'tasks', fromA)).toBeDefined();
      expect(getEntity(ws, 'tasks', fromB)).toBeDefined();
    }
  });

  it('undo reverts the last labelled action and is a new write', async () => {
    const store = makeStore(createMemoryStorage());
    await store.getState().init();
    const id = addTask(store, 'Mow');
    store.getState().apply((ctx, ws) => toggleTaskDone(ctx, ws, id), 'Task completed');
    expect(store.getState().lastUndoable?.label).toBe('Task completed');
    store.getState().undo();
    expect(getEntity(store.getState().workspace!, 'tasks', id)?.status).toBe('open');
    expect(store.getState().lastUndoable).toBeNull();
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it('undo by id leaves later actions alone', async () => {
    const store = makeStore(createMemoryStorage());
    await store.getState().init();
    const id = addTask(store, 'Mow');
    store.getState().apply((ctx, ws) => updateTask(ctx, ws, id, { title: 'Mow lawn' }), 'Renamed');
    const renamed = store.getState().lastUndoable!.id;
    store.getState().apply((ctx, ws) => updateTask(ctx, ws, id, { priority: 3 }), 'Priority');
    store.getState().undo(renamed);
    expect(getEntity(store.getState().workspace!, 'tasks', id)).toMatchObject({
      title: 'Mow',
      priority: 3,
    });
    store.getState().undo(999);
    store.getState().dismissUndo();
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it('ignores operations that change nothing', async () => {
    const store = makeStore(createMemoryStorage());
    await store.getState().init();
    const before = store.getState().workspace;
    store.getState().apply((_, ws) => ws, 'Nothing');
    expect(store.getState().workspace).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it('reports newer, older and broken files instead of opening them', async () => {
    const newer = createMemoryStorage();
    await newer.save({ schemaVersion: 99 } as never);
    const a = makeStore(newer);
    await a.getState().init();
    expect(a.getState().status).toBe('needs-app-update');

    const broken = createMemoryStorage();
    await broken.save({ schemaVersion: CURRENT_SCHEMA_VERSION } as never);
    const b = makeStore(broken);
    await b.getState().init();
    expect(b.getState().status).toBe('error');

    const failing: StorageAdapter = {
      kind: 'x',
      load: () => Promise.reject(new Error('disk')),
      save: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      backup: () => Promise.resolve(),
      loadBackup: () => Promise.resolve(null),
    };
    const c = makeStore(failing);
    await c.getState().init();
    expect(c.getState().problem).toEqual({ kind: 'error', message: 'disk' });
    expect(() => c.getState().apply((_, ws) => ws)).toThrow('not ready');
    expect(() => c.getState().context()).toThrow('not ready');
  });
});

describe('upgrading stored data', () => {
  it('backs up an older workspace, then upgrades and opens it', async () => {
    const storage = createMemoryStorage();
    const fresh = makeStore(createMemoryStorage());
    await fresh.getState().init();
    const current = fresh.getState().workspace!;
    const legacy = structuredClone(current) as unknown as {
      schemaVersion: number;
      entities: { tasks: Record<string, unknown>[] };
    };
    legacy.schemaVersion = 1;
    for (const task of legacy.entities.tasks) delete task.progress;
    await storage.save(legacy as never);

    const store = makeStore(storage);
    await store.getState().init();
    expect(store.getState().status).toBe('needs-upgrade');
    await store.getState().upgrade();
    expect(store.getState().status).toBe('ready');
    expect(store.getState().workspace!.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(await storage.loadBackup('workspace.v1.bak.json')).toEqual(legacy);
    expect((await storage.load()) as { schemaVersion: number }).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
  });
});

describe('device ids', () => {
  it('keeps one device id and makes valid random ids', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
    };
    const first = deviceId(storage);
    expect(first).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(deviceId(storage)).toBe(first);
    expect(deviceId(null)).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(randomId(4, () => 0)).toBe('AAAA');
  });
});
