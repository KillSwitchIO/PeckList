import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeShell } from '../../test/fakeShell.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { SaveSignIn } from './saveSignIn.ts';
import { setNativeShell } from './shell.ts';

/** The shell at api 14, counting each time it is asked to write the sign-in to disk. */
class SavingShell extends FakeShell {
  saves = 0;
  constructor(api = 14) {
    super(api);
  }
  saveSignIn() {
    this.saves++;
    return Promise.resolve();
  }
}

beforeEach(() => localStorage.clear());
afterEach(() => setNativeShell(null));

/** The app's sync engine, signed out, against a (fake) server with one account. */
async function signedOut(shell: SavingShell) {
  setNativeShell(shell);
  const backend = new FakeBackend();
  backend.addAccount('ben', 'correct horse battery');
  const store = testStore();
  await store.getState().init();
  const sync = createSyncEngine({
    transport: backend.device(),
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await sync.getState().start();
  render(
    <AppProviders store={store} sync={sync}>
      <SaveSignIn />
    </AppProviders>,
  );
  return sync;
}

describe('a sign-in on the phone', () => {
  it('is written to disk as soon as it succeeds, once per sign-in', async () => {
    const shell = new SavingShell();
    const sync = await signedOut(shell);
    // Give the shell's api answer time to arrive: nothing to save while signed out.
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(shell.saves).toBe(0);

    await act(() => sync.getState().signIn('ben', 'correct horse battery'));
    await waitFor(() => expect(shell.saves).toBe(1));

    // Syncing again changes nothing to save.
    await act(() => sync.getState().syncNow());
    expect(shell.saves).toBe(1);

    await act(() => sync.getState().signOut());
    await act(() => sync.getState().signIn('ben', 'correct horse battery'));
    await waitFor(() => expect(shell.saves).toBe(2));
  });

  it('is left alone by an older app (api 13 and below)', async () => {
    const shell = new SavingShell(13);
    const sync = await signedOut(shell);
    await act(() => sync.getState().signIn('ben', 'correct horse battery'));
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(shell.saves).toBe(0);
  });
});
