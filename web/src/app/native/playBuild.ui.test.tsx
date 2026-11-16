import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { FakeShell } from '../../test/fakeShell.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import type { Notifier } from '../../ports/notifier.ts';
import { AppProviders } from '../providers.tsx';
import { notifier, setNotifier } from '../reminders/notifier.ts';
import { AppRoutes } from '../routes.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { BackgroundCheckPrompt } from './BackgroundCheck.tsx';
import { setNativeShell } from './shell.ts';

// The Google Play build (shell api 9, `distribution: 'play'`) follows Play's rules: no way to pay
// or donate, no update notice of its own, battery optimization turned off by hand from the list
// of apps. Every other case (a browser, the foss build, an older shell) keeps today's app.

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});
const browserNotifier = notifier();
afterEach(() => {
  setNativeShell(null);
  setNotifier(browserNotifier);
});

const slow = { timeout: 10_000 };

async function appAs(backend: FakeBackend, path: string, shell: FakeShell | null) {
  setNativeShell(shell);
  const store = testStore();
  const transport = backend.device();
  transport.session = 'sam';
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await renderApp(path, store, sync);
  await waitFor(() => expect(sync.getState().phase).toBe('ready'), slow);
}

function samsServer() {
  const backend = new FakeBackend();
  backend.addAccount('sam', 'a long enough password');
  return backend;
}

/** The ways the app can run: in a browser, the foss build, an older shell, and the Play build. */
const builds = {
  browser: () => null,
  foss: () => new FakeShell(9, 'foss'),
  'older shell': () => new FakeShell(8),
  play: () => new FakeShell(9, 'play'),
};
const notPlay = ['browser', 'foss', 'older shell'] as const;

describe('support links', () => {
  it.each(notPlay)(
    '%s: the sidebar reminder, the tip button and where to buy a key',
    async (build) => {
      await appAs(samsServer(), '/settings/support', builds[build]());
      const box = await screen.findByRole('region', { name: 'Supporter key' }, slow);
      expect(within(box).getByRole('link', { name: 'Get a supporter key' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Support on Ko-fi' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Support on PayPal' })).toHaveAttribute(
        'href',
        'https://www.paypal.com/donate/?hosted_button_id=NF3EZPGC3NL86',
      );
      expect(await screen.findByRole('button', { name: 'Hide the reminder' })).toBeInTheDocument();
    },
  );

  it('play: no reminder, no tip, no word on where to buy, but a key still goes in', async () => {
    await appAs(samsServer(), '/settings/support', builds.play());
    const box = await screen.findByRole('region', { name: 'Supporter key' }, slow);
    expect(within(box).getByLabelText('Enter your key')).toBeInTheDocument();
    expect(screen.getByText('Thank you for using PeckList.')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(box).queryByRole('link', { name: 'Get a supporter key' })).toBeNull(),
    );
    expect(screen.queryByRole('link', { name: 'Support on Ko-fi' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Support on PayPal' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Or leave a tip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide the reminder' })).toBeNull();
    expect(screen.queryByText('Say thanks with a tip')).toBeNull();
    // Nothing on the page leads to a payment page.
    for (const link of screen.queryAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(
        /ko-fi\.com|paypal\.com|pecklist\.com\/support/,
      );
    }
  });
});

describe("the app's own update notice", () => {
  function behind() {
    const backend = samsServer();
    backend.serverVersion = '0.2.8';
    backend.latestRelease = { version: '0.2.8', url: 'https://example.test/releases/v0.2.8' };
    return backend;
  }

  it('foss: an app older than the latest release is told so', async () => {
    await appAs(behind(), '/today', new FakeShell(9, 'foss', '0.2.7'));
    const notice = await screen.findByRole('status', { name: 'Update available' }, slow);
    expect(
      within(notice).getByText('PeckList 0.2.8 is out. This app is 0.2.7.'),
    ).toBeInTheDocument();
  });

  it('play: Google Play updates it, so no notice', async () => {
    await appAs(behind(), '/today', new FakeShell(9, 'play', '0.2.7'));
    await screen.findByRole('button', { name: /^Account: / }, slow);
    // The release is known (the server is up to date): only the app could be behind.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('status', { name: 'Update available' })).toBeNull();
  });

  it("play: the server's line stays", async () => {
    const backend = behind();
    backend.serverVersion = '0.2.7';
    await appAs(backend, '/today', new FakeShell(9, 'play', '0.2.7'));
    const notice = await screen.findByRole('status', { name: 'Update available' }, slow);
    expect(
      within(notice).getByText('PeckList 0.2.8 is out. This server runs 0.2.7.'),
    ).toBeInTheDocument();
    expect(within(notice).queryByText(/This app is/)).toBeNull();
  });
});

