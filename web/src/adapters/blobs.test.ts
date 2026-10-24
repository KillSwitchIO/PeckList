import { describeBlobsContract } from './blobs.contract.ts';
import { createIndexedDbBlobs } from './indexeddb-blobs.ts';
import { createMemoryBlobs } from './memory-blobs.ts';

describeBlobsContract('memory', () => createMemoryBlobs());

let counter = 0;
describeBlobsContract('indexeddb', () =>
  createIndexedDbBlobs(`punchlist-files-test-${(counter += 1)}`),
);
