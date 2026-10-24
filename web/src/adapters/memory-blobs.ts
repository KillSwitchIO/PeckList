import type { BlobStore } from '../ports/blobs.ts';

/** Files in memory: tests, and the in-memory app a super admin views someone through. */
export function createMemoryBlobs(): BlobStore {
  const blobs = new Map<string, Blob>();
  return {
    get: (sha256) => Promise.resolve(blobs.get(sha256) ?? null),
    put: (sha256, blob) => {
      blobs.set(sha256, blob);
      return Promise.resolve();
    },
    has: (sha256) => Promise.resolve(blobs.has(sha256)),
    delete: (sha256) => {
      blobs.delete(sha256);
      return Promise.resolve();
    },
  };
}