/** Signed in, with the prompt App.tsx shows once after signing in. */
async function withFirstPrompt(shell: FakeShell) {
  setNativeShell(shell);
  const asked: Notifier & { requests: number } = {
    requests: 0,
    permission: () => 'granted',
    request: () => {
      asked.requests += 1;
      return Promise.resolve('granted');
    },
    show: () => Promise.resolve(),
  };
  setNotifier(asked);
  const store = testStore();
  const transport = samsServer().device();
  transport.session = 'sam';
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  render(
    <AppProviders store={store} sync={sync}>
      <MemoryRouter initialEntries={['/today']}>
        <AppRoutes />
        <BackgroundCheckPrompt />
      </MemoryRouter>
    </AppProviders>,
  );
  await waitFor(() => expect(sync.getState().phase).toBe('ready'), slow);
  return asked;
}

describe('running in the background', () => {
  it('foss: after signing in, notifications and then Android’s own dialog are asked for', async () => {
    const shell = new FakeShell(9, 'foss');
    const asked = await withFirstPrompt(shell);
    await waitFor(() => expect(shell.batteryOpened).toBe(1));
    expect(asked.requests).toBe(1);
  });

  it('play: after signing in, notifications only; the list of apps never opens unasked', async () => {
    const shell = new FakeShell(9, 'play');
    const asked = await withFirstPrompt(shell);
    await waitFor(() => expect(asked.requests).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shell.batteryOpened).toBe(0);
  });

  it('foss: Settings says to let it run in the background, with Android’s dialog', async () => {
    const shell = new FakeShell(9, 'foss');
    shell.background = { ...shell.background, asked: true };
    await appAs(samsServer(), '/settings/notifications', shell);
    const section = await screen.findByRole('region', { name: 'On this device' }, slow);
    expect(
      within(section).getByText(
        'Android may put PeckList to sleep and hold back these checks. Let it run in the background so they come on time.',
      ),
    ).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Allow' })).toBeInTheDocument();
  });

  it('play: Settings says how to do it by hand, and opens the list of apps', async () => {
    const shell = new FakeShell(9, 'play');
    await appAs(samsServer(), '/settings/notifications', shell);
    const section = await screen.findByRole('region', { name: 'On this device' }, slow);
    expect(
      within(section).getByText(
        /Open the list of apps, pick PeckList and choose not to optimize it/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Open the list' }));
    expect(shell.batteryOpened).toBe(1);
  });
});

describe('exact reminders', () => {
  it('play, not allowed yet: "Allow exact reminders" opens Android’s page and goes once allowed', async () => {
    const shell = new FakeShell(9, 'play');
    shell.exact = { allowed: false, canAsk: true };
    await appAs(samsServer(), '/settings/notifications', shell);
    const section = await screen.findByRole('region', { name: 'On this device' }, slow);
    const allow = await within(section).findByRole('button', { name: 'Allow exact reminders' });
    await userEvent.click(allow);
    expect(shell.exactOpened).toBe(1);
    await waitFor(() =>
      expect(within(section).queryByRole('button', { name: 'Allow exact reminders' })).toBeNull(),
    );
  });

  it('allowed in Android’s settings meanwhile: gone when the app comes back', async () => {
    const shell = new FakeShell(9, 'play');
    shell.exact = { allowed: false, canAsk: true };
    await appAs(samsServer(), '/settings/notifications', shell);
    const section = await screen.findByRole('region', { name: 'On this device' }, slow);
    await within(section).findByRole('button', { name: 'Allow exact reminders' });
    shell.exact = { allowed: true, canAsk: false };
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() =>
      expect(within(section).queryByRole('button', { name: 'Allow exact reminders' })).toBeNull(),
    );
  });

  it.each([
    ['foss', () => new FakeShell(9, 'foss')],
    // A foss app on Android 12-13 where the person took exact alarms away: 0.12.1 leaves it as 0.12.0.
    [
      'foss, even when Android could ask',
      () => Object.assign(new FakeShell(9, 'foss'), { exact: { allowed: false, canAsk: true } }),
    ],
    ['an older shell', () => new FakeShell(8)],
  ])('%s: no prompt', async (_name, make) => {
    const shell = make();
    await appAs(samsServer(), '/settings/notifications', shell);
    const section = await screen.findByRole('region', { name: 'On this device' }, slow);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(section).queryByRole('button', { name: 'Allow exact reminders' })).toBeNull();
  });
});
