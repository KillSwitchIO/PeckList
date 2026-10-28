import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function withTasks(titles: string[]) {
  const store = testStore();
  await renderApp('/inbox', store);
  act(() =>
    store.getState().apply((ctx, ws) => {
      let next = ws;
      for (const title of titles) {
        next = createTask(ctx, next, { title, listId: inboxList(next).id }).workspace;
      }
      return next;
    }),
  );
  return store;
}

describe('easter eggs in the app (R-FB-122)', () => {
  it('a piñata bursts when completed; emptying the Mess Drawer then wins a trophy', async () => {
    await withTasks(['Fill the piñata']);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Fill the piñata/ }));
    expect(await screen.findByText('Piñata smashed! Have some candy.')).toBeInTheDocument();
    expect(
      await screen.findByText('Mess Drawer empty!', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('five completions in a row bring Punchy out', async () => {
    await withTasks(['One', 'Two', 'Three', 'Four', 'Five']);
    for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await userEvent.click(
        await screen.findByRole('checkbox', { name: new RegExp(`^Complete ${title}`) }),
      );
    }
    expect(await screen.findByText('Punchy says: 5 in a row!')).toBeInTheDocument();
  });

  it('a task called clickety clack starts typewriter mode', async () => {
    await withTasks([]);
    await userEvent.type(
      await screen.findByRole('textbox', { name: /^Add task/ }),
      'Clickety clack{Enter}',
    );
    expect(await screen.findByText(/typewriter mode/)).toBeInTheDocument();
    expect(document.body.classList.contains('pl-egg-typewriter')).toBe(true);
  });

  it('the Konami code rains confetti', async () => {
    await withTasks([]);
    await userEvent.keyboard(
      '{ArrowUp}{ArrowUp}{ArrowDown}{ArrowDown}{ArrowLeft}{ArrowRight}{ArrowLeft}{ArrowRight}ba',
    );
    expect(await screen.findByText('You found the party!')).toBeInTheDocument();
  });
});
