import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, setTimeZone, todayIn } from '../../core/dates.ts';
import { members } from '../../core/ops.ts';
import { updateSettings } from '../../core/settings.ts';
import { blankTask, createTemplate } from '../../core/templates.ts';
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

  // PL-149: the date button comes in once there is something to date, on the left of the
  // template and expand buttons, which stay where they are.
  it('keeps its buttons in order: date (once typed), template, expand', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    act(() =>
      store
        .getState()
        .apply(
          (ctx, ws) =>
            createTemplate(ctx, ws, { name: 'Trip', kind: 'task', body: blankTask() }).workspace,
        ),
    );
    const field = screen.getByRole('textbox', { name: /Add task/ });
    const bar = field.closest('div[class*="MuiBox"]')!.parentElement!;
    const named = () =>
      within(bar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'));
    await waitFor(() => expect(named()).toEqual(['From template', 'Expand into the task form']));
    await userEvent.type(field, 'Water plants');
    expect(named()).toEqual(['Start date', 'From template', 'Expand into the task form']);
  });

  it('sets a start date picked with the date button', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    const field = screen.getByRole('textbox', { name: /Add task/ });
    expect(screen.queryByRole('button', { name: 'Start date' })).toBeNull();
    await userEvent.type(field, 'Water plants');
    await userEvent.click(screen.getByRole('button', { name: 'Start date' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tomorrow' }));
    const chips = await screen.findByRole('list', { name: 'Recognised in the task' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent),
    ).toEqual(['Tomorrow']);
    expect(screen.getByRole('button', { name: 'Start date' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(field);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(store.getState().workspace!.entities.tasks).toHaveLength(1));
    const tomorrow = addDays(todayIn(localTimeZone(), Date.now()), 1);
    expect(store.getState().workspace!.entities.tasks[0]).toMatchObject({
      title: 'Water plants',
      schedule: { start: tomorrow, allDay: true },
    });
    // The next task starts with no date.
    expect(screen.queryByRole('button', { name: 'Start date' })).toBeNull();
  });

  it('puts a picked date in place of one typed, and its x takes it off', async () => {
    const store = testStore();
    await renderApp('/inbox', store);
    const field = screen.getByRole('textbox', { name: /Add task/ });
    await userEvent.type(field, 'Call mom in 5 days #family');
    await userEvent.click(screen.getByRole('button', { name: 'Start date' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tomorrow' }));
    const chips = await screen.findByRole('list', { name: 'Recognised in the task' });
    const labels = () =>
      within(chips)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent);
    expect(labels()).toEqual(['Tomorrow', '#family']);
    await userEvent.click(field);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(store.getState().workspace!.entities.tasks).toHaveLength(1));
    const today = todayIn(localTimeZone(), Date.now());
    expect(store.getState().workspace!.entities.tasks[0]).toMatchObject({
      title: 'Call mom',
      schedule: { start: addDays(today, 1) },
    });

    // Picked, then taken off: the typed date is back.
    await userEvent.type(field, 'Rake in 5 days');
    await userEvent.click(screen.getByRole('button', { name: 'Start date' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tomorrow' }));
    await userEvent.click(
      within(await screen.findByRole('list', { name: 'Recognised in the task' })).getByLabelText(
        'No date',
      ),
    );
    expect(screen.getByRole('button', { name: 'Start date' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await userEvent.click(field);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(store.getState().workspace!.entities.tasks).toHaveLength(2));
    expect(
      store.getState().workspace!.entities.tasks.find((each) => each.title === 'Rake'),
    ).toMatchObject({ schedule: { start: addDays(today, 5) } });
  });
});
