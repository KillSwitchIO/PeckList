import { render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { isLoadFailure, loadOnce } from './loadOnce.ts';

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
