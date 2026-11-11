// Loading a part of the app split off its first load.

/**
 * `load` as something to call any number of times: it runs once and what it gave is kept, but a
 * failure is not, so the next call tries again (a flaky network, a new version being deployed).
 */
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () =>
    (loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    }));
}

/** How many times each part was asked for again, by the address it first failed at. */
const tries = new Map<string, number>();

/**
 * `load`, an `import()` of a part split off the first load, and when it fails, that part again by a
 * new address. A browser keeps a failed `import()` for the page's life, per address (Chrome,
 * Firefox), and never asks the server again, so trying the same address again is no try. Only the
 * part itself gets a new address: what it imports keeps its own, so a module the parts share is
 * never loaded twice. When the browser does not say which address failed (Safari), or a part it
 * imports failed, only a reload helps, and the error goes on to say so.
 */
export async function importAgain<M>(
  load: () => Promise<M>,
  again: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
): Promise<M> {
  try {
    return await load();
  } catch (error) {
    const url = failedAddress(error);
    if (!url) throw error;
    const n = (tries.get(url) ?? 0) + 1;
    tries.set(url, n);
    return (await again(`${url}?retry=${n}`)) as M;
  }
}

/** The address a part of this app failed at, from the browser's words; never another site's. */
function failedAddress(error: unknown): string | null {
  if (!isLoadFailure(error)) return null;
  const message = error instanceof Error ? error.message : String(error);
  const found = /https?:\/\/[^\s'"]+?\.m?js(?=[?\s'"]|$)/.exec(message)?.[0];
  if (!found) return null;
  try {
    const url = new URL(found);
    return url.origin === window.location.origin ? url.origin + url.pathname : null;
  } catch {
    return null;
  }
}

/**
 * A failed fetch of a part of the app, as each browser words it. Not a fault in the app: a version
 * that has moved on or a poor connection, and the browser may only try again after a reload
 * (Firefox keeps the failure for as long as the page lives).
 */
export function isLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|importing a module script failed|unable to preload css/i.test(
    message,
  );
}
