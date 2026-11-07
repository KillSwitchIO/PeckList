import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, setTimeZone, todayIn } from '../../core/dates.ts';
import { members } from '../../core/ops.ts';
import { updateSettings } from '../../core/settings.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

afterEach(() => {
  vi.useRealTimers();
  setTimeZone(null);
});

describe('quick add', () => {
  // At this moment nearly every browser's date is the 7th; these two zones are on the 6th and 8th.
  it.each([
    ['behind', 'Pacific/Pago_Pago', '2026-11-06', '2026-11-07', '2026-11-07T09:00'],
    ['ahead of', 'Pacific/Kiritimati', '2026-11-08', '2026-11-09', '2026-11-08T09:00'],
  ])(
    'counts from a chosen zone %s the browser',
    async (_where, timeZone, today, tomorrow, nineAm) => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-07T10:30:00Z') });
      const store = testStore();
      await renderApp('/today', store);
      act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { timeZone })));

      const field = screen.getByRole('textbox', { name: /Add task/ });
      const startOf = async (words: string, title: string) => {
        await userEvent.click(field);
        await userEvent.type(field, `${words}{Enter}`);
        await waitFor(() =>
          expect(
            store.getState().workspace!.entities.tasks.some((each) => each.title === title),
          ).toBe(true),
        );
        return store.getState().workspace!.entities.tasks.find((each) => each.title === title)!
          .schedule?.start;
      };
      expect(await startOf('Mow today', 'Mow')).toBe(today);
      expect(await startOf('Rake tomorrow', 'Rake')).toBe(tomorrow);
      expect(await startOf('Prune 9am', 'Prune')).toBe(nineAm);
      // Added for today, it is under today and not already overdue.
      expect(await screen.findByRole('button', { name: 'Open Mow' })).toBeInTheDocument();
      expect(screen.queryByText('Overdue')).toBeNull();
    },
  );

  it('shows what it recognises as chips, then saves it', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    const field = screen.getByRole('textbox', { name: /Add task/ });
    await userEvent.click(field);
    await userEvent.type(field, 'Plant bulbs tomorrow 3pm #fall !high');
    const chips = await screen.findByRole('list', { name: 'Recognised in the task' });
    const labels = within(chips)
      .getAllByRole('listitem')
      .map((chip) => chip.textContent);
    expect(labels).toEqual(['Tomorrow 3:00 PM', '#fall', 'High']);

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(store.getState().workspace!.entities.tasks).toHaveLength(1));
    const ws = store.getState().workspace!;
    const task = ws.entities.tasks[0]!;
    const tomorrow = addDays(todayIn(localTimeZone(), Date.now()), 1);
    expect(task).toMatchObject({
      title: 'Plant bulbs',
      priority: 3,
      schedule: { start: `${tomorrow}T15:00`, allDay: false },
    });
    const tag = ws.entities.tags.find((each) => each.name === 'fall')!;
    expect(members(task.tags)).toEqual([tag.id]);
    expect(field).toHaveValue('');
  });

  it("a chip's x keeps its words in the title", async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    const field = screen.getByRole('textbox', { name: /Add task/ });
    await userEvent.click(field);
    await userEvent.type(field, 'Read Tomorrow Never Dies');
    const chips = await screen.findByRole('list', { name: 'Recognised in the task' });
    await userEvent.click(within(chips).getByLabelText('Keep "Tomorrow" as text'));
    expect(screen.queryByRole('list', { name: 'Recognised in the task' })).toBeNull();
    await userEvent.click(field);
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(store.getState().workspace!.entities.tasks[0]).toMatchObject({
        title: 'Read Tomorrow Never Dies',
        schedule: null,
      }),
    );
  });
});
