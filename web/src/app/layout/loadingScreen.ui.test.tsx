import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadingScreen, SPINNER_AFTER_MS, SPINNER_MARK } from './LoadingScreen.tsx';

// PL-149: the workspace is on the device, so opening it shows only the background, never a spinner
// that flashes for half a second. Only a wait that runs past the page's first second shows one.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Pretends the page has been open `ms` so far, moving on with the fake timers. */
function pageOpenFor(ms: number) {
  vi.useFakeTimers();
  const start = Date.now() - ms;
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - start);
  return vi.spyOn(performance, 'mark');
}

const spinner = () => screen.queryByRole('progressbar');

describe('the page waiting', () => {
  it('shows only the background while the page is starting, and no spinner mark', () => {
    const mark = pageOpenFor(100);
    render(<LoadingScreen label="Loading" />);
    expect(spinner()).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SPINNER_AFTER_MS - 101));
    expect(spinner()).not.toBeInTheDocument();
    expect(mark).not.toHaveBeenCalledWith(SPINNER_MARK);
  });

  it('shows the spinner once the page has been open past the limit, and marks it', () => {
    const mark = pageOpenFor(100);
    render(<LoadingScreen label="Loading" />);
    act(() => vi.advanceTimersByTime(SPINNER_AFTER_MS - 100));
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
    expect(mark).toHaveBeenCalledWith(SPINNER_MARK);
  });

  it('shows the spinner at once for a wait later on (a page split off the first load)', () => {
    pageOpenFor(SPINNER_AFTER_MS + 5_000);
    render(<LoadingScreen label="Loading" />);
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument();
  });
});
