import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Component, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewport, renderApp } from '../../test/renderApp.tsx';
import { LoadBoundary } from './LoadBoundary.tsx';

// Settings stands in for any page split off the first load whose part could not be fetched.
vi.mock('../lazyPages.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lazyPages.ts')>();
  function Gone(): never {
    throw new TypeError(
      'Failed to fetch dynamically imported module: https://x/assets/Settings.js',
    );
  }
  return { ...actual, SettingsPage: Object.assign(Gone, { preload: actual.SettingsPage.preload }) };
});

beforeEach(() => {
  mockViewport('desktop');
  // React reports each caught error on the console.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('a page whose part could not be fetched', () => {
  it('says so in the page area, and the sidebar and other pages still work', async () => {
    await renderApp('/settings');
    expect(
      screen.getByRole('heading', { level: 1, name: 'This page could not load' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByText('This page could not load')).toBeNull();
  });
});

describe('the boundary around a part that loads on first use', () => {
  class Outer extends Component<{ children: ReactNode }, { caught: boolean }> {
    override state = { caught: false };
    static getDerivedStateFromError() {
      return { caught: true };
    }
    override render() {
      return this.state.caught ? <p>The crash screen</p> : this.props.children;
    }
  }

  it('passes a fault in the app on, for the crash screen and its report', () => {
    function Bomb(): never {
      throw new TypeError('cannot read the title of "Groceries"');
    }
    render(
      <Outer>
        <LoadBoundary fallback={<p>Could not load</p>}>
          <Bomb />
        </LoadBoundary>
      </Outer>,
    );
    expect(screen.getByText('The crash screen')).toBeInTheDocument();
    expect(screen.queryByText('Could not load')).toBeNull();
  });
});
