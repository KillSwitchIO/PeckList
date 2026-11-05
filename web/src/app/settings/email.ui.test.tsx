import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function settingsAs(backend: FakeBackend, username: string, path = '/settings/account') {
  const store = testStore();
  const transport = backend.device();
  transport.session = username;
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await renderApp(path, store, sync);
}

describe('settings: email (PL-122)', () => {
  it('adds an email, sends the confirmation link, and says when it is confirmed', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    await settingsAs(backend, 'sam');
    const section = await screen.findByRole('region', { name: 'Email' });
    expect(within(section).getByText('No email')).toBeInTheDocument();
    expect(
      within(section).getByText('Add one so you can reset your password yourself.'),
    ).toBeInTheDocument();

    await userEvent.click(within(section).getByRole('button', { name: 'Add' }));
    await userEvent.type(within(section).getByLabelText('Email'), 'Sam@Example.com');
    await userEvent.click(within(section).getByRole('button', { name: 'Save' }));
    expect(
      await within(section).findByText('We sent a link to sam@example.com. Open it to confirm.'),
    ).toBeInTheDocument();
    expect(within(section).getByText('Open the link we sent to confirm it.')).toBeInTheDocument();
    expect(backend.sentMail).toEqual([{ to: 'sam@example.com', kind: 'confirm' }]);

    await userEvent.click(within(section).getByRole('button', { name: 'Send again' }));
    expect(backend.sentMail).toHaveLength(2);
  });

  it('shows the outcome of the confirmation link once', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'a long enough password');
    backend.emails.set('sam', { email: 'sam@example.com', confirmed: true });
    await settingsAs(backend, 'sam', '/settings?email=confirmed');
    const section = await screen.findByRole('region', { name: 'Email' });
    expect(within(section).getByText('Your email is confirmed.')).toBeInTheDocument();
    expect(within(section).getByText('sam@example.com')).toBeInTheDocument();
    expect(
      within(section).getByText('Confirmed. Password reset links come here.'),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Send again' })).toBeNull();
  });

  it('stays out of the way on a server that sends no email', async () => {
    const backend = new FakeBackend();
    backend.mailWorks = false;
    backend.addAccount('sam', 'a long enough password');
    await settingsAs(backend, 'sam');
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByRole('region', { name: 'Email' })).toBeNull();
  });
});
