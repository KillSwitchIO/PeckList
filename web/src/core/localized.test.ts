import { describe, expect, it } from 'vitest';
import { shiftZone } from './dates.ts';
import { localized, localizedWorkspace } from './localized.ts';
import type { Task, WorkspaceFile } from './types.ts';

const task = (fields: Partial<Task>): Task =>
  ({ id: 'T1', schedule: null, due: null, ...fields }) as Task;

describe('time zones', () => {
  it('moves a timed moment to another wall clock and leaves dates alone', () => {
    expect(shiftZone('2026-10-22T09:00', 'America/New_York', 'Europe/Berlin')).toBe(
      '2026-10-22T15:00',
    );
    // Late evening in New York is the next day in Tokyo.
    expect(shiftZone('2026-10-22T22:30', 'America/New_York', 'Asia/Tokyo')).toBe(
      '2026-10-23T11:30',
    );
    expect(shiftZone('2026-10-22', 'America/New_York', 'Asia/Tokyo')).toBe('2026-10-22');
    expect(shiftZone('2026-10-22T09:00', 'Europe/Berlin', 'Europe/Berlin')).toBe(
      '2026-10-22T09:00',
    );
  });

  it("shows a timed task on the viewer's clock, all-day ones as they are", () => {
    const timed = task({
      schedule: {
        start: '2026-10-22T22:30',
        end: '2026-10-22T23:30',
        allDay: false,
        timeZone: 'America/New_York',
      },
      due: { at: '2026-10-23T09:00', allDay: false, timeZone: 'America/New_York' },
    });
    const shown = localized(timed, 'Asia/Tokyo');
    expect(shown.schedule).toEqual({
      start: '2026-10-23T11:30',
      end: '2026-10-23T12:30',
      allDay: false,
      timeZone: 'Asia/Tokyo',
    });
    expect(shown.due).toEqual({ at: '2026-10-23T22:00', allDay: false, timeZone: 'Asia/Tokyo' });

    const allDay = task({
      schedule: { start: '2026-10-22', end: null, allDay: true, timeZone: 'America/New_York' },
    });
    expect(localized(allDay, 'Asia/Tokyo')).toBe(allDay);
    const here = task({
      schedule: { start: '2026-10-22T09:00', end: null, allDay: false, timeZone: 'Asia/Tokyo' },
    });
    expect(localized(here, 'Asia/Tokyo')).toBe(here);
  });

  it('keeps the workspace object when nothing moves, and works each one out once', () => {
    const workspace = { entities: { tasks: [task({})] } } as unknown as WorkspaceFile;
    expect(localizedWorkspace(workspace, 'Asia/Tokyo')).toBe(workspace);
    const travelled = {
      entities: {
        tasks: [
          task({
            schedule: {
              start: '2026-10-22T22:30',
              end: null,
              allDay: false,
              timeZone: 'America/New_York',
            },
          }),
        ],
      },
    } as unknown as WorkspaceFile;
    const shown = localizedWorkspace(travelled, 'Asia/Tokyo');
    expect(shown).not.toBe(travelled);
    expect(shown.entities.tasks[0]!.schedule!.start).toBe('2026-10-23T11:30');
    expect(localizedWorkspace(travelled, 'Asia/Tokyo')).toBe(shown);
  });
});
