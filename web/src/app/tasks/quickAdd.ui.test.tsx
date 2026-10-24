import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { members } from '../../core/ops.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('quick add', () => {
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
