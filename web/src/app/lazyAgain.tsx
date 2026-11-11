import { lazy, type ComponentType } from 'react';

/** How to forget each part whose load failed, for its next render to ask again. */
const forgets = new Set<() => void>();

/**
 * Let every part that could not load be asked for again on its next render. A LoadBoundary calls it
 * when it starts over (another page, or a new one put on screen), never while it shows a failure,
 * so a part that keeps failing is asked for once per visit, not in a loop.
 */
export function forgetFailedLoads(): void {
  for (const forget of forgets) forget();
  forgets.clear();
}

/**
 * React's `lazy`, except that a failure is not kept for good. `lazy` keeps a failed load, so a part
 * that could not be fetched stayed broken until a reload. Here the failed `lazy` stays only until a
 * LoadBoundary starts over (React renders again after a failure, and must meet the same one then);
 * then a new `lazy` takes its place, and the next render calls `load` again, which `loadOnce` and
 * `importAgain` let try again by a new address. Inside a Suspense and a LoadBoundary, as `lazy` is.
 */
export function lazyAgain<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  const fresh = (): ComponentType<P> =>
    lazy(() =>
      load().catch((error: unknown) => {
        forgets.add(() => {
          current = fresh();
        });
        throw error;
      }),
    ) as unknown as ComponentType<P>;
  let current = fresh();
  function Lazy(props: P) {
    const Current = current;
    return <Current {...props} />;
  }
  return Lazy;
}
