// Contract suite every StorageAdapter must pass. Call it from the adapter's own test file.
import { describe, expect, it } from 'vitest';
import type { StorageAdapter } from '../ports/storage.ts';
import type { WorkspaceFile } from '../core/types.ts';
import { sampleWorkspace } from '../test/fixtures.ts';

/** A workspace of about 10 MB: 4,500 tasks with long notes, as a heavy user's (audit P5). */
export function bigWorkspace(): WorkspaceFile {
  const workspace = sampleWorkspace();
  const [model] = workspace.entities.tasks;
  const notes = 'x'.repeat(2000);
  workspace.entities.tasks = Array.from({ length: 4500 }, (_, index) => ({
    ...model!,
    id: `01BIG${String(index).padStart(21, '0')}`,
    title: `Task ${index}`,
    notes,
  }));
  return workspace;
}

export function describeStorageContract(
  name: string,
  create: () => StorageAdapter | Promise<StorageAdapter>,
) {
  describe(`StorageAdapter contract: ${name}`, () => {
    it('loads null when nothing was saved', async () => {
      const storage = await create();
      await storage.clear();
      expect(await storage.load()).toBeNull();
    });

    it('round-trips a workspace exactly', async () => {
      const storage = await create();
      const workspace = sampleWorkspace();
      await storage.save(workspace);
      expect(await storage.load()).toEqual(workspace);
    });

    it('overwrites the previous save', async () => {
      const storage = await create();
      const first = sampleWorkspace();
      const second = {
        ...sampleWorkspace(),
        sync: { server: 'https://example.test', cursor: '42' },
      };
      await storage.save(first);
      await storage.save(second);
      expect(await storage.load()).toEqual(second);
    });

    it('clears', async () => {
      const storage = await create();
      await storage.save(sampleWorkspace());
      await storage.clear();
      expect(await storage.load()).toBeNull();
    });

    it('keeps backups apart from the workspace', async () => {
      const storage = await create();
      const workspace = sampleWorkspace();
      await storage.save(workspace);
      await storage.backup('workspace.v1.bak.json', { schemaVersion: 1, note: 'old' });
      expect(await storage.load()).toEqual(workspace);
      expect(await storage.loadBackup('workspace.v1.bak.json')).toEqual({
        schemaVersion: 1,
        note: 'old',
      });
      expect(await storage.loadBackup('missing')).toBeNull();
    });

    it('keeps device metadata apart from the workspace, surviving a clear', async () => {
      const storage = await create();
      const workspace = sampleWorkspace();
      await storage.save(workspace);
      expect(await storage.loadMeta('sync')).toBeNull();
      await storage.saveMeta('sync', { cursor: 7, acks: { T1: 'x' } });
      await storage.saveMeta('sync', { cursor: 8, acks: {} });
      expect(await storage.loadMeta('sync')).toEqual({ cursor: 8, acks: {} });
      expect(await storage.load()).toEqual(workspace);
    });

    it('wipes the workspace, backups and device metadata together (signing out)', async () => {
      const storage = await create();
      await storage.save(sampleWorkspace());
      await storage.backup('workspace.v1.bak.json', { schemaVersion: 1 });
      await storage.saveMeta('sync', { account: 'U1', cursor: 8 });
      await storage.wipe();
      expect(await storage.load()).toBeNull();
      expect(await storage.loadBackup('workspace.v1.bak.json')).toBeNull();
      expect(await storage.loadMeta('sync')).toBeNull();
    });

    it('saves and loads a 10 MB workspace, and a save after it', async () => {
      const storage = await create();
      const workspace = bigWorkspace();
      await storage.save(workspace);
      const loaded = (await storage.load()) as WorkspaceFile;
      expect(loaded).toEqual(workspace);
      const changed = {
        ...loaded,
        entities: {
          ...loaded.entities,
          tasks: [
            ...loaded.entities.tasks.slice(1),
            { ...loaded.entities.tasks[0]!, title: 'Moved last' },
          ],
        },
      };
      await storage.save(changed);
      expect(await storage.load()).toEqual(changed);
    });

    it('returns a copy, not a live reference', async () => {
      const storage = await create();
      const workspace = sampleWorkspace();
      await storage.save(workspace);
      workspace.entities.tasks.length = 0;
      const loaded = (await storage.load()) as typeof workspace;
      expect(loaded.entities.tasks.length).toBeGreaterThan(0);
    });
  });
}
