import { readFileSync } from 'node:fs';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask, setTaskStatus } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const mark = () => screen.getByTestId('empty-mark');

describe('the empty view’s mark (R-FB-152)', () => {
  it('plays on arriving and when the last task is done, not when a task’s panel opens', async () => {
    const store = testStore();
    await renderApp('/today', store);
    await waitFor(() => expect(mark()).toHaveAttribute('data-plays', 'true'));

    // A task for today, then done: the view emptied while open, so it plays again.
    let id = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, {
          title: 'Water the plants',
          listId: inboxList(ws).id,
          schedule: {
            start: todayIn(localTimeZone(), Date.now()),
            end: null,
            allDay: true,
            timeZone: localTimeZone(),
          },
        });
        id = made.task.id;
        return made.workspace;
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('empty-mark')).toBeNull());
    act(() => store.getState().apply((ctx, ws) => setTaskStatus(ctx, ws, id, 'done')));
    await waitFor(() => expect(mark()).toHaveAttribute('data-plays', 'true'));

    // Opening the done task's panel (the address changes) does not set it off again: the same
    // mark stays (its animation ran once), or a new one shows its check at once.
    const shown = mark();
    await userEvent.click(screen.getByRole('button', { name: 'Open Water the plants' }));
    await screen.findByRole('region', { name: 'Task details' });
    expect(mark() === shown || mark().getAttribute('data-plays') === 'false').toBe(true);

    // Away and back: a new arrival, so it plays.
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByText('Mess Drawer'));
    await userEvent.click(within(nav).getByText('Today'));
    await waitFor(() => expect(mark()).toHaveAttribute('data-plays', 'true'));
  });

  // Ben, 0.10.0: on search's "Nothing matches" the logo showed mirrored, bird facing backwards. A
  // 3D turn with hidden back faces does that wherever a browser flattens the 3D, so the flip is
  // flat (scaleX), and nothing in the mark turns round in 3D.
  it('flips flat, so no browser can show the logo mirrored', () => {
    const source = readFileSync('src/app/views/EmptyMark.tsx', 'utf8');
    expect(source).not.toMatch(/rotateY|backfaceVisibility|preserve-3d/);
    expect(source).toMatch(/scaleX\(0\)/);
  });
});
