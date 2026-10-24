import { afterEach, describe, expect, it, vi } from 'vitest';
import { thumbnailOf } from './fileStore.ts';

afterEach(() => vi.unstubAllGlobals());

describe('picture thumbnails', () => {
  it('shrink a camera photo so its shorter side is 192 px, as a small JPEG', async () => {
    const sizes: { width: number; height: number }[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn((source: unknown, options?: { resizeWidth: number; resizeHeight: number }) => {
        const size = options
          ? { width: options.resizeWidth, height: options.resizeHeight }
          : { width: 4000, height: 3000 };
        sizes.push(size);
        return Promise.resolve({ ...size, close: vi.fn(), source });
      }),
    );
    let drawn: { width: number; height: number } | null = null;
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          drawn = { width, height };
        }
        getContext() {
          return { drawImage: vi.fn() };
        }
        convertToBlob(options: { type: string }) {
          return Promise.resolve(new Blob(['small'], { type: options.type }));
        }
      },
    );
    const photo = new Blob(['x'.repeat(1000)], { type: 'image/jpeg' });
    const small = await thumbnailOf(photo);
    expect(sizes).toEqual([
      { width: 4000, height: 3000 },
      { width: 256, height: 192 },
    ]);
    expect(drawn).toEqual({ width: 256, height: 192 });
    expect(small.type).toBe('image/jpeg');
    expect(small.size).toBeLessThan(photo.size);
  });

  it('keep the picture itself where the browser cannot resize it', async () => {
    const photo = new Blob(['x'], { type: 'image/png' });
    expect(await thumbnailOf(photo)).toBe(photo);
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('cannot read HEIC')));
    vi.stubGlobal('OffscreenCanvas', function OffscreenCanvas() {});
    expect(await thumbnailOf(photo)).toBe(photo);
  });
});
