import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** What compresses well; images other than SVG and fonts are compressed already. */
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|webmanifest|txt)$/;

/**
 * Writes a `.br` and a `.gz` next to every compressible file of the build, at the highest
 * settings: done once here, the server sends them as they are (StaticSite.cs) instead of
 * compressing the same files on every request.
 */
export function precompress(): Plugin {
  let outDir = 'dist';
  return {
    name: 'punchlist-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    // After vite-plugin-pwa has written the service worker.
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const walk = (dir: string): string[] =>
          readdirSync(dir).flatMap((name) => {
            const path = join(dir, name);
            return statSync(path).isDirectory() ? walk(path) : [path];
          });
        for (const file of walk(outDir).filter((path) => COMPRESSIBLE.test(path))) {
          const bytes = readFileSync(file);
          // Below about a kilobyte the headers cost more than compression saves.
          if (bytes.length < 1024) continue;
          writeFileSync(
            `${file}.br`,
            brotliCompressSync(bytes, {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
                [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
              },
            }),
          );
          writeFileSync(`${file}.gz`, gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION }));
        }
      },
    },
  };
}
