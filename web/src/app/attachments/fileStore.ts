import { useEffect, useState } from 'react';
import { sha256Hex } from '../../core/sha256.ts';
import type { BlobStore } from '../../ports/blobs.ts';
import type { FileApi } from '../../ports/sync.ts';
import { useSyncState } from '../sync/syncContext.ts';

/**
 * The SHA-256 of a file's bytes: the browser's own where it offers it (secure origins), else
 * the plain one (core/sha256.ts) for a server reached over http on a home network.
 */
export async function hashFile(file: Blob): Promise<string> {
  const bytes = await file.arrayBuffer();
  if (globalThis.crypto?.subtle && globalThis.isSecureContext !== false) {
    try {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    } catch {
      // Some browsers expose subtle and still refuse: the plain one does it.
    }
  }
  return sha256Hex(new Uint8Array(bytes));
}

/** A file: this device's copy, else the server's (kept here from then on); null when neither has it. */
export async function loadFile(
  sha256: string,
  blobs: BlobStore,
  files: FileApi | undefined,
): Promise<Blob | null> {
  const here = await blobs.get(sha256);
  if (here) return here;
  const fetched = await files?.download(sha256).catch(() => null);
  if (!fetched) return null;
  await blobs.put(sha256, fetched);
  return fetched;
}

/**
 * An object URL for a file while the component shows it (pictures' thumbnails), or `missing`
 * when neither this device nor the server has it (yet).
 */
export function useFileUrl(
  sha256: string,
  type: string,
  wanted: boolean,
): string | 'missing' | null {
  const blobs = useSyncState((state) => state.blobs);
  const files = useSyncState((state) => state.transport.files);
  const [url, setUrl] = useState<string | 'missing' | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    let made: string | null = null;
    void loadFile(sha256, blobs, files).then((blob) => {
      if (!live) return;
      if (!blob) {
        setUrl('missing');
        return;
      }
      made = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type }));
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [sha256, type, wanted, blobs, files]);
  return url;
}
