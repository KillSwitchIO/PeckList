import { $, browser, expect } from '@wdio/globals';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Data from another version of PeckList, in a real browser with real IndexedDB (PL-024): the
// consent and refuse pages guard every future schema change. StatusGate.test.tsx covers what they
// say; these show the whole way through, from what a past or future version left in storage to
// what is stored afterwards. XPath and CSS only, as in smoke.e2e.ts.

interface Document {
  schemaVersion: number;
  entities: Record<string, { id: string }[]>;
}

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../schema/fixtures/migrations');
const fixturePath = (version: number) => join(fixtures, `${version}-input.json`);
const fixture = (version: number) =>
  JSON.parse(readFileSync(fixturePath(version), 'utf8')) as Document;
// Each version past the first has a fixture, so the newest names the app's schema.
const current = Math.max(
  ...readdirSync(fixtures).map((name) => Number(/^(\d+)-input\.json$/.exec(name)?.[1] ?? 0)),
);
const oldest = 2;

/**
 * Put a document where a past or future version would have saved it, over whatever is there:
 * `records` as the app saves today (one record per entity), `text` as older versions did (one JSON
 * text). `null` empties storage, as on a new device. The page is reloaded by what comes next.
 */
async function store(document: Document | null, form: 'records' | 'text' = 'records') {
  await browser.execute(
    async (document, form) => {
      const done = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
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
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'));
      });
      records.close();
      const first = await done(indexedDB.open('pecklist'));
      const store = first.transaction('workspace', 'readwrite').objectStore('workspace');
      await done(store.clear());
      if (document && form === 'text') {
        const text = first.transaction('workspace', 'readwrite').objectStore('workspace');
        await done(text.put(JSON.stringify(document), 'current'));
      }
      first.close();
      localStorage.clear();
    },
    document,
    form,
  );
}

/** What storage holds now: the schema of each copy of the workspace, and the backups by name. */
async function stored() {
  return browser.execute(async () => {
    const done = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB failed'));
      });
    const records = await done(indexedDB.open('pecklist-records'));
    const header = (await done(records.transaction('doc').objectStore('doc').get('header'))) as
      { doc: { schemaVersion: number } } | undefined;
    records.close();
    const first = await done(indexedDB.open('pecklist'));
    const workspace = first.transaction('workspace').objectStore('workspace');
    const [keys, values] = await Promise.all([
      done(workspace.getAllKeys()),
      done(workspace.getAll()),
    ]);
    first.close();
    const texts = Object.fromEntries(keys.map((key, index) => [String(key), values[index]]));
    return {
      recordsSchema: header?.doc.schemaVersion ?? null,
      textCopy: typeof texts.current === 'string',
      backups: Object.fromEntries(
        Object.entries(texts)
          .filter(([key]) => key.startsWith('backup:'))
          .map(([key, value]) => [key.slice('backup:'.length), JSON.parse(value as string)]),
      ) as Record<string, Document>,
    };
  });
}

const heading = (text: string) => $(`//h1[normalize-space()='${text}']`);
const task = (title: string) => $(`//*[@aria-label='Open ${title}']`);
const upgradeTitle = 'Your data needs an upgrade';
const refuseTitle = 'This data needs a newer version of PeckList';

async function upgradeFromFixture(version: number) {
  await browser.url('/all');
  await expect(heading(upgradeTitle)).toBeDisplayed();
  await expect($('main')).toHaveText(
    expect.stringContaining(`schema ${version - 1}; this app uses ${current}`),
  );
  // Nothing moves until you say so.
  await expect(task('Mow lawn')).not.toBeExisting();
  await $("//button[normalize-space()='Back up and upgrade']").click();
  await expect(task('Mow lawn')).toBeDisplayed();
}

