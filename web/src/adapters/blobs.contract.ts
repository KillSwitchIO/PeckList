import { describe, expect, it } from 'vitest';
import type { BlobStore } from '../ports/blobs.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

/** What every BlobStore adapter must do. */
export function describeBlobsContract(name: string, make: () => BlobStore) {
  describe(`BlobStore: ${name}`, () => {
    it('keeps files by their hash, and forgets them on delete', async () => {
      const blobs = make();
      expect(await blobs.get(A)).toBeNull();
      expect(await blobs.has(A)).toBe(false);
      await blobs.put(A, new Blob(['hello'], { type: 'text/plain' }));
      expect(await blobs.has(A)).toBe(true);
      expect(await (await blobs.get(A))!.text()).toBe('hello');
      expect(await blobs.has(B)).toBe(false);
      await blobs.delete(A);
      expect(await blobs.has(A)).toBe(false);
      await blobs.delete(A);
    });

    it('forgets every file at once', async () => {
      const blobs = make();
      await blobs.put(A, new Blob(['a']));
      await blobs.put(B, new Blob(['b']));
      await blobs.clear();
      expect([await blobs.has(A), await blobs.has(B)]).toEqual([false, false]);
    });
  });
}
