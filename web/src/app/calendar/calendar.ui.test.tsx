import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});
afterEach(() => vi.restoreAllMocks());

async function calendarWith(path = '/calendar') {
  const store = testStore();
  await store.getState().init();
  const zone = localTimeZone();
  const today = todayIn(zone, Date.now());
  let dentist = '';
  let standup = '';
  store.getState().apply((ctx, ws) => {
    const inbox = inboxList(ws).id;
    const made = createTask(ctx, ws, {
      title: 'Dentist',
      listId: inbox,
      schedule: { start: today, end: null, allDay: true, timeZone: zone },
      due: { at: today, allDay: true, timeZone: zone },
    });
    dentist = made.task.id;
    const timed = createTask(ctx, made.workspace, {
      title: 'Standup',
      listId: inbox,
      schedule: {
        start: `${today}T09:00`,
        end: `${today}T10:00`,
        allDay: false,
        timeZone: zone,
      },
    });
    standup = timed.task.id;
    return createTask(ctx, timed.workspace, { title: 'Someday', listId: inbox }).workspace;
  });
  await store.getState().flush();
  await renderApp(path, store);
  const task = (id: string) =>
    store.getState().workspace!.entities.tasks.find((each) => each.id === id)!;
  return { store, today, zone, task, dentist, standup };
}

/** Point the browser's hit test at an element (jsdom has no layout). */
function pointAt(element: Element | null) {
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(element);
}

