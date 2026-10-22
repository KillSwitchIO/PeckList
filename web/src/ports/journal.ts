/**
 * A small synchronous store for changes not yet saved when the page goes away (`localStorage`
 * in browsers). Saving to the real storage is asynchronous and does not finish once a page is
 * unloading; writing here does. The next start merges it back in.
 */
export interface Journal {
  write(text: string): void;
  read(): string | null;
  clear(): void;
}
