import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask, setTaskStatus } from '../../core/tasks.ts';
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

  it('shows what was done on days gone by, but not from today on (Ben, 2026-11-02)', async () => {
    const { store, today, zone } = await calendarWith();
    const yesterday = addDays(today, -1);
    act(() =>
      store.getState().apply((ctx, ws) => {
        const inbox = inboxList(ws).id;
        const past = createTask(ctx, ws, {
          title: 'Paid rent',
          listId: inbox,
          schedule: { start: yesterday, end: null, allDay: true, timeZone: zone },
        });
        const now = createTask(ctx, past.workspace, {
          title: 'Took vitamins',
          listId: inbox,
          schedule: { start: today, end: null, allDay: true, timeZone: zone },
        });
        return setTaskStatus(
          ctx,
          setTaskStatus(ctx, now.workspace, past.task.id, 'done'),
          now.task.id,
          'done',
        );
      }),
    );
    const month = await screen.findByRole('grid', { name: 'Month' });
    await waitFor(() =>
      expect(within(month).getByRole('button', { name: 'Paid rent' })).toBeInTheDocument(),
    );
    expect(
      within(month).getByRole('button', { name: 'Paid rent' }).closest('[data-cal-day]'),
    ).toHaveAttribute('data-cal-day', yesterday);
    expect(within(month).queryByRole('button', { name: 'Took vitamins' })).toBeNull();
  });

  it('switches to Days, shows as many as the slider says, remembers, and pages by them', async () => {
    await calendarWith();
    const modes = await screen.findByRole('group', { name: 'Calendar view' });
    await userEvent.click(within(modes).getByRole('button', { name: 'Days' }));
    const dial = screen.getByRole('slider', { name: 'Days shown' });
    expect(dial).toHaveAttribute('aria-valuenow', '7');
    expect(
      screen
        .getAllByRole('group', { name: /./ })
        .filter((each) => each.hasAttribute('data-cal-slots')),
    ).toHaveLength(7);
    dial.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(dial).toHaveAttribute('aria-valuenow', '3');
    expect(
      screen
        .getAllByRole('group', { name: /./ })
        .filter((each) => each.hasAttribute('data-cal-slots')),
    ).toHaveLength(3);
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

  // R-FB-71: the title picks a date, with the same month picker as Upcoming.
  it('goes to a date picked from the title', async () => {
    await calendarWith();
    const heading = () => screen.getByRole('heading', { level: 2 }).textContent;
    const before = heading();
    await userEvent.click(screen.getByRole('button', { name: /: pick a date$/ }));
    const picker = await screen.findByRole('presentation');
    const grid = within(picker).getByRole('grid');
    // A day four months on: the calendar goes there.
    for (let i = 0; i < 4; i += 1) {
      await userEvent.click(within(picker).getAllByRole('button', { name: /next/i })[0]!);
    }
    await userEvent.click(within(within(picker).getByRole('grid')).getAllByRole('gridcell')[15]!);
    await waitFor(() => expect(screen.queryByRole('presentation')).toBeNull());
    expect(heading()).not.toBe(before);
    expect(grid).not.toBeInTheDocument();
  });

  it('picks days on a dial: hold, run round it, and the columns follow before letting go', async () => {
    await calendarWith();
    const modes = await screen.findByRole('group', { name: 'Calendar view' });
    await userEvent.click(within(modes).getByRole('button', { name: 'Days' }));
    const dial = screen.getByRole('slider', { name: 'Days shown' });
    const columns = () =>
      screen
        .getAllByRole('group', { name: /./ })
        .filter((each) => each.hasAttribute('data-cal-slots')).length;
    // The button sits at 0,0 here, so the open dial is kept on screen with its middle at 132,132:
    // 1 is down and left of the middle, 14 down and right.
    const touch = { pointerType: 'touch', pointerId: 7 };
    fireEvent.pointerDown(dial, { clientX: 0, clientY: 0, button: 0, ...touch });
    expect(dial).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerMove(window, { clientX: 66, clientY: 198, ...touch });
    expect(dial).toHaveAttribute('aria-valuenow', '1');
    expect(columns()).toBe(1);
    fireEvent.pointerMove(window, { clientX: 198, clientY: 198, ...touch });
    expect(columns()).toBe(14);
    fireEvent.pointerUp(window, { clientX: 198, clientY: 198, ...touch });
    expect(dial).toHaveAttribute('aria-expanded', 'false');
    expect(dial).toHaveAttribute('aria-valuenow', '14');
    expect(JSON.parse(localStorage.getItem('punchlist.calendar')!)).toMatchObject({ days: 14 });

    // A tap leaves it open to tap a number.
    fireEvent.pointerDown(dial, { clientX: 0, clientY: 0, button: 0, ...touch });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0, ...touch });
    expect(dial).toHaveAttribute('aria-expanded', 'true');
    const dialog = document.querySelector('[data-number-dial]')!;
    fireEvent.pointerDown(dialog, { clientX: 66, clientY: 198, button: 0, ...touch, pointerId: 8 });
    fireEvent.pointerUp(window, { clientX: 66, clientY: 198, ...touch, pointerId: 8 });
    expect(dial).toHaveAttribute('aria-valuenow', '1');
    expect(dial).toHaveAttribute('aria-expanded', 'false');
  });

  it('takes the old Week and Day choices over as Days', async () => {
    localStorage.setItem('punchlist.calendar.mode', 'week');
    await calendarWith();
    expect(await screen.findByRole('slider', { name: 'Days shown' })).toHaveAttribute(
      'aria-valuenow',
      '7',
    );
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
    // The day it would land on is outlined while it is over it (R-FB-78).
    expect(tomorrow).toHaveAttribute('data-cal-drop');
    expect(month.querySelectorAll('[data-cal-drop]')).toHaveLength(1);
    fireEvent.pointerUp(window, { clientX: 60, clientY: 10, pointerId: 1 });
    expect(month.querySelectorAll('[data-cal-drop]')).toHaveLength(0);
    fireEvent.click(line);
    expect(task(dentist).schedule).toMatchObject({ start: addDays(today, 1), allDay: true });
    expect(screen.queryByRole('textbox', { name: /title/i })).toBeNull();
  });

  it('scrolls on a swipe across a task, and moves it once a finger holds it (R-FB-99)', async () => {
    const { today, task, dentist } = await calendarWith();
    const month = await screen.findByRole('grid', { name: 'Month' });
    const line = () =>
      within(within(month).getByRole('gridcell', { name: 'Today' })).getByRole('button', {
        name: 'Dentist',
      });
    const later = month.querySelector(`[data-cal-day="${addDays(today, 2)}"]`);
    const touch = { pointerType: 'touch', pointerId: 5 };
    // A swipe straight away: the calendar scrolls, the task stays.
    fireEvent.pointerDown(line(), { clientX: 10, clientY: 10, button: 0, ...touch });
    pointAt(later);
    fireEvent.pointerMove(window, { clientX: 90, clientY: 12, ...touch });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 12, ...touch });
    expect(task(dentist).schedule).toMatchObject({ start: today });
    // Held a moment first: it is picked up and moves.
    fireEvent.pointerDown(line(), { clientX: 10, clientY: 10, button: 0, ...touch });
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
    fireEvent.pointerMove(window, { clientX: 90, clientY: 12, ...touch });
    fireEvent.pointerUp(window, { clientX: 90, clientY: 12, ...touch });
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

  it('shows the times a task would get while it is stretched or dragged', async () => {
    localStorage.setItem(
      'punchlist.calendar',
      JSON.stringify({ mode: 'days', days: 1, hourHeight: 48 }),
    );
    const { today } = await calendarWith();
    // The times shown while stretching or dragging (the Undo after a change is a status too).
    const times = () =>
      screen
        .queryAllByRole('status')
        .map((each) => each.textContent ?? '')
        .find((text) => /\d:\d\d/.test(text)) ?? null;
    const block = await screen.findByRole('button', { name: /Standup/ });
    // Stretching the bottom edge: the label follows before letting go.
    const bottom = block.querySelector('[data-cal-grip="bottom"]')!;
    fireEvent.pointerDown(bottom, { clientX: 10, clientY: 10 * 48, button: 0, pointerId: 11 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10.5 * 48, pointerId: 11 });
    expect(times()).toMatch(/9:00\sAM - 10:30\sAM/);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10.5 * 48, pointerId: 11 });
    expect(times()).toBeNull();

    // Dragging it over 2 PM: an outline there at its own length, with its times.
    const moved = await screen.findByRole('button', { name: /Standup/ });
    const column = document.querySelector(`[data-cal-slots="${today}"]`)!;
    fireEvent.pointerDown(moved, {
      clientX: 10,
      clientY: 9 * 48 + 10,
      button: 0,
      pointerType: 'mouse',
      pointerId: 12,
    });
    pointAt(column);
    fireEvent.pointerMove(window, { clientX: 10, clientY: 14 * 48 + 12, pointerId: 12 });
    expect(document.querySelector('[data-cal-preview]')).not.toBeNull();
    expect(times()).toMatch(/2:00\sPM - 3:30\sPM/);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 14 * 48 + 12, pointerId: 12 });
    expect(document.querySelector('[data-cal-preview]')).toBeNull();
  });

  it('opens big time grips on a long hold, for tasks too short to grab by the edge', async () => {
    localStorage.setItem(
      'punchlist.calendar',
      JSON.stringify({ mode: 'days', days: 1, hourHeight: 48 }),
    );
    const { today, task, standup } = await calendarWith();
    const block = await screen.findByRole('button', { name: /Standup/ });
    vi.useFakeTimers();
    try {
      fireEvent.pointerDown(block, {
        clientX: 10,
        clientY: 9 * 48 + 10,
        button: 0,
        pointerType: 'touch',
        pointerId: 8,
      });
      act(() => vi.advanceTimersByTime(500));
      fireEvent.pointerUp(window, {
        clientX: 10,
        clientY: 9 * 48 + 10,
        pointerType: 'touch',
        pointerId: 8,
      });
      fireEvent.click(block);
    } finally {
      vi.useRealTimers();
    }
    // The hold did not open the task; the grips are out.
    expect(screen.queryByRole('textbox', { name: /title/i })).toBeNull();
    const top = document.querySelector('[data-cal-big-grip="top"]')!;
    expect(document.querySelector('[data-cal-big-grip="bottom"]')).not.toBeNull();
    fireEvent.pointerDown(top, { clientX: 10, clientY: 9 * 48, button: 0, pointerId: 9 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 8.5 * 48, pointerId: 9 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 8.5 * 48, pointerId: 9 });
    expect(task(standup).schedule).toMatchObject({
      start: `${today}T08:30`,
      end: `${today}T10:00`,
    });
    // A tap on empty time puts the grips away (and adds nothing).
    const column = document.querySelector(`[data-cal-slots="${today}"]`)!;
    fireEvent.pointerDown(column, { clientX: 10, clientY: 15 * 48, button: 0 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 15 * 48 });
    expect(document.querySelector('[data-cal-big-grip]')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
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
    expect(screen.getByRole('slider', { name: 'Days shown' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
  });
});
