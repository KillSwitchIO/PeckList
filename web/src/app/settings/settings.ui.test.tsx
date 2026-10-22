import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paletteOverrides } from '../../core/paletteSettings.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('settings: colors', () => {
  it('changes a color live, warns when it is too pale, and resets', async () => {
    const store = testStore();
    await renderApp('/settings', store);
    const colors = await screen.findByRole('region', { name: 'Colors' });
    expect(within(colors).getByRole('button', { name: 'Reset colors' })).toBeDisabled();

    await userEvent.click(
      within(colors).getByRole('button', { name: /^Change High priority, now #E8837E/ }),
    );
    const picker = await screen.findByRole('dialog', { name: 'High priority' });
    await userEvent.click(within(picker).getByRole('radio', { name: 'Pastel yellow' }));
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const overrides = () => paletteOverrides(store.getState().workspace!);
    expect(overrides()).toEqual({ priorityHigh: '#F3E1A0' });
    const row = within(colors).getByRole('button', { name: /^Change High priority/ });
    expect(row).toHaveTextContent('#F3E1A0');
    expect(row).toHaveTextContent('Very pale');

    await userEvent.click(within(colors).getByRole('button', { name: 'Reset colors' }));
    expect(overrides()).toEqual({});
    expect(within(colors).getByRole('button', { name: /^Change High priority/ })).toHaveTextContent(
      'Default',
    );
  });
});
