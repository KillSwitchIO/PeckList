import { localTimeZone } from '../../core/dates.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { paletteOverrides } from '../../core/paletteSettings.ts';
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
