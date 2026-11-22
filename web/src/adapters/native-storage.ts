import { COLLECTIONS, type WorkspaceFile } from '../core/types.ts';
import type { NativeStoreCalls, StoreSave } from '../ports/nativeShell.ts';
import type { StorageAdapter } from '../ports/storage.ts';

/** The workspace minus its entities, and each collection's ids in order. */
interface Header {
  doc: Omit<WorkspaceFile, 'entities'>;
  order: Record<string, string[]>;
}

/** What the store holds, as last read or written: entity objects by `collection/id`. */
interface Held {
  entities: Map<string, unknown>;
  header: string;
  order: Record<string, string[]>;
}

/** About how much a save sends per call: a bigger one goes in chunks (the whole workspace after an import). */
export const CHUNK_CHARS = 1_000_000;

const keyOf = (collection: string, id: string) => `${collection}/${id}`;

const sameIds = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined && a.length === b.length && a.every((id, index) => id === b[index]);

const stageId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Keeps the workspace in the Android app's own SQLite (PL-070, shell api 16) one row per entity,
 * as the IndexedDB adapter keeps one record per entity: a save sends the entities that changed
 * since the store was last read or written (compared by reference), the deletes, and the header
 * only when it or an order changed. A save too big for one call goes in chunks that the shell
 * writes together. Backups and device metadata are JSON text by key.
 */
export function createNativeStorage(
  store: NativeStoreCalls,
  chunkChars = CHUNK_CHARS,
): StorageAdapter {
  let held: Held | null = null;

  const text = async (key: string) => {
    const json = await store.get(key);
    return json === null ? null : (JSON.parse(json) as unknown);
  };

  /** Sends a save in one call, or in chunks of about `chunkChars` with the last one committing. */
  const send = async (change: Required<Pick<StoreSave, 'puts' | 'deletes'>> & StoreSave) => {
    let size =
      (change.header?.length ?? 0) + change.deletes.reduce((sum, key) => sum + key.length, 0);
    for (const [key, json] of change.puts) size += key.length + json.length;
    if (size <= chunkChars) {
      await store.save(change);
      return;
    }
    const stage = stageId();
    const replace = change.replace === true;
    let staged = 0;
    let chunk: StoreSave = { puts: [], deletes: [], stage, commit: false, replace };
    let chunkSize = 0;
    const flush = async () => {
      await store.save(chunk);
      staged += chunk.puts.length + chunk.deletes.length;
      chunk = { puts: [], deletes: [], stage, commit: false, replace };
      chunkSize = 0;
    };
    for (const put of change.puts) {
      if (chunkSize > 0 && chunkSize + put[0].length + put[1].length > chunkChars) await flush();
      chunk.puts.push(put);
      chunkSize += put[0].length + put[1].length;
    }
    for (const key of change.deletes) {
      if (chunkSize > 0 && chunkSize + key.length > chunkChars) await flush();
      chunk.deletes.push(key);
      chunkSize += key.length;
    }
    await store.save({
      ...chunk,
      commit: true,
      staged,
      ...(change.header === undefined ? {} : { header: change.header }),
    });
  };

  /** The workspace from its header and entities by key, now held as last read; null when none is saved. */
  const opened = (header: Header | null, byKey: Map<string, unknown>): WorkspaceFile | null => {
    if (header === null) {
      held = null;
      return null;
    }
    const entities: Record<string, unknown[]> = {};
    const placed = new Set<string>();
    for (const collection of COLLECTIONS) {
      const list: unknown[] = [];
      for (const id of header.order[collection] ?? []) {
        const key = keyOf(collection, id);
        const entity = byKey.get(key);
        if (entity !== undefined) {
          list.push(entity);
          placed.add(key);
        }
      }
      entities[collection] = list;
    }
    // Anything the order does not name (it should not happen) still comes back.
    for (const [key, entity] of byKey) {
      if (placed.has(key)) continue;
      const collection = key.slice(0, key.indexOf('/'));
      (entities[collection] ??= []).push(entity);
    }
    held = { entities: byKey, header: JSON.stringify(header.doc), order: header.order };
    return { ...header.doc, entities } as unknown as WorkspaceFile;
  };

  return {
    kind: 'native',
    async load() {
      // One read where the shell has it (api 18), else page by page.
      const whole = await store.whole();
      if (whole) {
        if (whole.header === null) return opened(null, new Map());
        return opened(whole.header as Header, new Map(whole.rows));
      }
      const first = await store.load(null);
      if (first.header === null) return opened(null, new Map());
      const header = JSON.parse(first.header) as Header;
      const byKey = new Map<string, unknown>();
      let page = first;
      for (;;) {
        for (const [key, json] of page.rows) byKey.set(key, JSON.parse(json));
        if (page.next === null) break;
        page = await store.load(page.next);
      }
      return opened(header, byKey);
    },
    async save(workspace: WorkspaceFile) {
      const { entities, ...doc } = workspace;
      // By key: a collection that names an id twice sends it once (the last), as the shell keeps one row.
      const puts = new Map<string, string>();
      const deletes: string[] = [];
      const now = new Map<string, unknown>();
      const order: Record<string, string[]> = {};
      for (const collection of COLLECTIONS) {
        const ids: string[] = [];
        for (const entity of (entities[collection] ?? []) as { id: string }[]) {
          const key = keyOf(collection, entity.id);
          ids.push(entity.id);
          now.set(key, entity);
          if (held?.entities.get(key) !== entity) puts.set(key, JSON.stringify(entity));
          else puts.delete(key);
        }
        order[collection] = ids;
      }
      if (held) {
        for (const key of held.entities.keys()) if (!now.has(key)) deletes.push(key);
      }
      const docText = JSON.stringify(doc);
      const reordered = COLLECTIONS.some(
        (collection) => !sameIds(held?.order[collection], order[collection]!),
      );
      const headerChanged = !held || docText !== held.header || reordered;
      if (held && puts.size === 0 && deletes.length === 0 && !headerChanged) return;
      await send({
        puts: [...puts],
        deletes,
        // With nothing read before it, the save is the whole workspace: anything else stored goes.
        ...(held ? {} : { replace: true }),
        ...(headerChanged ? { header: JSON.stringify({ doc, order } satisfies Header) } : {}),
      });
      held = { entities: now, header: docText, order };
    },
    async clear() {
      held = null;
      await store.clear();
    },
    async backup(name: string, document: unknown) {
      await store.put([[`backup:${name}`, JSON.stringify(document)]]);
    },
    loadBackup: (name: string) => text(`backup:${name}`),
    loadMeta: (key: string) => text(`meta:${key}`),
    async saveMeta(key: string, value: unknown) {
      await store.put([[`meta:${key}`, JSON.stringify(value)]]);
    },
    async wipe() {
      held = null;
      await store.wipe();
    },
  };
}
