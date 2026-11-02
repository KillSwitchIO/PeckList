import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('phone');
});

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

async function withTask(title: string) {
  const store = testStore();
  await renderApp('/inbox', store);
  let id = '';
  store.getState().apply((ctx, ws) => {
    const made = createTask(ctx, ws, { title, listId: inboxList(ws).id });
    id = made.task.id;
    return made.workspace;
  });
  const titleOf = () =>
    store.getState().workspace!.entities.tasks.find((each) => each.id === id)?.title;
  return { store, titleOf };
}

describe('a renamed task keeps its new title (Courtney, 2026-11-02)', () => {
  it('when the panel closes without a blur, as the Android back gesture does', async () => {
    const { titleOf } = await withTask('BBQ Garlic Hot Sauce');
    await userEvent.click(await screen.findByRole('button', { name: 'Open BBQ Garlic Hot Sauce' }));
    const field = await screen.findByRole('textbox', { name: 'Title' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Barbecue Garlic Hot Sauce');
    expect(titleOf()).toBe('BBQ Garlic Hot Sauce');
    // fireEvent, not userEvent: closing must not move focus first, or the old blur would save it.
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    await waitFor(() => expect(titleOf()).toBe('Barbecue Garlic Hot Sauce'));
    expect(
      await screen.findByRole('button', { name: 'Open Barbecue Garlic Hot Sauce' }),
    ).toBeInTheDocument();
  });

  it('when the app goes to the background with the title still being typed', async () => {
    const { titleOf } = await withTask('Hot sauce');
    await userEvent.click(await screen.findByRole('button', { name: 'Open Hot sauce' }));
    const field = await screen.findByRole('textbox', { name: 'Title' });
    await userEvent.type(field, ' for the fridge');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(titleOf()).toBe('Hot sauce for the fridge'));
  });
});
