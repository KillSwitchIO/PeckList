import { localTimeZone } from '../../core/dates.ts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { paletteOverrides } from '../../core/paletteSettings.ts';
import { COLOR_FAMILIES } from '../../core/palette.ts';
import { themeSwatches } from '../../core/themeColors.ts';
import { createTask, deleteTask } from '../../core/tasks.ts';
import { updateSettings } from '../../core/settings.ts';
import { createList } from '../../core/lists.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

describe('settings: colors', () => {
  it('changes a color live, warns when it is too pale, and resets', async () => {
    const store = testStore();
    await renderApp('/settings/appearance', store);
    const colors = await screen.findByRole('region', { name: 'Colors' });
    expect(within(colors).getByRole('button', { name: 'Reset colors' })).toBeDisabled();

    await userEvent.click(
      within(colors).getByRole('button', { name: /^Change High priority, now #D9776B/ }),
    );
    const picker = await screen.findByRole('dialog', { name: 'High priority' });
    // The picker opens on your theme's colors; the families are a tap away.
    expect(within(picker).getByRole('button', { name: /your theme/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(picker).getByRole('button', { name: 'Pastel' }));
    await userEvent.click(within(picker).getByRole('radio', { name: 'Pastel yellow' }));
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const overrides = () => paletteOverrides(store.getState().workspace!);
    expect(overrides()).toEqual({ priorityHigh: '#F3E1A0' });
    const row = within(colors).getByRole('button', { name: /^Change High priority/ });
    expect(row).toHaveTextContent('#F3E1A0');
    expect(row).toHaveTextContent('Very pale');

    await userEvent.click(within(colors).getByRole('button', { name: 'Reset colors' }));
    expect(overrides()).toEqual({});
    expect(within(colors).getByRole('button', { name: /^Change High priority/ })).toHaveTextContent(
      'Default',
    );
  });

  it('the theme saves to the workspace', async () => {
    const store = testStore();
    await renderApp('/settings/appearance', store);
    const theme = await screen.findByRole('group', { name: 'Theme' });
    await userEvent.click(within(theme).getByRole('button', { name: 'Dark' }));
    expect(store.getState().workspace!.entities.settings[0]!.themeMode).toBe('dark');
    expect(localStorage.getItem('pecklist.themeMode')).toBe('dark');
  });

  it('dates settings save to the workspace', async () => {
    const store = testStore();
    await renderApp('/settings/dates', store);
    const settings = () => store.getState().workspace!.entities.settings[0]!;
    await userEvent.click(await screen.findByRole('combobox', { name: 'Due soon' }));
    await userEvent.click(await screen.findByRole('option', { name: '5 days before' }));
    expect(settings().dueSoonDays).toBe(5);
    await userEvent.click(screen.getByRole('combobox', { name: 'Calendar length' }));
    await userEvent.click(await screen.findByRole('option', { name: '1 hour' }));
    expect(settings().pointEventMinutes).toBe(60);
  });

  it('the clean-up time offers days and months up to a year, 30 days to start', async () => {
    const store = testStore();
    await renderApp('/settings/data', store);
    const settings = () => store.getState().workspace!.entities.settings[0]!;
    const menu = await screen.findByRole('combobox', { name: 'Clean up after' });
    expect(menu).toHaveTextContent('30 days');
    await userEvent.click(menu);
    const names = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(names).toEqual([
      '7 days',
      '15 days',
      '30 days',
      '2 months',
      '3 months',
      '4 months',
      '5 months',
      '6 months',
      '7 months',
      '8 months',
      '9 months',
      '10 months',
      '11 months',
      '1 year',
    ]);
    await userEvent.click(screen.getByRole('option', { name: '6 months' }));
    expect(settings().purgeAfterDays).toBe(180);
  });

  it('the Trash says how long it keeps things', async () => {
    const store = testStore();
    await store.getState().init();
    store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { purgeAfterDays: 15 }));
    await store.getState().flush();
    await renderApp('/trash', store);
    expect(await screen.findByText('Deleted tasks stay here for 15 days.')).toBeInTheDocument();
  });

  it('asks before a shorter clean-up time erases what is in the Trash', async () => {
    const store = testStore();
    await store.getState().init();
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, { title: 'Old trash', listId: inboxList(ws).id });
      const gone = deleteTask(ctx, made.workspace, made.task.id);
      return {
        ...gone,
        entities: {
          ...gone.entities,
          tasks: gone.entities.tasks.map((task) =>
            task.id === made.task.id
              ? { ...task, deletedAt: new Date(Date.now() - 10 * 86_400_000).toISOString() }
              : task,
          ),
        },
      };
    });
    await store.getState().flush();
    await renderApp('/settings/data', store);
    const settings = () => store.getState().workspace!.entities.settings[0]!;
    await userEvent.click(await screen.findByRole('combobox', { name: 'Clean up after' }));
    await userEvent.click(await screen.findByRole('option', { name: '7 days' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Tasks in the Trash older than 7 days will be erased for good (1)',
    );
    expect(settings().purgeAfterDays).toBeUndefined();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(settings().purgeAfterDays).toBeUndefined();

    await userEvent.click(screen.getByRole('combobox', { name: 'Clean up after' }));
    await userEvent.click(await screen.findByRole('option', { name: '7 days' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Erase and shorten' }));
    expect(settings().purgeAfterDays).toBe(7);
  });

  it('24-hour clock and Monday weeks show everywhere at once', async () => {
    const store = testStore();
    await store.getState().init();
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title: 'Standup',
          listId: inboxList(ws).id,
          schedule: {
            start: '2030-01-07T14:30',
            end: null,
            allDay: false,
            timeZone: localTimeZone(),
          },
        }).workspace,
    );
    await store.getState().flush();
    await renderApp('/settings/dates', store);
    const clock = await screen.findByRole('group', { name: 'Clock' });
    await userEvent.click(within(clock).getByRole('button', { name: '13:00' }));
    expect(store.getState().workspace!.entities.settings[0]!.clockFormat).toBe('24h');
    const week = screen.getByRole('group', { name: 'Week starts on' });
    await userEvent.click(within(week).getByRole('button', { name: 'Monday' }));
    expect(store.getState().workspace!.entities.settings[0]!.weekStart).toBe(1);

    await userEvent.click(within(screen.getAllByRole('navigation')[0]!).getByText('All'));
    expect(await screen.findByText(/14:30/)).toBeInTheDocument();
    expect(screen.queryByText(/2:30 PM/)).toBeNull();

    // The date picker's month starts on Monday.
    await userEvent.click(screen.getByTestId('task-date'));
    const picker = await screen.findByRole('dialog');
    const days = within(within(picker).getAllByRole('grid')[0]!).getAllByRole('gridcell');
    expect(days[0]).toHaveAccessibleName(/^Monday/);
  });
});

describe('settings: date format', () => {
  it('shows dates in a preset or a typed pattern, keeping Today and Tomorrow', async () => {
    const store = testStore();
    await store.getState().init();
    store.getState().apply(
      (ctx, ws) =>
        createTask(ctx, ws, {
          title: 'Dentist',
          listId: inboxList(ws).id,
          schedule: { start: '2030-01-07', end: null, allDay: true, timeZone: localTimeZone() },
        }).workspace,
    );
    await store.getState().flush();
    await renderApp('/settings/dates', store);
    await userEvent.click(await screen.findByRole('combobox', { name: 'Date format' }));
    await userEvent.click(await screen.findByRole('option', { name: /\(YYYY-MM-DD\)$/ }));
    expect(store.getState().workspace!.entities.settings[0]!.dateFormat).toBe('YYYY-MM-DD');

    await userEvent.click(screen.getByRole('combobox', { name: 'Date format' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Custom...' }));
    const pattern = screen.getByRole('textbox', { name: 'Date pattern' });
    await userEvent.clear(pattern);
    expect(screen.getByText('Use at least one of the parts below')).toBeInTheDocument();
    await userEvent.type(pattern, 'YYYYMMdd');
    expect(store.getState().workspace!.entities.settings[0]!.dateFormat).toBe('YYYYMMdd');

    await userEvent.click(within(screen.getAllByRole('navigation')[0]!).getByText('All'));
    expect(await screen.findByText('20300107')).toBeInTheDocument();
  });
});

describe('settings: your data', () => {
  it('downloads everything as JSON and imports a file, adding what is new', async () => {
    const store = testStore();
    await renderApp('/settings/data', store);
    const data = await screen.findByRole('region', { name: 'Your data' });

    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return 'blob:pecklist';
      },
      revokeObjectURL: () => undefined,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await userEvent.click(within(data).getByRole('button', { name: 'Download a copy' }));
    expect(click).toHaveBeenCalled();
    const exported = JSON.parse(await blobs[0]!.text()) as {
      owner: string;
      entities: { tasks: { title: string }[] };
    };
    expect(exported.owner).toBe(store.getState().workspace!.owner);

    // The same file with one more task: only that one is new.
    const state = store.getState();
    const withExtra = createTask(state.context(), state.workspace!, {
      title: 'From the file',
      listId: inboxList(state.workspace!)!.id,
    }).workspace;
    const file = new File([JSON.stringify(withExtra)], 'pecklist.json', {
      type: 'application/json',
    });
    await userEvent.upload(
      within(data).getByLabelText('Import a file', { selector: 'input' }),
      file,
    );
    expect(
      await within(data).findByText('Imported: 1 new tasks, 0 new lists and 0 new tags.'),
    ).toBeInTheDocument();
    expect(store.getState().workspace!.entities.tasks.map((task) => task.title)).toContain(
      'From the file',
    );

    await userEvent.upload(
      within(data).getByLabelText('Import a file', { selector: 'input' }),
      new File(['not json'], 'notes.txt', { type: 'application/json' }),
    );
    expect(await within(data).findByText(/is not a PeckList export/)).toBeInTheDocument();
  });
});

describe('settings: time zone', () => {
  it('follows the device until a zone is picked, then works in that one', async () => {
    const store = testStore();
    await renderApp('/settings/dates', store);
    const zone = await screen.findByRole('combobox', { name: 'Time zone' });
    expect(zone).toHaveValue(`This device's (${localTimeZone().replaceAll('_', ' ')})`);

    await userEvent.clear(zone);
    await userEvent.type(zone, 'Pacific/Kiri');
    await userEvent.click(await screen.findByRole('option', { name: 'Pacific/Kiritimati' }));
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.timeZone).toBe('Pacific/Kiritimati'),
    );
    expect(localTimeZone()).toBe('Pacific/Kiritimati');

    // Back to the default: the setting clears and the device's zone returns.
    await userEvent.clear(screen.getByRole('combobox', { name: 'Time zone' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Time zone' }), 'This device');
    await userEvent.click(await screen.findByRole('option', { name: /^This device's/ }));
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.timeZone).toBeNull(),
    );
    expect(localTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});

describe('new task defaults', () => {
  it('fill what the place leaves open: the list and date outside a list, priority everywhere', async () => {
    const store = testStore();
    await renderApp('/settings/tasks', store);
    let garden = '';
    store.getState().apply((ctx, ws) => {
      const made = createList(ctx, ws, { name: 'Garden', color: '#CFE3A3' });
      garden = made.list.id;
      return made.workspace;
    });
    const section = await screen.findByRole('region', { name: 'New tasks' });
    const pick = async (label: string, option: string) => {
      await userEvent.click(within(section).getByRole('combobox', { name: label }));
      await userEvent.click(await screen.findByRole('option', { name: option }));
    };
    await pick('List', 'Garden');
    await pick('Priority', 'High');
    await pick('Date', 'Tomorrow');

    const tasks = () => store.getState().workspace!.entities.tasks;
    const typeInto = async (title: string) => {
      const field = screen.getByRole('textbox', { name: /^Add task/ });
      await userEvent.type(field, `${title}{Enter}`);
    };

    // All: no list, no date of its own.
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await typeInto('Rake');
    // Today: its date wins, the default list and priority still apply.
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await typeInto('Water');
    // The Mess Drawer's own page keeps its list.
    await userEvent.click(screen.getByRole('button', { name: 'Mess Drawer' }));
    await typeInto('Call vet');

    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', {
      timeZone: localTimeZone(),
    });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: localTimeZone() });
    const byTitle = (title: string) => tasks().find((task) => task.title === title)!;
    expect(byTitle('Rake')).toMatchObject({ listId: garden, priority: 3 });
    expect(byTitle('Rake').schedule?.start).toBe(tomorrow);
    expect(byTitle('Water')).toMatchObject({ listId: garden, priority: 3 });
    expect(byTitle('Water').schedule?.start).toBe(today);
    const inbox = inboxList(store.getState().workspace!).id;
    expect(byTitle('Call vet')).toMatchObject({ listId: inbox, priority: 3 });
  });
});

describe('the new-task reminder', () => {
  it('is picked in the list a new all-day task shows, at the all-day time (R-FB-92)', async () => {
    const store = testStore();
    await renderApp('/settings/tasks', store);
    store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { allDayReminderTime: '07:30' }));
    const section = await screen.findByRole('region', { name: 'New tasks' });
    await userEvent.click(within(section).getByRole('button', { name: 'Reminder: None' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reminder' });
    expect(sheet).toHaveTextContent(/Every new task gets these once it has a date/);
    // The all-day list, each at the person's all-day time, as on a task.
    const onTheDay = within(sheet).getByRole('menuitemcheckbox', { name: /^On the day/ });
    expect(onTheDay).toHaveTextContent(/7:30 AM/);
    await userEvent.click(onTheDay);
    await userEvent.click(within(sheet).getByRole('menuitemcheckbox', { name: /^1 day early/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'OK' }));
    // Counted from the all-day time: a new all-day task turns them into its own (newTaskDefaults).
    expect(store.getState().workspace!.entities.settings[0]!.newTask?.reminders).toEqual([
      { before: 0 },
      { before: 1440 },
    ]);
    expect(
      within(section).getByRole('button', {
        name: 'Reminder: On the day (7:30 AM), 1 day early (7:30 AM)',
      }),
    ).toBeInTheDocument();
  });
});

describe('times in Settings', () => {
  it('are set with the wheels and shown on the clock the person uses (R-FB-97)', async () => {
    const store = testStore();
    await renderApp('/settings/dates', store);
    const section = await screen.findByRole('region', { name: 'Dates' });
    await userEvent.click(
      within(section).getByRole('button', { name: 'All-day reminder time: 9:00 AM' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'All-day reminder time' });
    const wheel = (name: string) => within(within(sheet).getByRole('listbox', { name }));
    await userEvent.click(wheel('Hour').getByRole('option', { name: '7' }));
    await userEvent.click(wheel('Minute').getByRole('option', { name: '30' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(store.getState().workspace!.entities.settings[0]!.allDayReminderTime).toBe('07:30');
    // On a 24-hour clock it reads that way too.
    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { clockFormat: '24h' })));
    expect(
      await within(section).findByRole('button', { name: 'All-day reminder time: 07:30' }),
    ).toBeInTheDocument();
  });
});

describe('palette presets', () => {
  it('picks a palette and shows its colors as the starting point', async () => {
    const store = testStore();
    await renderApp('/settings/appearance', store);
    const palettes = await screen.findByRole('radiogroup', { name: 'Palettes' });
    expect(within(palettes).getByRole('radio', { name: 'PeckList Forest' })).toBeChecked();
    // The default leads; the first default keeps a place near the top under its new name.
    const radios = within(palettes).getAllByRole('radio');
    ['PeckList Forest', 'Ocean', 'Sea glass'].forEach((name, index) =>
      expect(radios[index]).toBe(within(palettes).getByRole('radio', { name })),
    );
    await userEvent.click(within(palettes).getByRole('radio', { name: 'Ocean' }));
    expect(within(palettes).getByRole('radio', { name: 'Ocean' })).toBeChecked();
    expect(store.getState().workspace!.entities.settings[0]!.palettePreset).toBe('ocean');
    // The accent row shows the palette's color as its own (no change yet).
    expect(screen.getByRole('button', { name: 'Change Accent, now #3A7CA5' })).toBeInTheDocument();
  });
});

describe('theme mode', () => {
  it('switches the whole page at once, not only the components', async () => {
    await renderApp('/settings/appearance');
    const page = () => getComputedStyle(document.body).backgroundColor;
    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    const light = page();
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    await waitFor(() => expect(page()).not.toBe(light));
    expect(page()).toBe('rgb(27, 29, 31)');
    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    await waitFor(() => expect(page()).toBe(light));
  });
});

describe('settings: swipe actions', () => {
  it('reorders, removes and adds buttons, sets the full swipe, shows it on a sample, and resets', async () => {
    await renderApp('/settings/tasks');
    const section = await screen.findByRole('region', { name: 'Swipe actions' });
    const left = within(section).getByRole('region', { name: 'Swipe left' });
    expect(within(left).getByRole('img')).toHaveAccessibleName(
      'Swipe left shows: Date, Move, Delete',
    );
    await userEvent.click(within(left).getByRole('button', { name: 'Move Delete left' }));
    await userEvent.click(within(left).getByRole('button', { name: 'Remove Date' }));
    await userEvent.click(within(left).getByRole('button', { name: 'Add a button' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }));
    expect(within(left).getByRole('img')).toHaveAccessibleName(
      'Swipe left shows: Delete, Move, Pin',
    );
    // Three is the most: no more adding.
    expect(within(left).queryByRole('button', { name: 'Add a button' })).toBeNull();

    const right = within(section).getByRole('region', { name: 'Swipe right' });
    await userEvent.click(within(right).getByRole('combobox', { name: 'Full swipe right' }));
    await userEvent.click(await screen.findByRole('option', { name: "Won't do" }));
    expect(JSON.parse(localStorage.getItem('pecklist.swipes')!)).toEqual({
      right: { buttons: ['complete', 'pin'], full: 'wontDo' },
      left: { buttons: ['delete', 'move', 'pin'], full: 'date' },
    });
    await userEvent.click(within(section).getByRole('button', { name: 'Reset' }));
    expect(localStorage.getItem('pecklist.swipes')).toBeNull();
  });
});

describe('settings: changing the theme', () => {
  it('recolors lists and tags to the same spot in the new set, unless turned off', async () => {
    const store = testStore();
    await store.getState().init();
    let listId = '';
    store.getState().apply((ctx, ws) => {
      const made = createList(ctx, ws, { name: 'Work', color: COLOR_FAMILIES[0]!.colors[6]!.hex });
      listId = made.list.id;
      return made.workspace;
    });
    await store.getState().flush();
    await renderApp('/settings/appearance', store);
    const palettes = await screen.findByRole('radiogroup', { name: 'Palettes' });
    // On by default: the palette and the lists and tags change as one.
    expect(
      screen.getByRole('switch', { name: 'Recolor lists and tags with the palette' }),
    ).toBeChecked();
    await userEvent.click(within(palettes).getByRole('radio', { name: 'Berry' }));
    const color = () =>
      store.getState().workspace!.entities.lists.find((list) => list.id === listId)!.color;
    await waitFor(() => expect(color()).toBe(themeSwatches('berry')[6]));

    // Off: only the palette changes.
    await userEvent.click(
      screen.getByRole('switch', { name: 'Recolor lists and tags with the palette' }),
    );
    await userEvent.click(within(palettes).getByRole('radio', { name: 'Ocean' }));
    expect(color()).toBe(themeSwatches('berry')[6]);
  });
});

describe('settings by subject (PL-128)', () => {
  const SUBJECTS = ['Appearance', 'Date and time', 'Tasks', 'Your data'];

  it('on a wide screen opens the first subject beside the list, and each has an address', async () => {
    await renderApp('/settings');
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    for (const name of SUBJECTS) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Appearance' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByRole('group', { name: 'Theme' })).toBeInTheDocument();

    await userEvent.click(within(nav).getByRole('link', { name: 'Your data' }));
    expect(await screen.findByRole('button', { name: 'Download a copy' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Your data' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('on a phone is a list of subjects, each a page with a way back', async () => {
    mockViewport('phone');
    await renderApp('/settings');
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();

    await userEvent.click(within(nav).getByRole('link', { name: /^Date and time/ }));
    expect(await screen.findByRole('heading', { name: 'Date and time' })).toBeInTheDocument();
    expect(await screen.findByRole('combobox', { name: 'Due soon' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull();

    await userEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByRole('navigation', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Due soon' })).toBeNull();
  });

  it('leaves out Account and Notifications when there is no server', async () => {
    await renderApp('/settings');
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(nav).queryByRole('link', { name: 'Account' })).toBeNull();
    expect(within(nav).queryByRole('link', { name: 'Notifications' })).toBeNull();
  });

  it('every setting on the old page has a place in a subject', async () => {
    const found = async (route: string, names: [role: string, name: string | RegExp][]) => {
      const { unmount } = await renderApp(route);
      for (const [role, name] of names) {
        expect(await screen.findByRole(role, { name })).toBeInTheDocument();
      }
      unmount();
    };
    await found('/settings/appearance', [
      ['group', 'Theme'],
      ['region', 'Colors'],
    ]);
    await found('/settings/dates', [
      ['combobox', 'Time zone'],
      ['combobox', 'Date format'],
      ['group', 'Clock'],
      ['group', 'Week starts on'],
      ['combobox', 'Due soon'],
      ['combobox', 'Calendar length'],
      ['button', /^All-day reminder time/],
    ]);
    await found('/settings/tasks', [
      ['link', /Lists and tags/],
      ['switch', 'Show the Closed group'],
      ['region', 'New tasks'],
      ['region', 'Swipe actions'],
    ]);
    await found('/settings/data', [
      ['button', 'Download a copy'],
      ['button', 'Import a file'],
      ['button', 'Import from another app'],
      ['button', 'Export for another app'],
      ['button', 'Delete all lists, tasks and tags'],
    ]);
  });
});
