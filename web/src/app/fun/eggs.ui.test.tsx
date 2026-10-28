import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { type Egg, hatch, onHatch } from './eggs.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const today = () => todayIn(localTimeZone(), Date.now());

/** A task due today, in the Mess Drawer. */
function dueToday(store: ReturnType<typeof testStore>, title: string) {
  act(() =>
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title,
          listId: inboxList(ws).id,
          schedule: { start: today(), end: null, allDay: true, timeZone: localTimeZone() },
        }).workspace,
    ),
  );
}

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

/** The line at the top saying what was found (the characters' own bubbles say other things). */
const findLine = (text: string | RegExp, _options?: object, waiting?: { timeout?: number }) =>
  screen.findByText(
    (_content, element) =>
      element?.getAttribute('role') === 'status' &&
      (typeof text === 'string'
        ? element.textContent === text
        : text.test(element.textContent ?? '')),
    {},
    waiting,
  );

describe('easter eggs in the app (R-FB-122)', () => {
  it('a piñata bursts when completed; emptying the Mess Drawer then wins a trophy', async () => {
    await withTasks(['Fill the piñata']);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Fill the piñata/ }));
    expect(await findLine('Piñata smashed! Have some candy.')).toBeInTheDocument();
    expect(await findLine('Mess Drawer empty!', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('five completions in a row bring Punchy out', async () => {
    await withTasks(['One', 'Two', 'Three', 'Four', 'Five']);
    for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await userEvent.click(
        await screen.findByRole('checkbox', { name: new RegExp(`^Complete ${title}`) }),
      );
    }
    expect(await findLine('Punchy says: 5 in a row!')).toBeInTheDocument();
  });

  it('a task called clickety clack starts typewriter mode', async () => {
    await withTasks([]);
    await userEvent.type(
      await screen.findByRole('textbox', { name: /^Add task/ }),
      'Clickety clack{Enter}',
    );
    expect(await findLine(/typewriter mode/)).toBeInTheDocument();
    expect(document.body.classList.contains('pl-egg-typewriter')).toBe(true);
  });

  it('the Konami code rains confetti', async () => {
    await withTasks([]);
    await userEvent.keyboard(
      '{ArrowUp}{ArrowUp}{ArrowDown}{ArrowDown}{ArrowLeft}{ArrowRight}{ArrowLeft}{ArrowRight}ba',
    );
    expect(await findLine('You found the party!')).toBeInTheDocument();
  });

  it('a search for the secret words sets them off, opened straight or typed', async () => {
    const store = testStore();
    await renderApp('/search?q=insert%20coin', store);
    expect(await findLine(/Retro mode/)).toBeInTheDocument();
    const field = screen.getByRole('searchbox', { name: 'Search tasks' });
    await userEvent.clear(field);
    await userEvent.type(field, 'follow the white rabbit');
    expect(
      await findLine('Wake up. The tasks have you.', {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('the dog sleeps on the + button until touched, then trots off', async () => {
    await withTasks([]);
    act(() => hatch('dog'));
    const dog = await screen.findByRole('button', { name: 'Wake the dog' }, { timeout: 6000 });
    await userEvent.click(dog);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Wake the dog' })).toBeNull());
  });

  it('disco says so and is over in two seconds', async () => {
    await withTasks([]);
    act(() => hatch('disco'));
    expect(await findLine('Disco!')).toBeInTheDocument();
    expect(document.body.classList.contains('pl-egg-disco')).toBe(true);
    await waitFor(() => expect(document.body.classList.contains('pl-egg-disco')).toBe(false), {
      timeout: 3500,
    });
  });

  it('renaming a task clickety clack starts typewriter mode too', async () => {
    await withTasks(['Plain task']);
    await userEvent.click(await screen.findByRole('button', { name: 'Open Plain task' }));
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'clickety clack{Enter}');
    expect(await findLine(/typewriter mode/)).toBeInTheDocument();
  });

  it('fireworks when the last task of Today is completed while Today is open', async () => {
    const store = testStore();
    await renderApp('/today', store);
    dueToday(store, 'Walk the dog');
    await userEvent.click(await screen.findByRole('checkbox', { name: /^Complete Walk the dog/ }));
    expect(await findLine('Today is done! Fireworks!')).toBeInTheDocument();
  });

  it('not from another page; then once on opening a finished Today, and not again that day', async () => {
    const eggs: Egg[] = [];
    const stop = onHatch((egg) => eggs.push(egg));
    const store = testStore();
    await renderApp('/inbox', store);
    dueToday(store, 'Walk the dog');
    await userEvent.click(await screen.findByRole('checkbox', { name: /^Complete Walk the dog/ }));
    // The Mess Drawer emptied (a trophy), but Today was not open: no fireworks.
    expect(await findLine('Mess Drawer empty!')).toBeInTheDocument();
    expect(eggs).not.toContain('fireworks');

    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(await findLine('Today is done! Fireworks!')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mess Drawer' }));
    await screen.findByRole('heading', { level: 1, name: 'Mess Drawer' });
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await screen.findByText('All punched out.');
    expect(eggs.filter((egg) => egg === 'fireworks')).toHaveLength(1);
    stop();
  });
});
