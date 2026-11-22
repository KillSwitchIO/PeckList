import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIndexedDbStorage } from '../../adapters/indexeddb-storage.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { sampleWorkspace } from '../../test/fixtures.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  mockViewport('desktop');
});

afterEach(async () => {
  for (const each of await indexedDB.databases()) if (each.name) await deleteDB(each.name);
});

const webViewNames = async () =>
  (await indexedDB.databases())
    .map((each) => each.name)
    .filter((name) => name?.startsWith('pecklist'))
    .sort();

/** Another local owner, as an older build makes on a fresh IndexedDB (QA, D3). */
const OTHER_OWNER = '01J0000000000000000000000W';

/** An older copy the Android app kept in the WebView because it could not merge it. */
async function keepOlder(workspace: WorkspaceFile = { ...sampleWorkspace(), owner: OTHER_OWNER }) {
  const webView = createIndexedDbStorage();
  await webView.save(workspace);
  await webView.saveMeta('sync', { account: 'U2', cursor: 1, acks: {}, epoch: 'e1' });
  localStorage.setItem('pecklist.olderCopyKept', 'true');
}

const titles = (store: ReturnType<typeof testStore>) =>
  store.getState().workspace!.entities.tasks.map((task) => task.title);

describe('settings: data the Android app could not move yet (PL-070)', () => {
  it('says so after three starts in a row could not move it', async () => {
    localStorage.setItem('pecklist.nativeMoveFailures', '3');
    await renderApp('/settings/data', testStore());
    const data = await screen.findByRole('region', { name: 'Your data' });
    expect(
      within(data).getByText(/couldn't move your data to the app's own storage yet/),
    ).toBeInTheDocument();
  });

  it('says nothing after fewer, or anywhere nothing failed', async () => {
    localStorage.setItem('pecklist.nativeMoveFailures', '2');
    await renderApp('/settings/data', testStore());
    const data = await screen.findByRole('region', { name: 'Your data' });
    expect(within(data).queryByText(/app's own storage/)).not.toBeInTheDocument();
  });
});

describe('settings: an older copy the Android app kept (PL-070)', () => {
  it('shows no row when there is none', async () => {
    await renderApp('/settings/data', testStore());
    const data = await screen.findByRole('region', { name: 'Your data' });
    expect(within(data).queryByText('An older copy of your data')).not.toBeInTheDocument();
  });

  it('brings it in through the import path, then deletes it, with nothing to undo', async () => {
    await keepOlder();
    const { store } = await renderApp('/settings/data', testStore());
    const data = await screen.findByRole('region', { name: 'Your data' });
    expect(within(data).getByText('An older copy of your data')).toBeInTheDocument();
    await userEvent.click(within(data).getByRole('button', { name: 'Bring it in' }));
    expect(await within(data).findByText(/Imported: 2 new tasks/)).toBeInTheDocument();
    expect(titles(store)).toEqual(expect.arrayContaining(['Mow lawn', 'Call vet']));
    expect(store.getState().lastUndoable).toBeNull();
    await waitFor(() =>
      expect(within(data).queryByText('An older copy of your data')).not.toBeInTheDocument(),
    );
    expect(await webViewNames()).toEqual([]);
    expect(localStorage.getItem('pecklist.olderCopyKept')).toBeNull();
  });

  it('keeps a copy that cannot be brought in, and says so', async () => {
    await keepOlder({ ...sampleWorkspace(), owner: OTHER_OWNER, schemaVersion: 999 });
    const { store } = await renderApp('/settings/data', testStore());
    const data = await screen.findByRole('region', { name: 'Your data' });
    await userEvent.click(within(data).getByRole('button', { name: 'Bring it in' }));
    expect(await within(data).findByText(/couldn't be brought in/)).toBeInTheDocument();
    expect(titles(store)).not.toContain('Mow lawn');
    expect(within(data).getByText('An older copy of your data')).toBeInTheDocument();
    expect(await webViewNames()).toEqual(['pecklist', 'pecklist-records']);
  });

  it('deletes it only once confirmed', async () => {
    await keepOlder();
    const { store } = await renderApp('/settings/data', testStore());
    const data = await screen.findByRole('region', { name: 'Your data' });
    await userEvent.click(within(data).getByRole('button', { name: 'Delete it' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(data).getByText('An older copy of your data')).toBeInTheDocument();
    expect(await webViewNames()).toEqual(['pecklist', 'pecklist-records']);

    await userEvent.click(within(data).getByRole('button', { name: 'Delete it' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/can't be undone/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete it' }));
    expect(await within(data).findByText('The older copy is deleted.')).toBeInTheDocument();
    expect(within(data).queryByText('An older copy of your data')).not.toBeInTheDocument();
    expect(await webViewNames()).toEqual([]);
    expect(titles(store)).not.toContain('Mow lawn');
  });
});
