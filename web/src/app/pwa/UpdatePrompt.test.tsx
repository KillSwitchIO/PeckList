import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testStore } from '../../test/renderApp.tsx';
import { SyncContext, standaloneSync } from '../sync/syncContext.ts';
import { UpdatePrompt } from './UpdatePrompt.tsx';

const registration = { update: vi.fn(() => Promise.resolve()) };
const state = {
  needRefresh: false,
  offlineReady: false,
  setNeedRefresh: vi.fn(),
  setOfflineReady: vi.fn(),
  updateServiceWorker: vi.fn(() => Promise.resolve()),
};

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options?: { onRegisteredSW?: (url: string, found: unknown) => void }) => {
    options?.onRegisteredSW?.('/sw.js', registration);
    return {
      needRefresh: [state.needRefresh, state.setNeedRefresh],
      offlineReady: [state.offlineReady, state.setOfflineReady],
      updateServiceWorker: state.updateServiceWorker,
    };
  },
}));

beforeEach(() => {
  state.needRefresh = false;
  state.offlineReady = false;
  vi.clearAllMocks();
});

function withSync() {
  const engine = standaloneSync(testStore());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>
  );
  return { engine, wrapper };
}

describe('UpdatePrompt', () => {
  it('renders nothing when there is no update', () => {
    render(<UpdatePrompt />, withSync());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers the update and applies it', async () => {
    state.needRefresh = true;
    render(<UpdatePrompt />, withSync());
    expect(screen.getByText('A new version of Punchlist is available.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(state.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('tells the user when offline mode is ready and can be dismissed', async () => {
    state.offlineReady = true;
    render(<UpdatePrompt />, withSync());
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(state.setOfflineReady).toHaveBeenCalledWith(false);
    expect(state.setNeedRefresh).toHaveBeenCalledWith(false);
  });

  it('says so plainly when the server moved on and syncing stopped, and looks for the update at once', async () => {
    const { engine, wrapper } = withSync();
    render(<UpdatePrompt />, { wrapper });
    expect(screen.queryByText(/keep syncing/)).toBeNull();
    act(() => engine.setState({ status: 'app-update' }));
    expect(
      screen.getByText('Punchlist was updated on the server. Update this app to keep syncing.'),
    ).toBeInTheDocument();
    expect(registration.update).toHaveBeenCalled();
    // Later hides it until the next time.
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText(/keep syncing/)).toBeNull();
  });
});
