import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockViewport, renderApp } from '../../test/renderApp.tsx';
import { DONATION_PLATFORMS } from './links.ts';

const visible = vi.hoisted(() => ({ value: true }));
vi.mock('./useSupportVisible.ts', () => ({ useSupportVisible: () => visible.value }));

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
  visible.value = true;
});

describe('support card (PL-112)', () => {
  it('thanks you and has a button leaving for each platform in the links file', async () => {
    await renderApp('/settings/support');
    const card = await screen.findByRole('region', { name: 'Support PeckList' });
    expect(card).toHaveTextContent('Thank you for using PeckList');
    expect(DONATION_PLATFORMS.length).toBeGreaterThan(0);
    for (const platform of DONATION_PLATFORMS) {
      const button = within(card).getByRole('link', { name: `Support on ${platform.name}` });
      expect(button).toHaveAttribute('href', platform.url);
      expect(button).toHaveAttribute('target', '_blank');
    }
  });

  it('the heart by the version opens the card', async () => {
    await renderApp('/today');
    await userEvent.click(await screen.findByRole('button', { name: 'Support PeckList' }));
    expect(await screen.findByRole('region', { name: 'Support PeckList' })).toBeInTheDocument();
  });

  it('is the last subject in the list of settings', async () => {
    await renderApp('/settings');
    const list = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(list).getAllByRole('link').at(-1)).toHaveTextContent('Support PeckList');
  });

  it('a server that turns it off shows no card, no subject and no heart', async () => {
    visible.value = false;
    await renderApp('/settings/support');
    // Its address falls back to the first subject, as any unknown one does.
    const list = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(list).queryByRole('link', { name: /Support PeckList/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Support PeckList' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Support PeckList' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Support on/ })).toBeNull();
  });
});
