import type { NativeStoreCalls, StorePage, StoreSave, StoreWhole } from '../ports/nativeShell.ts';

/** One origin's tables, as `NativeStore.java` keeps them. */
interface Space {
  entities: Map<string, string>;
  header: string | null;
  kv: Map<string, string>;
  staged: { stage: string; rows: Map<string, string | null> } | null;
}

const emptySpace = (): Space => ({
  entities: new Map(),
  header: null,
  kv: new Map(),
  staged: null,
});

/**
 * The Android app's native store (shell api 16, PL-070) for tests, as `NativeStore.java` and
 * `ShellPlugin`'s store calls behave: one namespace per origin, pages by size, a save written
 * whole or not at all, chunks staged until their last one commits. A call from an origin the
 * WebView is no longer on is refused. `NativeStoreCases` pins the same behaviour on real SQLite.
 */
export class FakeNativeStore {
  private spaces = new Map<string, Space>();
  /** The WebView's origin now: a call that says another is refused. */
  current = 'https://localhost';
  /** Every save call, chunks included, as sent. */
  saves: StoreSave[] = [];
  /** Load calls made (pages). */
  loads = 0;
  /** Whether the shell reads the whole store in one (api 18); an older one answers null. */
  readsWhole = true;
  /** Whole reads made. */
  wholes = 0;
  /** About how much a load page holds. */
  pageBudget = 1_000_000;
  /** Throws for the call it names (the method and how many of its calls to let through first). */
  failing: { method: keyof NativeStoreCalls; after: number } | null = null;
  private counts = new Map<string, number>();

  private space(origin: string): Space {
    let space = this.spaces.get(origin);
    if (!space) this.spaces.set(origin, (space = emptySpace()));
    return space;
  }

  /** What the store holds for an origin, for a test to look at. */
  peek(origin = this.current): {
    header: string | null;
    entities: Map<string, string>;
    kv: Map<string, string>;
  } {
    const space = this.space(origin);
    return { header: space.header, entities: new Map(space.entities), kv: new Map(space.kv) };
  }

  private enter(origin: string, method: keyof NativeStoreCalls): Space {
    if (origin !== this.current) throw new Error('refused: not this page’s storage');
    const count = (this.counts.get(method) ?? 0) + 1;
    this.counts.set(method, count);
    if (this.failing?.method === method && count > this.failing.after) {
      this.failing = null;
      throw new Error(`the native store failed (${method})`);
    }
    return this.space(origin);
  }

  /** The calls a page on `origin` makes. */
  calls(origin = this.current): NativeStoreCalls {
    const run = <T>(method: keyof NativeStoreCalls, work: (space: Space) => T): Promise<T> => {
      try {
        return Promise.resolve(work(this.enter(origin, method)));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    return {
      load: (after, budget = this.pageBudget) =>
        run('load', (space): StorePage => {
          this.loads += 1;
          const header = after === null ? space.header : null;
          if (after === null && budget <= 0) return { header, rows: [], next: null };
          const keys = [...space.entities.keys()]
            .sort()
            .filter((key) => after === null || key > after);
          const rows: [string, string][] = [];
          let size = 0;
          for (const key of keys) {
            if (rows.length > 0 && size >= budget) return { header, rows, next: rows.at(-1)![0] };
            const json = space.entities.get(key)!;
            rows.push([key, json]);
            size += key.length + json.length;
          }
          return { header, rows, next: null };
        }),
      whole: () =>
        run('whole', (space): StoreWhole | null => {
          if (!this.readsWhole) return null;
          this.wholes += 1;
          const rows = [...space.entities.keys()]
            .sort()
            .map((key): [string, unknown] => [key, JSON.parse(space.entities.get(key)!)]);
          return { header: space.header === null ? null : JSON.parse(space.header), rows };
        }),
      save: (change) =>
        run('save', (space) => {
          this.saves.push(structuredClone(change));
          const rows = new Map<string, string | null>();
          for (const [key, json] of change.puts) rows.set(key, json);
          for (const key of change.deletes) rows.set(key, null);
          if (change.header !== undefined) rows.set('', change.header);
          if (change.stage !== undefined && !change.commit) {
            if (space.staged?.stage !== change.stage)
              space.staged = { stage: change.stage, rows: new Map() };
            for (const [key, json] of rows) space.staged.rows.set(key, json);
            return;
          }
          let all = rows;
          if (change.stage !== undefined) {
            const earlier = space.staged?.stage === change.stage ? space.staged.rows : new Map();
            if (earlier.size !== (change.staged ?? 0)) {
              space.staged = null;
              throw new Error('the save’s earlier chunks are gone');
            }
            all = new Map([...earlier, ...rows]);
          }
          if (change.replace) space.entities.clear();
          for (const [key, json] of all) {
            if (key === '') space.header = json;
            else if (json === null) space.entities.delete(key);
            else space.entities.set(key, json);
          }
          space.staged = null;
        }),
      clear: () =>
        run('clear', (space) => {
          space.entities.clear();
          space.header = null;
          space.staged = null;
        }),
      get: (key) => run('get', (space) => space.kv.get(key) ?? null),
      put: (entries) =>
        run('put', (space) => {
          for (const [key, json] of entries) {
            if (json === null) space.kv.delete(key);
            else space.kv.set(key, json);
          }
        }),
      keys: (prefix) =>
        run('keys', (space) => [...space.kv.keys()].filter((key) => key.startsWith(prefix)).sort()),
      wipe: () =>
        run('wipe', () => {
          this.spaces.set(origin, emptySpace());
        }),
    };
  }
}
