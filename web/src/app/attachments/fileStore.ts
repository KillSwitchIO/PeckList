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

/** The thumbnail's shorter side (px): sharp at 2x in the 96 px tiles. */
const THUMB_SIDE = 192;

/**
 * A small copy of a picture for its tile. A camera photo is 12 megapixels or more; drawing that
 * in a 96 px tile makes the browser decode and composite all of it, which flashes and leaves
 * parts of the page unpainted for a moment. Falls back to the picture itself where the browser
 * cannot resize (or cannot read the format).
 */
export async function thumbnailOf(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined')
    return blob;
  try {
    const full = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_SIDE / Math.min(full.width, full.height));
    const width = Math.max(1, Math.round(full.width * scale));
    const height = Math.max(1, Math.round(full.height * scale));
    const small = await createImageBitmap(full, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'medium',
    });
    full.close();
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')?.drawImage(small, 0, 0);
    small.close();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } catch {
    return blob;
  }
}

// Thumbnails made this visit, by file: reopening a task shows them at once, without decoding
// the picture again. Object URLs, kept until the page closes (a few KB each).
const thumbnails = new Map<string, string>();
const MAX_THUMBNAILS = 300;

function rememberThumbnail(sha256: string, url: string) {
  thumbnails.set(sha256, url);
  if (thumbnails.size > MAX_THUMBNAILS) {
    const [oldest, old] = thumbnails.entries().next().value as [string, string];
    thumbnails.delete(oldest);
    URL.revokeObjectURL(old);
  }
}

/**
 * An object URL for a file while the component shows it (a picture's full size), or `missing`
 * when neither this device nor the server has it (yet). With `thumbnail`, a small copy instead,
 * made once and kept for the visit.
 */
export function useFileUrl(
  sha256: string,
  type: string,
  wanted: boolean,
  thumbnail = false,
): string | 'missing' | null {
  const blobs = useSyncState((state) => state.blobs);
  const files = useSyncState((state) => state.transport.files);
  const [url, setUrl] = useState<string | 'missing' | null>(() =>
    thumbnail ? (thumbnails.get(sha256) ?? null) : null,
  );
  useEffect(() => {
    if (!wanted) return;
    // Made earlier this visit: the first render already has it.
    if (thumbnail && thumbnails.has(sha256)) return;
    let live = true;
    let made: string | null = null;
    void loadFile(sha256, blobs, files)
      .then(async (blob) => {
        if (!blob) return null;
        const typed = blob.type ? blob : new Blob([blob], { type });
        return thumbnail ? await thumbnailOf(typed) : typed;
      })
      .then((shown) => {
        if (!shown) {
          if (live) setUrl('missing');
          return;
        }
        const next = URL.createObjectURL(shown);
        if (thumbnail) {
          rememberThumbnail(sha256, next);
        } else {
          made = next;
        }
        if (live) setUrl(next);
        else if (!thumbnail) URL.revokeObjectURL(next);
      });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [sha256, type, wanted, thumbnail, blobs, files]);
  return url;
}
