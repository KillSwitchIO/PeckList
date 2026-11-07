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
