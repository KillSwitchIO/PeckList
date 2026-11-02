import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { renderApp, testStore } from '../../test/renderApp.tsx';

// jsdom has no Web Animations: these give it one whose animations end when the test says.
const animate = Element.prototype.animate as typeof Element.prototype.animate | undefined;
let finishAll: () => void = () => undefined;

/** Animations that end when `finishAll` runs, or never when `forever`. */
function fakeAnimations(forever = false) {
  const waiting: (() => void)[] = [];
  finishAll = () => waiting.splice(0).forEach((finish) => finish());
  Element.prototype.animate = function () {
    const finished = new Promise<void>((resolve) => {
      if (!forever) waiting.push(resolve);
    });
    return { finished, cancel: () => undefined } as unknown as Animation;
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  if (animate) Element.prototype.animate = animate;
  else delete (Element.prototype as Partial<Element>).animate;
});

async function withTask(title: string, path = '/inbox') {
  const store = testStore();
  await renderApp(path, store);
  let id = '';
  store.getState().apply((ctx, ws) => {
    const made = createTask(ctx, ws, { title, listId: inboxList(ws).id });
    id = made.task.id;
    return made.workspace;
  });
  const status = () =>
    store.getState().workspace!.entities.tasks.find((each) => each.id === id)?.status;
  const layer = () =>
    [...document.body.children].find((each) => (each as HTMLElement).style.zIndex === '2000');
  return { status, layer };
}

describe('checking a task off with the bird (PL-126)', () => {
  it('writes the task as done once the bird is done, and clears the bird away', async () => {
    fakeAnimations();
    const { status, layer } = await withTask('Water the plants');
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Complete Water the plants' }),
    );
    expect(layer()).toBeDefined();
    expect(status()).toBe('open');
    // Another tap while it flies does nothing more.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Complete Water the plants' }));
    finishAll();
    await waitFor(() => expect(status()).toBe('done'));
    await waitFor(() => expect(layer()).toBeUndefined());
  });

  it('never keeps a check-off waiting more than a second', async () => {
    fakeAnimations(true);
    const { status } = await withTask('Order the garlic bulbs');
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Complete Order the garlic bulbs' }),
    );
    expect(status()).toBe('open');
    await waitFor(() => expect(status()).toBe('done'), { timeout: 2000 });
  });

  it('reopens at once, with no bird', async () => {
    fakeAnimations();
    const { status, layer } = await withTask('Call the vet about Max');
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Complete Call the vet about Max' }),
    );
    finishAll();
    await waitFor(() => expect(status()).toBe('done'));
    await waitFor(() => expect(layer()).toBeUndefined());
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Reopen Call the vet about Max' }),
    );
    expect(status()).toBe('open');
    expect(layer()).toBeUndefined();
  });
});