describe('calendar', () => {
  it('lists tasks and due flags in the month, and unscheduled ones to drag in', async () => {
    const { today } = await calendarWith();
    const month = await screen.findByRole('grid', { name: 'Month' });
    const day = within(month).getByRole('gridcell', { name: 'Today' });
    expect(within(day).getByRole('button', { name: 'Dentist' })).toBeInTheDocument();
    expect(within(day).getByRole('button', { name: /Standup$/ })).toBeInTheDocument();
    expect(within(day).getByRole('button', { name: 'Due: Dentist' })).toBeInTheDocument();
    expect(day).toHaveAttribute('data-cal-day', today);
    const waiting = screen.getByRole('list', { name: 'Unscheduled' });
    expect(within(waiting).getByRole('listitem')).toHaveTextContent('Someday');
  });

  it('switches to Days, shows as many as the slider says, remembers, and pages by them', async () => {
    await calendarWith();
    const modes = await screen.findByRole('group', { name: 'Calendar view' });
    await userEvent.click(within(modes).getByRole('button', { name: 'Days' }));
    expect(screen.getByRole('slider', { name: 'Days shown' })).toHaveValue('7');
    expect(
      screen
        .getAllByRole('group', { name: /./ })
        .filter((each) => each.hasAttribute('data-cal-slots')),
    ).toHaveLength(7);
    fireEvent.change(screen.getByRole('slider', { name: 'Days shown' }), { target: { value: 3 } });
    expect(JSON.parse(localStorage.getItem('punchlist.calendar')!)).toMatchObject({
      mode: 'days',
      days: 3,
    });
    const title = screen.getByRole('heading', { level: 2 }).textContent;
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).not.toBe(title);
    await userEvent.click(screen.getByRole('button', { name: 'Go to today' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(title);
  });

  it('takes the old Week and Day choices over as Days', async () => {
    localStorage.setItem('punchlist.calendar.mode', 'week');
    await calendarWith();
    expect(await screen.findByRole('slider', { name: 'Days shown' })).toHaveValue('7');
  });

  it('opens a task from the month, and a day to add to it', async () => {
    const { store, today } = await calendarWith();
    const month = await screen.findByRole('grid', { name: 'Month' });
    const day = within(month).getByRole('gridcell', { name: 'Today' });
    await userEvent.click(within(day).getByRole('button', { name: 'Open Today' }));
    const popup = await screen.findByRole('dialog');
    expect(within(popup).getByRole('button', { name: 'Dentist' })).toBeInTheDocument();
    await userEvent.type(
      within(popup).getByRole('textbox', { name: 'Add a task to this day' }),
      'Pick up cake{Enter}',
    );
    const cake = store
      .getState()
      .workspace!.entities.tasks.find((each) => each.title === 'Pick up cake');
    expect(cake?.schedule).toMatchObject({ start: today, allDay: true });
    await userEvent.click(within(popup).getByRole('button', { name: 'Dentist' }));
    expect(await screen.findByRole('textbox', { name: /title/i })).toHaveValue('Dentist');
  });

  it('adds a task at a tapped time in Days', async () => {
    localStorage.setItem(
      'punchlist.calendar',
      JSON.stringify({ mode: 'days', days: 1, hourHeight: 48 }),
    );
    const { store, today } = await calendarWith();
    const column = (await screen.findAllByRole('group')).find(
      (each) => each.getAttribute('data-cal-slots') === today,
    )!;
    expect(within(column).getByRole('button', { name: /Standup/ })).toBeInTheDocument();
    // 14:00 is 14 hours of 48 px down the column (its top is 0 without layout).
    fireEvent.pointerDown(column, { clientX: 10, clientY: 14 * 48 + 5, button: 0 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 14 * 48 + 5 });
    const popup = await screen.findByRole('dialog');
    await userEvent.type(
      within(popup).getByRole('textbox', { name: /Add a task at/ }),
      'Call Kim{Enter}',
    );
    const call = store
      .getState()
      .workspace!.entities.tasks.find((each) => each.title === 'Call Kim');
    expect(call?.schedule).toMatchObject({ start: `${today}T14:00`, allDay: false });
  });

  it('moves a task by dragging it to another day, without opening it', async () => {
    const { today, task, dentist } = await calendarWith();
    const month = await screen.findByRole('grid', { name: 'Month' });
    const line = within(within(month).getByRole('gridcell', { name: 'Today' })).getByRole(
      'button',
      { name: 'Dentist' },
    );
    const tomorrow = month.querySelector(`[data-cal-day="${addDays(today, 1)}"]`);
    fireEvent.pointerDown(line, {
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerType: 'mouse',
      pointerId: 1,
    });
    pointAt(tomorrow);
    fireEvent.pointerMove(window, { clientX: 60, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 60, clientY: 10, pointerId: 1 });
    fireEvent.click(line);
    expect(task(dentist).schedule).toMatchObject({ start: addDays(today, 1), allDay: true });
    expect(screen.queryByRole('textbox', { name: /title/i })).toBeNull();
  });

  it('moves a task under a finger without holding it first', async () => {
    const { today, task, dentist } = await calendarWith();
    const month = await screen.findByRole('grid', { name: 'Month' });
    const line = within(within(month).getByRole('gridcell', { name: 'Today' })).getByRole(
      'button',
      { name: 'Dentist' },
    );
    const later = month.querySelector(`[data-cal-day="${addDays(today, 2)}"]`);
    fireEvent.pointerDown(line, {
      clientX: 10,
      clientY: 10,
      button: 0,
      pointerType: 'touch',
      pointerId: 5,
    });
    pointAt(later);
    fireEvent.pointerMove(window, { clientX: 90, clientY: 12, pointerType: 'touch', pointerId: 5 });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 12, pointerType: 'touch', pointerId: 5 });
    expect(task(dentist).schedule).toMatchObject({ start: addDays(today, 2), allDay: true });
  });

  it('stretches a task from its top edge and its bottom edge', async () => {
    localStorage.setItem(
      'punchlist.calendar',
      JSON.stringify({ mode: 'days', days: 1, hourHeight: 48 }),
    );
    const { today, task, standup } = await calendarWith();
    const block = await screen.findByRole('button', { name: /Standup/ });
    const top = block.querySelector('[data-cal-grip="top"]')!;
    fireEvent.pointerDown(top, { clientX: 10, clientY: 9 * 48, button: 0, pointerId: 6 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 8 * 48, pointerId: 6 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 8 * 48, pointerId: 6 });
    expect(task(standup).schedule).toMatchObject({
      start: `${today}T08:00`,
      end: `${today}T10:00`,
    });
    const bottom = (await screen.findByRole('button', { name: /Standup/ })).querySelector(
      '[data-cal-grip="bottom"]',
    )!;
    fireEvent.pointerDown(bottom, { clientX: 10, clientY: 10 * 48, button: 0, pointerId: 7 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 11.5 * 48, pointerId: 7 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 11.5 * 48, pointerId: 7 });
    expect(task(standup).schedule).toMatchObject({
      start: `${today}T08:00`,
      end: `${today}T11:30`,
    });
  });

  it('picks days by dragging across them, and shows just those', async () => {
    const { today } = await calendarWith();
    const month = await screen.findByRole('grid', { name: 'Month' });
    const first = month.querySelector(`[data-cal-day="${today}"]`)!;
    const third = month.querySelector(`[data-cal-day="${addDays(today, 2)}"]`);
    fireEvent.pointerDown(first, { clientX: 5, clientY: 5, button: 0, pointerId: 2 });
    pointAt(third);
    fireEvent.pointerMove(window, { clientX: 200, clientY: 5, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: 200, clientY: 5, pointerId: 2 });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Show these 3 days' }));
    expect(screen.getByRole('slider', { name: 'Days shown' })).toHaveValue('3');
  });
});
