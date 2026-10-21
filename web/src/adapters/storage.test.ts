import { createIndexedDbStorage } from './indexeddb-storage.ts';
import { createMemoryStorage } from './memory-storage.ts';
import { describeStorageContract } from './storage.contract.ts';

describeStorageContract('memory', () => createMemoryStorage());

let counter = 0;
describeStorageContract('indexeddb', () =>
  createIndexedDbStorage(`punchlist-test-${(counter += 1)}`),
);
