// The IndexedDB adapters against each browser's own IndexedDB (PL-002). The jsdom runs use
// fake-indexeddb, which can differ from Chrome and Firefox in what they store and when.
import { createIndexedDbBlobs } from './indexeddb-blobs.ts';
import { createIndexedDbStorage } from './indexeddb-storage.ts';
import { describeBlobsContract } from './blobs.contract.ts';
import { describeStorageContract } from './storage.contract.ts';

const run = `${Date.now()}`;
let counter = 0;

describeStorageContract('indexeddb, in a real browser', () =>
  createIndexedDbStorage(`pecklist-browser-test-${run}-${(counter += 1)}`),
);

describeBlobsContract('indexeddb files, in a real browser', () =>
  createIndexedDbBlobs(`pecklist-browser-files-${run}-${(counter += 1)}`),
);
