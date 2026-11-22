import { browser } from '@wdio/globals';

// The app's storage in a real browser (IndexedDB), written as a version of PeckList left it.

export interface Document {
  schemaVersion: number;
  entities: Record<string, { id: string }[]>;
}

/**
 * Put a document where a past or future version would have saved it, over whatever is there:
 * `records` as the app saves today (one record per entity), `text` as older versions did (one JSON
 * text). `null` empties storage, as on a new device. The page is reloaded by what comes next.
 *
 * Each write waits for its transaction to commit, not just for its request: the next step leaves
 * the page, and leaving aborts a transaction still open. The old text copy was lost that way on a
 * busy runner (!525, !530), and the app then opened an empty workspace instead of the upgrade page.
 *
 * `tasks`: that many tasks in place of the document's own, each a copy of its first one with its
 * own id and title ("Task 1" and on). They are made in the page: a big document sent through
 * WebDriver stalls Chrome's session.
 */
export async function store(
  document: Document | null,
  form: 'records' | 'text' = 'records',
  tasks = 0,
) {
  await browser.execute(
    async (document, form, tasks) => {
      if (document && tasks > 0) {
        const [first] = document.entities.tasks!;
        document.entities.tasks = Array.from({ length: tasks }, (_, index) => ({
          ...first!,
          id: `01PERF${String(index).padStart(20, '0')}`,
          title: `Task ${index + 1}`,
        }));
      }
      const done = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
        });
      const committed = (tx: IDBTransaction) =>
        new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB failed'));
        });
      const records = await done(indexedDB.open('pecklist-records'));
      const tx = records.transaction(['entities', 'doc'], 'readwrite');
      tx.objectStore('entities').clear();
      tx.objectStore('doc').clear();
      if (document && form === 'records') {
        const { entities, ...doc } = document;
        const order: Record<string, string[]> = {};
        for (const [collection, list] of Object.entries(entities)) {
          order[collection] = list.map((entity) => entity.id);
          for (const entity of list) {
            tx.objectStore('entities').put(entity, `${collection}/${entity.id}`);
          }
        }
        tx.objectStore('doc').put({ doc, order }, 'header');
      }
      await committed(tx);
      records.close();
      const first = await done(indexedDB.open('pecklist'));
      const texts = first.transaction('workspace', 'readwrite');
      texts.objectStore('workspace').clear();
      if (document && form === 'text') {
        texts.objectStore('workspace').put(JSON.stringify(document), 'current');
      }
      await committed(texts);
      first.close();
      localStorage.clear();
    },
    document,
    form,
    tasks,
  );
}
