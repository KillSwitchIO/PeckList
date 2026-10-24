// Contract suite every StorageAdapter must pass. Call it from the adapter's own test file.
import { describe, expect, it } from 'vitest';
import type { StorageAdapter } from '../ports/storage.ts';
import { sampleWorkspace } from '../test/fixtures.ts';

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