describe('data from another version (PL-024)', () => {
  it('asks before upgrading what the last version saved, and keeps a backup', async () => {
    const before = fixture(current);
    await store(before);
    await upgradeFromFixture(current);
    await expect(task('Call vet')).toBeDisplayed();

    const after = await stored();
    expect(after.recordsSchema).toBe(current);
    const backup = after.backups[`workspace.v${before.schemaVersion}.bak.json`];
    expect(backup?.schemaVersion).toBe(before.schemaVersion);
    expect(backup?.entities.tasks?.map((each) => each.id)).toEqual(
      before.entities.tasks?.map((each) => each.id),
    );

    // It stays upgraded: no second question, and the tasks are still there.
    await browser.url('/all');
    await expect(task('Mow lawn')).toBeDisplayed();
    await expect(heading(upgradeTitle)).not.toBeExisting();
  });

  it('stores nothing until the upgrade is agreed', async () => {
    const before = fixture(current);
    await store(before);
    await browser.url('/all');
    await expect(heading(upgradeTitle)).toBeDisplayed();
    const waiting = await stored();
    expect(waiting.recordsSchema).toBe(before.schemaVersion);
    expect(waiting.backups).toEqual({});
  });

  it('upgrades the oldest data, saved as one text, all the way', async () => {
    const before = fixture(oldest);
    await store(before, 'text');
    await upgradeFromFixture(oldest);

    const after = await stored();
    expect(after.recordsSchema).toBe(current);
    expect(after.textCopy).toBe(false);
    expect(after.backups[`workspace.v${before.schemaVersion}.bak.json`]?.schemaVersion).toBe(
      before.schemaVersion,
    );
  });

  it('refuses data from a newer version, changes nothing, and still does after an update', async () => {
    const newer = { ...fixture(current), schemaVersion: current + 1 };
    await store(newer);
    await browser.url('/all');
    await expect(heading(refuseTitle)).toBeDisplayed();
    await expect($('main')).toHaveText(
      expect.stringContaining(`schema ${newer.schemaVersion}; this app supports up to ${current}`),
    );
    await expect(task('Mow lawn')).not.toBeExisting();

    // The app's update is a reload. Still this version here, so the same page, not a broken one.
    await $("//button[normalize-space()='Update']").click();
    await expect(heading(refuseTitle)).toBeDisplayed();

    const after = await stored();
    expect(after.recordsSchema).toBe(newer.schemaVersion);
    expect(after.backups).toEqual({});
  });

  describe('importing a file', () => {
    const importInput = "input[type='file'][aria-label='Import a file']";

    async function openData() {
      await store(null);
      await browser.url('/settings/data');
      await expect($("//button[@aria-label='Import a file']")).toBeDisplayed();
    }

    it('brings in an older file, upgraded', async () => {
      await openData();
      await $(importInput).addValue(fixturePath(oldest));
      await expect($("//*[@role='alert'][contains(., 'Imported: 2 new tasks')]")).toBeDisplayed();

      await browser.url('/all');
      await expect(task('Mow lawn')).toBeDisplayed();
      expect((await stored()).recordsSchema).toBe(current);
    });

    it('keeps an import left at once, and saves still work, there and back', async () => {
      const saveLocks = () =>
        browser.execute(async () => {
          const { held, pending } = await navigator.locks.query();
          return [...(held ?? []), ...(pending ?? [])].filter(
            (lock) => lock.name === 'pecklist-save',
          ).length;
        });
      await openData();
      await $(importInput).addValue(fixturePath(oldest));
      await expect($("//*[@role='alert'][contains(., 'Imported: 2 new tasks')]")).toBeDisplayed();
      // Before its save has even started: Firefox keeps this page for the back button.
      await browser.url('/all');
      await expect(task('Mow lawn')).toBeDisplayed();
      await browser.waitUntil(async () => (await stored()).recordsSchema === current);
      await browser.waitUntil(async () => (await saveLocks()) === 0);

      await browser.back();
      await expect($("//button[@aria-label='Import a file']")).toBeDisplayed();
      await browser.waitUntil(async () => (await saveLocks()) === 0);
      await browser.url('/all');
      await expect(task('Mow lawn')).toBeDisplayed();
    });

    it('turns down a newer file and leaves the data alone', async () => {
      const folder = mkdtempSync(join(tmpdir(), 'pecklist-e2e-'));
      const path = join(folder, 'newer.json');
      writeFileSync(path, JSON.stringify({ ...fixture(current), schemaVersion: current + 1 }));
      try {
        await openData();
        await $(importInput).addValue(path);
        await expect($("//*[@role='alert'][contains(., 'comes from a newer')]")).toBeDisplayed();
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }

      await browser.url('/all');
      // The page first, or this would pass before there is anything to look at.
      await expect(heading('All')).toBeDisplayed();
      await expect(task('Mow lawn')).not.toBeExisting();
      // A new workspace saves a moment after it opens.
      await browser.waitUntil(async () => (await stored()).recordsSchema === current);
    });
  });
});
