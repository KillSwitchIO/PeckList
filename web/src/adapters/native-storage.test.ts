import { describe, expect, it } from 'vitest';
import type { WorkspaceFile } from '../core/types.ts';
import { sampleWorkspace } from '../test/fixtures.ts';
import { FakeNativeStore } from '../test/fakeNativeStore.ts';
import { createNativeStorage } from './native-storage.ts';
import { bigWorkspace, describeStorageContract } from './storage.contract.ts';

describeStorageContract('native', () => createNativeStorage(new FakeNativeStore().calls()));

// The same on a shell older than the whole read (api 18), with tiny chunks and pages, so every save
// and load goes in several calls.
describeStorageContract('native, in small chunks and pages', () => {
  const device = new FakeNativeStore();
  device.readsWhole = false;
  device.pageBudget = 300;
  return createNativeStorage(device.calls(), 300);
});

const renamed = (workspace: WorkspaceFile, index: number, title: string): WorkspaceFile => ({
  ...workspace,
  entities: {
    ...workspace.entities,
    tasks: workspace.entities.tasks.map((task, at) => (at === index ? { ...task, title } : task)),
  },
});

describe('native storage, one row per entity', () => {
  it('sends only the entities that changed, and the header only when it changed', async () => {
    const device = new FakeNativeStore();
    const storage = createNativeStorage(device.calls());
    const workspace = sampleWorkspace();
    await storage.save(workspace);
    expect(device.saves[0]!.replace).toBe(true);
    expect(device.saves[0]!.header).toBeDefined();
    const next = renamed(workspace, 1, 'Call the vet');
    await storage.save(next);
    expect(device.saves[1]).toEqual({
      puts: [[`tasks/${next.entities.tasks[1]!.id}`, JSON.stringify(next.entities.tasks[1])]],
      deletes: [],
    });
    await storage.save(next);
    expect(device.saves).toHaveLength(2);
    // Removing a task changes the order: a delete, and the header again.
    const fewer = { ...next, entities: { ...next.entities, tasks: next.entities.tasks.slice(1) } };
    await storage.save(fewer);
    expect(device.saves[2]!.deletes).toEqual([`tasks/${next.entities.tasks[0]!.id}`]);
    expect(device.saves[2]!.puts).toEqual([]);
    expect(device.saves[2]!.header).toBeDefined();
    expect(await createNativeStorage(device.calls()).load()).toEqual(fewer);
  });

  it('reads the workspace in one where the shell can, and a save after it sends only what changed', async () => {
    const device = new FakeNativeStore();
    const workspace = sampleWorkspace();
    await createNativeStorage(device.calls()).save(workspace);
    const storage = createNativeStorage(device.calls());
    expect(await storage.load()).toEqual(workspace);
    expect(device.wholes).toBe(1);
    expect(device.loads).toBe(0);
    // What it read is what it holds: an untouched entity is not sent again.
    const read = await createNativeStorage(device.calls()).load();
    const reader = createNativeStorage(device.calls());
    const held = (await reader.load()) as WorkspaceFile;
    const next = renamed(held, 1, 'Call the vet');
    device.saves.length = 0;
    await reader.save(next);
    expect(device.saves).toEqual([
      {
        puts: [[`tasks/${next.entities.tasks[1]!.id}`, JSON.stringify(next.entities.tasks[1])]],
        deletes: [],
      },
    ]);
    expect(read).toEqual(workspace);
  });

  it('reads nothing saved as nothing, in one read too', async () => {
    const device = new FakeNativeStore();
    expect(await createNativeStorage(device.calls()).load()).toBeNull();
    expect(device.wholes).toBe(1);
  });

  it('saves a 10 MB workspace in chunks the shell writes together, and loads it in pages', async () => {
    const device = new FakeNativeStore();
    // A shell older than the whole read (api 18).
    device.readsWhole = false;
    const storage = createNativeStorage(device.calls());
    const workspace = bigWorkspace();
    await storage.save(workspace);
    expect(device.saves.length).toBeGreaterThanOrEqual(10);
    const stage = device.saves[0]!.stage;
    expect(stage).toBeDefined();
    for (const chunk of device.saves) {
      expect(chunk.stage).toBe(stage);
      expect(JSON.stringify(chunk).length).toBeLessThan(1_100_000);
    }
    expect(device.saves.filter((chunk) => chunk.commit)).toHaveLength(1);
    expect(device.saves.at(-1)!.commit).toBe(true);
    expect(await createNativeStorage(device.calls()).load()).toEqual(workspace);
    expect(device.loads).toBeGreaterThanOrEqual(10);
  });

  it('keeps the save before when a chunk fails partway, and sends it all again next time', async () => {
    const device = new FakeNativeStore();
    const storage = createNativeStorage(device.calls(), 300);
    const workspace = sampleWorkspace();
    await storage.save(workspace);
    const big = renamed(renamed(workspace, 0, 'a'.repeat(400)), 1, 'b'.repeat(400));
    device.failing = { method: 'save', after: device.saves.length + 1 };
    await expect(storage.save(big)).rejects.toThrow();
    expect(await createNativeStorage(device.calls()).load()).toEqual(workspace);
    await storage.save(big);
    expect(await createNativeStorage(device.calls()).load()).toEqual(big);
  });

  it('keeps each origin apart, and refuses a page that is no longer on its own', async () => {
    const device = new FakeNativeStore();
    const phone = createNativeStorage(device.calls('https://localhost'));
    const server = createNativeStorage(device.calls('https://tasks.example.com'));
    const own = sampleWorkspace();
    await phone.save(own);
    await phone.saveMeta('sync', { cursor: 1 });
    // The WebView went to the server: the phone page's late save is refused, and nothing changes.
    device.current = 'https://tasks.example.com';
    await expect(phone.save(renamed(own, 0, 'Late'))).rejects.toThrow(/refused/);
    expect(await server.load()).toBeNull();
    expect(await server.loadMeta('sync')).toBeNull();
    await server.save(renamed(own, 0, 'On the server'));
    // Back on the phone's own page, its workspace is as it was, and the refused change goes next time.
    device.current = 'https://localhost';
    expect(await createNativeStorage(device.calls('https://localhost')).load()).toEqual(own);
    await phone.save(renamed(own, 0, 'Late'));
    expect(await createNativeStorage(device.calls('https://localhost')).load()).toEqual(
      renamed(own, 0, 'Late'),
    );
  });

  it('sends an id a collection names twice once, the last, so a chunked save counts right', async () => {
    const device = new FakeNativeStore();
    const storage = createNativeStorage(device.calls(), 300);
    const workspace = sampleWorkspace();
    const [first] = workspace.entities.tasks;
    const doubled = {
      ...workspace,
      entities: {
        ...workspace.entities,
        tasks: [...workspace.entities.tasks, { ...first!, title: 'The later copy' }],
      },
    };
    await storage.save(doubled);
    const sent = device.saves.flatMap((chunk) => chunk.puts.map(([key]) => key));
    expect(sent.filter((key) => key === `tasks/${first!.id}`)).toHaveLength(1);
    const loaded = (await createNativeStorage(device.calls()).load()) as typeof workspace;
    expect(
      loaded.entities.tasks.filter((task) => task.id === first!.id).map((task) => task.title),
    ).toEqual(['The later copy', 'The later copy']);
  });

  it('writes the whole workspace after a clear, dropping what was there', async () => {
    const device = new FakeNativeStore();
    const storage = createNativeStorage(device.calls());
    const workspace = sampleWorkspace();
    await storage.save(workspace);
    await storage.clear();
    const fresh = { ...workspace, entities: { ...workspace.entities, tasks: [] } };
    await storage.save(fresh);
    expect(device.saves.at(-1)!.replace).toBe(true);
    expect(await createNativeStorage(device.calls()).load()).toEqual(fresh);
  });
});
