import { deleteDB } from 'idb';
import { expect, it } from 'vitest';
import { describeBlobsContract } from './blobs.contract.ts';
import { createIndexedDbBlobs } from './indexeddb-blobs.ts';
import { createMemoryBlobs } from './memory-blobs.ts';

describeBlobsContract('memory', () => createMemoryBlobs());

let counter = 0;
describeBlobsContract('indexeddb', () =>
  createIndexedDbBlobs(`pecklist-files-test-${(counter += 1)}`),
);

it('lets another tab delete the files database, and opens it again on next use', async () => {
  const name = `pecklist-files-yield-${(counter += 1)}`;
  const blobs = createIndexedDbBlobs(name);
  await blobs.put('a'.repeat(64), new Blob(['hello'], { type: 'text/plain' }));
  // Waits for every connection to close: this store's must give way, not hold it up.
  await deleteDB(name);
  expect(await blobs.has('a'.repeat(64))).toBe(false);
});
