import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => localStorage.clear());

describe("a repeating task's dates to come (PL-060)", () => {
  it('shows in Upcoming before the first is done, and one can be skipped on its own', async () => {
    const store = testStore();
    await renderApp('/upcoming', store);
    const today = todayIn(localTimeZone(), Date.now());
    let id = '';
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, {
        title: 'Water the plants',
        listId: inboxList(ws).id,
        schedule: { start: addDays(today, 1), end: null, allDay: true, timeZone: localTimeZone() },
        recurrence: 'FREQ=DAILY',
      });
      id = made.task.id;
      return made.workspace;
    });
    const toCome = await screen.findAllByRole(
      'button',
      { name: /^Water the plants, repeats on/ },
      { timeout: 5000 },
    );
    const before = toCome.length;
    expect(before).toBeGreaterThan(1);

    await userEvent.click(toCome[0]!);
    const skip = await screen.findByRole('button', { name: /^Skip / }, { timeout: 5000 });
    await userEvent.click(skip);
    const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
    await waitFor(() =>
      expect(task().recurrence).toBe(`FREQ=DAILY;X-PL-SKIP=${addDays(today, 2).replace(/-/g, '')}`),
    );
    // The task itself is still on its own date, and the list has one date less.
    expect(task().schedule?.start).toBe(addDays(today, 1));
    await userEvent.keyboard('{Escape}');
    await waitFor(
      () =>
        expect(
          screen.getAllByRole('button', { name: /^Water the plants, repeats on/ }),
        ).toHaveLength(before - 1),
      { timeout: 5000 },
    );
  });
});
