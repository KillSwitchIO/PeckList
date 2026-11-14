import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend, fakeSupporterKey } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function appAs(backend: FakeBackend, username: string, path: string) {
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

function samsServer() {
  const backend = new FakeBackend();
  backend.addAccount('sam', 'a long enough password');
  return backend;
}

const keyBox = () => screen.findByRole('region', { name: 'Supporter key' });

async function enter(box: HTMLElement, key: string) {
  const field = within(box).getByLabelText('Enter your key');
  await userEvent.clear(field);
  await userEvent.type(field, key);
  await userEvent.click(within(box).getByRole('button', { name: 'Enter' }));
}

describe('supporter keys (PL-112)', () => {
  it('links to the website for a key and says why a pasted one was not taken', async () => {
    await appAs(samsServer(), 'sam', '/settings/support');
    const box = await keyBox();
    expect(within(box).getByRole('link', { name: 'Get a supporter key' })).toHaveAttribute(
      'href',
      'https://pecklist.com/support',
    );

    await enter(box, 'hello');
    expect(
      await within(box).findByText(
        "That isn't a supporter key. Paste the whole key from your email, starting with PECKLIST-.",
      ),
    ).toBeInTheDocument();
    await enter(box, 'PECKLIST-20261111-S-FAKEK-EY234');
    expect(await within(box).findByText("That key wasn't issued by PeckList.")).toBeInTheDocument();
    await enter(box, fakeSupporterKey('server'));
    expect(
      await within(box).findByText(
        "That's a server key. An admin enters it under Admin > Support.",
      ),
    ).toBeInTheDocument();
  });

  it('thanks a supporter with the date on their key, fills the heart, and the key can come off', async () => {
    const backend = samsServer();
    await appAs(backend, 'sam', '/settings/support');
    const box = await keyBox();
    await enter(box, fakeSupporterKey('person'));
    expect(
      await within(box).findByText(/Thank you for supporting PeckList! Your key is from .*2026/),
    ).toBeInTheDocument();
    expect(backend.supporterKeys.get('sam')).toEqual({ purchased: '2026-11-11', kind: 'person' });
    expect(screen.queryByRole('button', { name: 'Hide the reminder' })).toBeNull();

    await userEvent.click(within(box).getByRole('button', { name: 'Remove my key' }));
    expect(await within(box).findByLabelText('Enter your key')).toBeInTheDocument();
    expect(backend.supporterKeys.has('sam')).toBe(false);
  });

  it('a server key thanks everyone on the server and keeps the reminder away', async () => {
    const backend = samsServer();
    backend.serverSupporterKey = { purchased: '2026-11-01', kind: 'server' };
    await appAs(backend, 'sam', '/settings/support');
    const box = await keyBox();
    expect(
      within(box).getByText(/This server supports PeckList, with a key from/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide the reminder' })).toBeNull();
  });

  it('reminds people who are not supporters in the sidebar, and opens the Support page', async () => {
    await appAs(samsServer(), 'sam', '/today');
    const hide = await screen.findByRole('button', { name: 'Hide the reminder' });
    const reminder = hide.parentElement!;
    await userEvent.click(within(reminder).getByRole('button', { name: 'Support PeckList' }));
    expect(await keyBox()).toBeInTheDocument();
  });

  it('hides the reminder for 30 days', async () => {
    await appAs(samsServer(), 'sam', '/today');
    await userEvent.click(await screen.findByRole('button', { name: 'Hide the reminder' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide for 30 days' }));
    expect(screen.queryByRole('button', { name: 'Hide the reminder' })).toBeNull();
    const until = Date.parse(localStorage.getItem('pecklist.supporterReminder') ?? '');
    expect(until - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(until - Date.now()).toBeLessThan(31 * 86_400_000);
  });

  it('hides the reminder for good, and it stays away next time', async () => {
    await appAs(samsServer(), 'sam', '/today');
    await userEvent.click(await screen.findByRole('button', { name: 'Hide the reminder' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: "Don't show again" }));
    expect(localStorage.getItem('pecklist.supporterReminder')).toBe('forever');
  });

  it('comes back once 30 days have passed', async () => {
    localStorage.setItem('pecklist.supporterReminder', new Date(Date.now() - 1000).toISOString());
    await appAs(samsServer(), 'sam', '/today');
    expect(await screen.findByRole('button', { name: 'Hide the reminder' })).toBeInTheDocument();
  });

  it('a hidden reminder stays hidden', async () => {
    localStorage.setItem('pecklist.supporterReminder', 'forever');
    await appAs(samsServer(), 'sam', '/settings/support');
    await keyBox();
    expect(screen.queryByRole('button', { name: 'Hide the reminder' })).toBeNull();
  });
});
