import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from './StoreProvider.tsx';
import type { WorkspaceStore } from './workspaceStore.ts';

function provided() {
  const state = {
    init: vi.fn(() => Promise.resolve()),
    journal: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
  };
  render(
    <StoreProvider store={{ getState: () => state } as unknown as WorkspaceStore}>
      <p>App</p>
    </StoreProvider>,
  );
  return state;
}

const fire = (type: 'pagehide' | 'pageshow', persisted: boolean) =>
  window.dispatchEvent(Object.assign(new Event(type), { persisted }));

function setVisibility(state: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('saving as the page goes away', () => {
  afterEach(() => vi.restoreAllMocks());

  it('notes unsaved changes and starts the save when the page closes', () => {
    const state = provided();
    fire('pagehide', false);
    expect(state.journal).toHaveBeenCalledOnce();
    expect(state.flush).toHaveBeenCalledOnce();
  });

  it('notes them and saves when the app goes to the background', () => {
    const state = provided();
    setVisibility('hidden');
    expect(state.journal).toHaveBeenCalledOnce();
    expect(state.flush).toHaveBeenCalledOnce();
  });

  it('starts no save on a page kept for the back button, and saves when it comes back', () => {
    const state = provided();
    fire('pagehide', true);
    setVisibility('hidden');
    expect(state.journal).toHaveBeenCalledOnce();
    expect(state.flush).not.toHaveBeenCalled();

    fire('pageshow', true);
    expect(state.flush).toHaveBeenCalledOnce();

    // Back in use, it saves as usual.
    setVisibility('hidden');
    expect(state.flush).toHaveBeenCalledTimes(2);
  });
});
