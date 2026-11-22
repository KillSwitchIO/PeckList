// The phone's own screens read times on the app's clock (schema 22, shell api 17).
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setIntlLocale, setPhoneClock } from '../../core/intl.ts';
import { updateSettings } from '../../core/settings.ts';
import { FakeShell } from '../../test/fakeShell.ts';
import { testStore } from '../../test/renderApp.tsx';
import { clockIs24 } from '../format.ts';
import { AppProviders } from '../providers.tsx';
import { NativeClock } from './nativeClock.ts';
import { setNativeShell } from './shell.ts';

/** The shell at the api a test asks for, keeping each clock it is handed. */
class ClockShell extends FakeShell {
  handed: (boolean | null)[] = [];
  constructor(api = 17, clock24?: boolean) {
    super(api);
    this.clock24 = clock24;
  }
  setClock(twentyFour: boolean | null) {
    this.handed.push(twentyFour);
    return Promise.resolve();
  }
}

afterEach(() => {
  setNativeShell(null);
  setPhoneClock(undefined);
  setIntlLocale(undefined);
});

async function mounted(shell: ClockShell) {
  setNativeShell(shell);
  const store = testStore();
  await store.getState().init();
  render(
    <AppProviders store={store}>
      <NativeClock />
    </AppProviders>,
  );
  return store;
}

const last = (shell: ClockShell) => shell.handed[shell.handed.length - 1];

describe('the phone reads times on the app’s clock', () => {
  it('hands over the web app’s own clock, at start and on each change', async () => {
    const shell = new ClockShell();
    const store = await mounted(shell);
    // Once or twice: it mounts again when the first language choice settles (WorkspaceTheme).
    await waitFor(() => expect(last(shell)).toBe(false)); // jsdom: en-US

    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { language: 'de' })));
    await waitFor(() => expect(last(shell)).toBe(true));
    // The same rule as the web app's own times (Dev 1, N2).
    expect(clockIs24()).toBe(true);

    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { clockFormat: '12h' })));
    await waitFor(() => expect(last(shell)).toBe(false));
  });

  it('on Automatic, follows the phone’s own setting ahead of the language, web app too', async () => {
    const shell = new ClockShell(17, true); // an en-US phone set to 24-hour (Dev 1 S2, Manager)
    const store = await mounted(shell);
    // null: the shell's screens read the phone's setting live; the web app shows it too.
    await waitFor(() => expect(last(shell)).toBeNull());
    expect(shell.handed.every((each) => each === null)).toBe(true);
    expect(clockIs24()).toBe(true);

    // A picked language doesn't change that: the phone's setting is the stronger signal.
    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { language: 'en' })));
    await waitFor(() =>
      expect(store.getState().workspace?.entities.settings[0]?.language).toBe('en'),
    );
    await new Promise((done) => setTimeout(done, 50));
    expect(last(shell)).toBeNull();
    expect(clockIs24()).toBe(true);

    // A clock picked in the app wins over both.
    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { clockFormat: '12h' })));
    await waitFor(() => expect(last(shell)).toBe(false));
    expect(clockIs24()).toBe(false);
  });

  it('asks nothing of a shell before api 17, nor takes its clock', async () => {
    const shell = new ClockShell(16, true);
    const store = await mounted(shell);
    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { clockFormat: '24h' })));
    await new Promise((done) => setTimeout(done, 50));
    expect(shell.handed).toEqual([]);
    act(() =>
      store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { clockFormat: 'auto' })),
    );
    await new Promise((done) => setTimeout(done, 20));
    expect(clockIs24()).toBe(false); // the browser's en-US, not the shell's true
  });

  it('reads the phone’s setting again when the app comes back (Dev 1, N4)', async () => {
    const shell = new ClockShell(17, false);
    await mounted(shell);
    await waitFor(() => expect(last(shell)).toBeNull());
    expect(clockIs24()).toBe(false);
    // The 12/24-hour switch turned on in Android's settings, then back to the app.
    shell.clock24 = true;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(clockIs24()).toBe(true));
  });
});
