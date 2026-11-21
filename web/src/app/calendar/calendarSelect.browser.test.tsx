// Picking in Days on a phone, with real layout (PL-093): the bulk bar takes the bottom tabs' place
// while a held task shows its time grips. It must not move the calendar or cover the held task.
import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createUlidGenerator } from '../../adapters/ulid-ids.ts';
import { renderApp } from '../../test/renderApp.tsx';
import { createWorkspaceStore } from '../store/workspaceStore.ts';

beforeEach(() => {
  localStorage.clear();
});

const rect = (element: Element) => element.getBoundingClientRect();

// The schema validator's generated code does not load in browser mode yet, and this is a layout
// test: a store that takes every document.
const layoutStore = () =>
  createWorkspaceStore({
    storage: createMemoryStorage(),
    validator: { validate: () => ({ valid: true, errors: [] }) },
    ids: createUlidGenerator(),
    node: 'test',
  });

describe('picking in Days on a phone', () => {
  it.each([360, 375])(
    'at %i px the bar neither moves the calendar nor covers the held task',
    async (width) => {
      document.body.style.width = `${width}px`;
      localStorage.setItem(
        'pecklist.calendar',
        JSON.stringify({ mode: 'days', days: 1, hourHeight: 48 }),
      );
      const store = layoutStore();
      await store.getState().init();
      const zone = localTimeZone();
      const today = todayIn(zone, Date.now());
      store.getState().apply(
        (ctx, ws) =>
          createTask(ctx, ws, {
            title: 'Late call',
            listId: inboxList(ws).id,
            schedule: {
              start: `${today}T22:00`,
              end: `${today}T23:00`,
              allDay: false,
              timeZone: zone,
            },
          }).workspace,
      );
      await store.getState().flush();
      await renderApp('/calendar', store);
      const block = await screen.findByRole('button', { name: /Late call/ });
      // The task as low on the screen as the grid lets it go: the hardest place for the bar.
      block.scrollIntoView({ block: 'end' });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      // The calendar's frame: the bordered box around the view, not the grid that scrolls in it.
      let calendar: Element = document.querySelector('[data-cal-slots]')!;
      while (getComputedStyle(calendar).borderTopStyle !== 'solid') {
        calendar = calendar.parentElement!;
      }
      const before = rect(calendar);

      const touch = { pointerType: 'touch', pointerId: 31, isPrimary: true };
      const at = rect(block);
      const point = { clientX: at.left + 4, clientY: at.top + 4 };
      fireEvent.pointerDown(block, { ...point, button: 0, ...touch });
      await act(() => new Promise((resolve) => setTimeout(resolve, 450)));
      fireEvent.pointerUp(window, { ...point, ...touch });
      const bar = await screen.findByRole('toolbar', { name: 'Picked tasks' });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

      const held = await screen.findByRole('button', { name: /Late call/ });
      expect(held).toHaveAttribute('aria-pressed', 'true');
      // Nothing in sight moved: the calendar starts where it did, and keeps the same gap above the
      // bar as it had above the tabs (52 px), where it used to run on under the taller bar.
      const after = rect(calendar);
      expect(after.top).toBe(before.top);
      const tabsTop = window.innerHeight - 52;
      expect(Math.abs(rect(bar).top - after.bottom - (tabsTop - before.bottom))).toBeLessThan(1);
      // The held task and its big grips are in sight, above the bar.
      const grips = [...document.querySelectorAll('[data-cal-big-grip]')].map(rect);
      expect(grips.length).toBeGreaterThan(0);
      const lowest = Math.max(rect(held).bottom, ...grips.map((each) => each.bottom));
      expect(lowest).toBeLessThanOrEqual(rect(bar).top);
      document.body.style.width = '';
    },
  );

  it('in Month, picking leaves every week row where it was', async () => {
    document.body.style.width = '360px';
    localStorage.setItem('pecklist.calendar', JSON.stringify({ mode: 'month' }));
    const store = layoutStore();
    await store.getState().init();
    const zone = localTimeZone();
    const today = todayIn(zone, Date.now());
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title: 'Dentist',
          listId: inboxList(ws).id,
          schedule: { start: today, end: null, allDay: true, timeZone: zone },
        }).workspace,
    );
    await store.getState().flush();
    await renderApp('/calendar', store);
    const line = await screen.findByRole('button', { name: 'Dentist' });
    const rows = () =>
      [...document.querySelectorAll('[data-cal-day]')].slice(0, 42).map((day) => rect(day).top);
    const before = rows();
    fireEvent.click(line, { shiftKey: true });
    await screen.findByRole('toolbar', { name: 'Picked tasks' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(rows()).toEqual(before);
    document.body.style.width = '';
  });
});
