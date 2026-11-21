// The phone's own text follows the language picked in Settings (PL-148, shell api 15).
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { updateSettings } from '../../core/settings.ts';
import { FakeShell } from '../../test/fakeShell.ts';
import { testStore } from '../../test/renderApp.tsx';
import { StoreContext } from '../store/hooks.ts';
import { NativeLanguage } from './nativeLanguage.ts';
import { setNativeShell } from './shell.ts';

/** The shell at the api a test asks for, keeping each language it is handed. */
class LanguageShell extends FakeShell {
  handed: (string | null)[] = [];
  constructor(api = 15) {
    super(api);
  }
  setLanguage(language: string | null) {
    this.handed.push(language);
    return Promise.resolve();
  }
}

afterEach(() => setNativeShell(null));

const settle = () => act(() => new Promise((done) => setTimeout(done, 20)));

async function mounted(shell: LanguageShell, init = true) {
  setNativeShell(shell);
  const store = testStore();
  if (init) await store.getState().init();
  render(
    <StoreContext.Provider value={store}>
      <NativeLanguage />
    </StoreContext.Provider>,
  );
  await settle();
  return store;
}

describe('the phone speaks the picked language', () => {
  it('hands over automatic at start, then each pick as it is made or synced in', async () => {
    const shell = new LanguageShell();
    const store = await mounted(shell);
    expect(shell.handed).toEqual([null]);

    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { language: 'de-AT' })));
    await settle();
    expect(shell.handed).toEqual([null, 'de-AT']);

    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { language: null })));
    await settle();
    expect(shell.handed).toEqual([null, 'de-AT', null]);
  });

  it('waits for the tasks to load, so automatic never undoes a pick not read yet', async () => {
    const shell = new LanguageShell();
    const store = await mounted(shell, false);
    expect(shell.handed).toEqual([]);
    await act(() => store.getState().init());
    await settle();
    expect(shell.handed).toEqual([null]);
  });

  it('asks nothing of a shell before api 15', async () => {
    const shell = new LanguageShell(14);
    const store = await mounted(shell);
    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { language: 'fr' })));
    await settle();
    expect(shell.handed).toEqual([]);
  });
});
