import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { createList, inboxList } from './lists.ts';
import { assignsSelf, defaultDate, withNewTaskDefaults } from './newTaskDefaults.ts';
import { updateSettings } from './settings.ts';
import type { NewTaskDefaults, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const TODAY = '2026-10-24';
const TZ = 'America/Chicago';

function setup(defaults?: (garden: string) => NewTaskDefaults) {
  const ctx = testContext();
  const made = createList(ctx, createWorkspace(ctx), { name: 'Garden', color: '#CFE3A3' });
  let ws: WorkspaceFile = made.workspace;
  if (defaults) ws = updateSettings(ctx, ws, { newTask: defaults(made.list.id) });
  return { ws, garden: made.list.id, inbox: inboxList(ws).id };
}

describe('new task defaults', () => {
  it('change nothing until set', () => {
    const { ws, inbox } = setup();
    const options = { today: TODAY, timeZone: TZ, inList: false };
    expect(withNewTaskDefaults(ws, { listId: inbox }, options)).toEqual({ listId: inbox });
    expect(assignsSelf(ws)).toBe(true);
  });

  it('fill the list, priority and date where the place says nothing', () => {
    const { ws, garden, inbox } = setup((garden) => ({
      listId: garden,
      priority: 3,
      date: 'tomorrow',
      time: '09:30',
      assignSelf: false,
    }));
    expect(
      withNewTaskDefaults(ws, { listId: inbox }, { today: TODAY, timeZone: TZ, inList: false }),
    ).toEqual({
      listId: garden,
      priority: 3,
      schedule: { start: '2026-10-25T09:30', end: null, allDay: false, timeZone: TZ },
    });
    expect(assignsSelf(ws)).toBe(false);
  });

  it("let the place win: a list page's list, Today's date", () => {
    const { ws, inbox } = setup((garden) => ({ listId: garden, date: 'nextWeek' }));
    const today = { start: TODAY, end: null, allDay: true, timeZone: TZ };
    expect(
      withNewTaskDefaults(
        ws,
        { listId: inbox, schedule: today },
        { today: TODAY, timeZone: TZ, inList: true },
      ),
    ).toEqual({ listId: inbox, schedule: today });
  });

  it('turn date choices into days', () => {
    expect(defaultDate('none', TODAY)).toBeNull();
    expect(defaultDate('today', TODAY)).toBe(TODAY);
    expect(defaultDate('tomorrow', TODAY)).toBe('2026-10-25');
    expect(defaultDate('nextWeek', TODAY)).toBe('2026-10-31');
  });
});
