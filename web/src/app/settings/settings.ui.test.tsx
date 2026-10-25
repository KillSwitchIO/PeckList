import { localTimeZone } from '../../core/dates.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { paletteOverrides } from '../../core/paletteSettings.ts';
import { COLOR_FAMILIES } from '../../core/palette.ts';
import { themeSwatches } from '../../core/themeColors.ts';
import { createTask } from '../../core/tasks.ts';
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
    await renderApp('/settings', store);
    const colors = await screen.findByRole('region', { name: 'Colors' });
    expect(within(colors).getByRole('button', { name: 'Reset colors' })).toBeDisabled();

    await userEvent.click(
      within(colors).getByRole('button', { name: /^Change High priority, now #E8837E/ }),
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

  it('theme and dates settings save to the workspace', async () => {
    const store = testStore();
    await renderApp('/settings', store);
    const settings = () => store.getState().workspace!.entities.settings[0]!;
    const theme = await screen.findByRole('group', { name: 'Theme' });
    await userEvent.click(within(theme).getByRole('button', { name: 'Dark' }));
    expect(settings().themeMode).toBe('dark');
    expect(localStorage.getItem('punchlist.themeMode')).toBe('dark');

    await userEvent.click(screen.getByRole('combobox', { name: 'Due soon' }));
    await userEvent.click(await screen.findByRole('option', { name: '5 days before' }));
    expect(settings().dueSoonDays).toBe(5);
    await userEvent.click(screen.getByRole('combobox', { name: 'Calendar length' }));
    await userEvent.click(await screen.findByRole('option', { name: '1 hour' }));
    expect(settings().pointEventMinutes).toBe(60);
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
    await renderApp('/settings', store);
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
    await renderApp('/settings', store);
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
    await renderApp('/settings', store);
    const data = await screen.findByRole('region', { name: 'Your data' });

    const blobs: Blob[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        blobs.push(blob);
        return 'blob:punchlist';
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
    const file = new File([JSON.stringify(withExtra)], 'punchlist.json', {
      type: 'application/json',
    });
    await userEvent.upload(within(data).getByLabelText('Import a file'), file);
    expect(
      await within(data).findByText('Imported: 1 new tasks, 0 new lists and 0 new tags.'),
    ).toBeInTheDocument();
    expect(store.getState().workspace!.entities.tasks.map((task) => task.title)).toContain(
      'From the file',
    );

    await userEvent.upload(
      within(data).getByLabelText('Import a file'),
      new File(['not json'], 'notes.txt', { type: 'application/json' }),
    );
    expect(await within(data).findByText(/is not a Punchlist export/)).toBeInTheDocument();
  });
});

describe('settings: time zone', () => {
  it('follows the device until a zone is picked, then works in that one', async () => {
    const store = testStore();
    await renderApp('/settings', store);
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
    await renderApp('/settings', store);
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

describe('palette presets', () => {
  it('picks a palette and shows its colors as the starting point', async () => {
    const store = testStore();
    await renderApp('/settings', store);
    const palettes = await screen.findByRole('radiogroup', { name: 'Palettes' });
    expect(within(palettes).getByRole('radio', { name: 'Punchlist' })).toBeChecked();
    await userEvent.click(within(palettes).getByRole('radio', { name: 'Ocean' }));
    expect(within(palettes).getByRole('radio', { name: 'Ocean' })).toBeChecked();
    expect(store.getState().workspace!.entities.settings[0]!.palettePreset).toBe('ocean');
    // The accent row shows the palette's color as its own (no change yet).
    expect(screen.getByRole('button', { name: 'Change Accent, now #3A7CA5' })).toBeInTheDocument();
  });
});

describe('theme mode', () => {
  it('switches the whole page at once, not only the components', async () => {
    await renderApp('/settings');
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
    await renderApp('/settings');
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
    expect(JSON.parse(localStorage.getItem('punchlist.swipes')!)).toEqual({
      right: { buttons: [], full: 'wontDo' },
      left: { buttons: ['delete', 'move', 'pin'], full: 'date' },
    });
    await userEvent.click(within(section).getByRole('button', { name: 'Reset' }));
    expect(localStorage.getItem('punchlist.swipes')).toBeNull();
  });
});

describe('settings: changing the theme', () => {
  it('asks to recolor lists and tags, and moves them to the same spot in the new set', async () => {
    const store = testStore();
    await store.getState().init();
    let listId = '';
    store.getState().apply((ctx, ws) => {
      const made = createList(ctx, ws, { name: 'Work', color: COLOR_FAMILIES[0]!.colors[6]!.hex });
      listId = made.list.id;
      return made.workspace;
    });
    await store.getState().flush();
    await renderApp('/settings', store);
    const palettes = await screen.findByRole('radiogroup', { name: 'Palettes' });
    await userEvent.click(within(palettes).getByRole('radio', { name: 'Berry' }));
    const ask = await screen.findByRole('dialog', { name: 'Recolor lists and tags too?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Recolor' }));
    const color = () =>
      store.getState().workspace!.entities.lists.find((list) => list.id === listId)!.color;
    await waitFor(() => expect(color()).toBe(themeSwatches('berry')[6]));
  });
});
