import { act, render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { lazyAgain } from './lazyAgain.tsx';
import { LoadBoundary } from './layout/LoadBoundary.tsx';
import { importAgain, isLoadFailure, loadOnce } from './loadOnce.ts';

describe('loading a part of the app', () => {
  it('runs once, and keeps what it gave', async () => {
    const load = vi.fn(() => Promise.resolve('part'));
    const get = loadOnce(load);
    await expect(get()).resolves.toBe('part');
    await expect(get()).resolves.toBe('part');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failure, and asks only once while one is under way', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('part');
    const get = loadOnce(load);
    const [first, second] = [get(), get()];
    await expect(first).rejects.toThrow('offline');
    await expect(second).rejects.toThrow('offline');
    expect(load).toHaveBeenCalledTimes(1);
    await expect(get()).resolves.toBe('part');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a page whose fetch ahead failed still opens when it is visited', async () => {
    const load = vi
      .fn<() => Promise<{ default: () => React.JSX.Element }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: () => <p>The page</p> });
    const preload = loadOnce(load);
    const Page = lazy(preload);
    await expect(preload()).rejects.toThrow('offline');
    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    );
    expect(await screen.findByText('The page')).toBeInTheDocument();
  });

  it("knows a failed fetch from a fault in the app, in each browser's words", () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x/assets/a.js',
      'error loading dynamically imported module: https://x/assets/a.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/a.css',
    ]) {
      expect(isLoadFailure(new TypeError(message))).toBe(true);
    }
    expect(isLoadFailure(new TypeError('x is not a function'))).toBe(false);
  });
});

// A browser keeps a failed import() per address, so asking again means a new address. These pin
// the addresses asked for; e2e/specs/load-again.e2e.ts proves the browser fetches them.
describe('a part asked for again after it failed', () => {
  const gone = (url: string) =>
    new TypeError(`Failed to fetch dynamically imported module: ${url}`);

  it('is asked for by a new address each time, from the address it failed at', async () => {
    const here = `${window.location.origin}/assets/Calendar-x1.js`;
    const again = vi
      .fn<(url: string) => Promise<unknown>>()
      .mockRejectedValueOnce(gone(`${here}?retry=1`))
      .mockResolvedValue({ part: true });
    await expect(importAgain(() => Promise.reject(gone(here)), again)).rejects.toThrow('retry=1');
    await expect(importAgain(() => Promise.reject(gone(here)), again)).resolves.toEqual({
      part: true,
    });
    expect(again.mock.calls).toEqual([[`${here}?retry=1`], [`${here}?retry=2`]]);
  });

  it('is not asked for when the browser does not say where, or it is another site', async () => {
    const again = vi.fn<(url: string) => Promise<unknown>>();
    for (const error of [
      new TypeError('Importing a module script failed.'),
      gone('https://elsewhere.example/assets/a.js'),
      new TypeError('x is not a function'),
    ]) {
      await expect(importAgain(() => Promise.reject(error), again)).rejects.toBe(error);
    }
    expect(again).not.toHaveBeenCalled();
  });

  it('opens a page that could not load once it is visited again', async () => {
    const load = vi
      .fn<() => Promise<{ default: () => React.JSX.Element }>>()
      .mockRejectedValueOnce(gone(`${window.location.origin}/assets/Page.js`))
      .mockResolvedValue({ default: () => <p>The page</p> });
    const Page = lazyAgain(loadOnce(load));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const at = (path: string) => (
      <LoadBoundary resetKey={path} fallback={<p>Could not load</p>}>
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </LoadBoundary>
    );
    // In act, so React's render after the rejection runs here (the app has no act to wait for).
    const { rerender } = await act(async () => render(at('/calendar')));
    expect(await screen.findByText('Could not load')).toBeInTheDocument();
    await act(async () => rerender(at('/today')));
    expect(await screen.findByText('The page')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
