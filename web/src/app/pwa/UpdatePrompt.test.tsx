import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdatePrompt } from './UpdatePrompt.tsx';

const state = {
  needRefresh: false,
  offlineReady: false,
  setNeedRefresh: vi.fn(),
  setOfflineReady: vi.fn(),
  updateServiceWorker: vi.fn(() => Promise.resolve()),
};

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [state.needRefresh, state.setNeedRefresh],
    offlineReady: [state.offlineReady, state.setOfflineReady],
    updateServiceWorker: state.updateServiceWorker,
  }),
}));

beforeEach(() => {
  state.needRefresh = false;
  state.offlineReady = false;
  vi.clearAllMocks();
});

describe('UpdatePrompt', () => {
  it('renders nothing when there is no update', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers the update and applies it', async () => {
    state.needRefresh = true;
    render(<UpdatePrompt />);
    expect(screen.getByText('A new version of Punchlist is available.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(state.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('tells the user when offline mode is ready and can be dismissed', async () => {
    state.offlineReady = true;
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(state.setOfflineReady).toHaveBeenCalledWith(false);
    expect(state.setNeedRefresh).toHaveBeenCalledWith(false);
  });
});
