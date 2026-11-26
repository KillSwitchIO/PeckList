import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { addDays, localTimeZone, todayIn } from '../../core/dates.ts';
import type { StorageAdapter } from '../../ports/storage.ts';
import { fakeEvent, fakeLink } from '../../test/fakeCalendars.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { AppProviders } from '../providers.tsx';
import { AppRoutes } from '../routes.tsx';
import { ViewAsContext } from '../store/viewAs.ts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const slow = { timeout: 10_000 };
const today = () => todayIn(localTimeZone(), Date.now());

function backendWithCalendars(on = true) {
  const backend = new FakeBackend();
  backend.addAccount('ben', 'correct horse battery');
  backend.calendarSync = on;
  return backend;
}

async function signedIn(
  backend: FakeBackend,
  path: string,
  storage: StorageAdapter = createMemoryStorage(),
  { offline = false } = {},
) {
  const store = testStore();
  const transport = backend.device();
  transport.session = 'ben';
  transport.offline = offline;
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage,
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  return renderApp(path, store, sync);
}

/** An account with one calendar, as connected earlier. */
function connected(backend: FakeBackend, link = fakeLink()) {
  backend.calendars.accounts = [
    {
      id: 'acc-1',
      provider: 'caldav',
      name: 'ben@example.com',
      serverUrl: 'https://caldav.fastmail.com/',
      username: 'ben@example.com',
      status: 'ok',
      problem: null,
      canCreateCalendar: true,
      calendars: [link],
    },
  ];
}

describe('Settings > Calendars (PL-134)', () => {
  it('is offered only when the server has calendar sync on', async () => {
    await signedIn(backendWithCalendars(false), '/settings');
    await screen.findByRole('link', { name: /Tasks/ }, slow);
    expect(screen.queryByRole('link', { name: /Calendars/ })).toBeNull();
  });

  it('connects a CalDAV account, says what went wrong in words, and never keeps the password', async () => {
    const backend = backendWithCalendars();
    backend.calendars.refuseConnect = 'calendar_auth_failed';
    await signedIn(backend, '/settings/calendars');
    await userEvent.click(await screen.findByRole('button', { name: 'Connect a calendar' }, slow));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Username'), 'ben@icloud.com');
    await userEvent.type(within(dialog).getByLabelText('App password'), 'abcd-efgh');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));

    expect(
      await within(dialog).findByText('The username or app password was refused.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('App password')).toHaveValue('');
    expect(within(dialog).getByLabelText('Username')).toHaveValue('ben@icloud.com');

    backend.calendars.refuseConnect = null;
    await userEvent.type(within(dialog).getByLabelText('App password'), 'abcd-efgh');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'iCloud' })).toBeInTheDocument();
    expect(backend.calendars.calls).toEqual([
      'connect https://caldav.icloud.com ben@icloud.com with-password',
      'connect https://caldav.icloud.com ben@icloud.com with-password',
    ]);
  });

  it('shows a calendar, then syncs it with a new tag and a list', async () => {
    const backend = backendWithCalendars();
    connected(backend);
    await signedIn(backend, '/settings/calendars');

    await userEvent.click(await screen.findByRole('button', { name: 'Home: Off' }, slow));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Show events/ }));
    expect(await screen.findByRole('button', { name: 'Home: Show events' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Home: Show events' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Sync with a tag/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Sync Home with a tag' });
    await userEvent.type(within(dialog).getByLabelText('New tag name'), 'Family');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sync' }));

    expect(await screen.findByRole('button', { name: 'Home: Sync: family' })).toBeInTheDocument();
    // The tag reached the server before the calendar was linked to it.
    const tagged = backend.calendars.calls.at(-1)!;
    expect(tagged).toMatch(/^mode link-home sync tag:\S+$/);
    const tagId = tagged.split('tag:')[1]!;
    expect(backend.server.rows.get(tagId)?.change.collection).toBe('tags');
    expect(backend.calendars.calls[0]).toBe('mode link-home show');
  });

  it('offers only Off and Show events for a read-only calendar', async () => {
    const backend = backendWithCalendars();
    connected(backend, fakeLink({ name: 'Holidays', readOnly: true }));
    await signedIn(backend, '/settings/calendars');

    await userEvent.click(await screen.findByRole('button', { name: 'Holidays: Off' }, slow));
    expect(await screen.findByRole('menuitem', { name: /Sync with a tag/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('This calendar is read-only')).toBeInTheDocument();
  });

  it('words a calendar problem, and asks to reconnect when the password stopped working', async () => {
    const backend = backendWithCalendars();
    connected(
      backend,
      fakeLink({ mode: 'show', problem: 'calendar_timed_out', nextAttempt: null }),
    );
    backend.calendars.accounts[0]!.status = 'auth_failed';
    await signedIn(backend, '/settings/calendars');

    expect(
      await screen.findByText(
        "The calendar service didn't answer. PeckList will try again.",
        {},
        slow,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    const dialog = await screen.findByRole('dialog');
    // The same service and username, a new password.
    expect(within(dialog).getByLabelText('Username')).toHaveValue('ben@example.com');
    expect(within(dialog).queryByLabelText('Server address')).toBeNull();
  });

  it('disconnects an account after asking', async () => {
    const backend = backendWithCalendars();
    connected(backend);
    await signedIn(backend, '/settings/calendars');

    await userEvent.click(await screen.findByRole('button', { name: 'Fastmail actions' }, slow));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }));
    expect(
      screen.getByText("Your tasks and the calendar's events both stay where they are."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.queryByText('Home')).toBeNull());
    expect(backend.calendars.calls).toEqual(['disconnect acc-1']);
  });

  it('offers Google only where the server can connect it, as a link to its sign-in', async () => {
    const backend = backendWithCalendars();
    backend.calendars.providers = ['caldav', 'google'];
    await signedIn(backend, '/settings/calendars');

    await userEvent.click(await screen.findByRole('button', { name: 'Connect a calendar' }, slow));
    expect(await screen.findByRole('menuitem', { name: 'Google' })).toHaveAttribute(
      'href',
      '/auth/oidc/calendar-google/link',
    );
  });

  it('says how a Google sign-in from the Android app went, on Calendars', async () => {
    await signedIn(backendWithCalendars(), '/settings?link=cal_scope_missing');

    expect(
      await screen.findByText(
        'PeckList needs every calendar permission Google asks about. Connect again and leave them ticked.',
        {},
        slow,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect a calendar' })).toBeInTheDocument();
  });

  it('warns that disconnecting Google ends its access everywhere else too', async () => {
    const backend = backendWithCalendars();
    connected(backend);
    backend.calendars.accounts[0] = {
      ...backend.calendars.accounts[0]!,
      provider: 'google',
      name: 'ben@gmail.com',
      username: null,
    };
    await signedIn(backend, '/settings/calendars');

    await userEvent.click(await screen.findByRole('button', { name: 'Google actions' }, slow));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }));
    expect(
      screen.getByText(/ends PeckList's access to this Google account anywhere else/),
    ).toBeInTheDocument();
  });

  it('asks a Google account whose sign-in stopped working to sign in again', async () => {
    const backend = backendWithCalendars();
    connected(backend);
    backend.calendars.accounts[0] = {
      ...backend.calendars.accounts[0]!,
      provider: 'google',
      name: 'ben@gmail.com',
      username: null,
      status: 'auth_failed',
    };
    await signedIn(backend, '/settings/calendars');

    expect(await screen.findByText('ben@gmail.com', {}, slow)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/auth/oidc/calendar-google/link',
    );
  });

  it('makes a PeckList calendar synced with a tag', async () => {
    const backend = backendWithCalendars();
    connected(backend);
    await signedIn(backend, '/settings/calendars');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Make a PeckList calendar' }, slow),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Make a PeckList calendar' });
    expect(within(dialog).getByLabelText('Calendar name')).toHaveValue('PeckList');
    await userEvent.type(within(dialog).getByLabelText('New tag name'), 'Calendar');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make calendar' }));

    expect(
      await screen.findByRole('button', { name: 'PeckList: Sync: calendar' }),
    ).toBeInTheDocument();
    expect(backend.calendars.calls.at(-1)).toMatch(/^create acc-1 PeckList tag:\S+$/);
  });
});

describe('shown events in the views (PL-134)', () => {
  it('heads Today with the day events, which never count as work left', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [
      fakeEvent(today()),
      fakeEvent(today(), {
        id: 'ev-trip',
        title: 'Trip',
        allDay: true,
        start: today(),
        end: addDays(today(), 1),
      }),
      fakeEvent(addDays(today(), 1), { id: 'ev-later', title: 'Tomorrow thing' }),
    ];
    await signedIn(backend, '/today');

    const group = (await screen.findByRole('button', { name: 'Events 2' }, slow)).closest(
      'section',
    )!;
    const rows = within(group).getAllByRole('button', { name: /, / });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Trip, All day',
      expect.stringMatching(/^Dentist, 10:00|^Dentist, 10:00 AM/),
    ]);
    expect(screen.queryByText('Tomorrow thing')).toBeNull();
    expect(screen.getByText('All pecked out.')).toBeInTheDocument();
  });

  it('hides a ticked event with Undo, sending nothing until the Undo goes', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [fakeEvent(today())];
    await signedIn(backend, '/today');

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Hide Dentist' }, slow));
    await waitFor(() => expect(screen.queryByText('Dentist')).toBeNull());
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Dentist')).toBeInTheDocument();
    expect(backend.calendars.calls).toEqual([]);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Hide Dentist' }));
    await waitFor(() => expect(screen.queryByText('Dentist')).toBeNull());
    // Leaving the page sends the held hide at once, made to outlive the page.
    fireEvent(window, new Event('pagehide'));
    await waitFor(() => expect(backend.calendars.calls).toEqual(['hide ev-dentist all keepalive']));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('sends a tick made just before the page goes, while the tick still shows', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [fakeEvent(today())];
    await signedIn(backend, '/today');

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Hide Dentist' }, slow));
    fireEvent(window, new Event('pagehide'));
    await waitFor(() => expect(backend.calendars.calls).toEqual(['hide ev-dentist all keepalive']));
    // The beat ends with it gone and no Undo for a hide the server has.
    await waitFor(() => expect(screen.queryByText('Dentist')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('opens a single event to edit in place, saying which calendar it is from', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [fakeEvent(today())];
    connected(backend, fakeLink({ mode: 'show' }));
    await signedIn(backend, '/today');

    await userEvent.click(await screen.findByRole('button', { name: /^Dentist,/ }, slow));
    const popover = await screen.findByRole('dialog', { name: 'Event' });
    expect(await within(popover).findByText('Home')).toBeInTheDocument();
    const title = within(popover).getByRole('textbox', { name: 'Event title' });
    await userEvent.clear(title);
    await userEvent.type(title, 'Dentist (moved){Enter}');
    await waitFor(() =>
      expect(backend.calendars.calls).toEqual(['edit ev-dentist {"title":"Dentist (moved)"}']),
    );
    // The row behind the open popover takes the new title (the popover hides it from roles).
    expect(await screen.findByText('Dentist (moved)')).toBeInTheDocument();
  });

  it('shows a repeating event read-only, and makes that day of it a task', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [
      fakeEvent(today(), {
        id: 'ev-gym',
        title: 'Gym',
        recurring: true,
        editable: false,
        start: `${today()}T18:00`,
        end: null,
      }),
    ];
    await signedIn(backend, '/today');

    await userEvent.click(await screen.findByRole('button', { name: /^Gym,/ }, slow));
    const popover = await screen.findByRole('dialog', { name: 'Event' });
    expect(within(popover).queryByRole('textbox')).toBeNull();
    expect(
      within(popover).getByText("Repeating events can't be edited here yet."),
    ).toBeInTheDocument();
    await userEvent.click(within(popover).getByRole('button', { name: 'Make it a task' }));
    await waitFor(() => expect(backend.calendars.calls.at(-1)).toBe(`task ev-gym ${today()}`));
  });

  it('shows what an event says as text, never as markup', async () => {
    const backend = backendWithCalendars();
    const sneaky = '<img src=x onerror="window.hacked=1">';
    backend.calendars.shown = [
      fakeEvent(today(), {
        title: sneaky,
        notes: '<b>bold</b> https://example.com',
        editable: false,
      }),
    ];
    await signedIn(backend, '/today');

    await userEvent.click(
      await screen.findByRole(
        'button',
        { name: new RegExp(`^${sneaky.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) },
        slow,
      ),
    );
    const popover = await screen.findByRole('dialog', { name: 'Event' });
    expect(within(popover).getByText(sneaky)).toBeInTheDocument();
    expect(within(popover).getByText('<b>bold</b> https://example.com')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect(within(popover).queryByRole('link')).toBeNull();
  });

  it('leads each Upcoming day with its events', async () => {
    const backend = backendWithCalendars();
    const tomorrow = addDays(today(), 1);
    backend.calendars.shown = [fakeEvent(tomorrow, { id: 'ev-call', title: 'Call Mum' })];
    await signedIn(backend, '/upcoming');

    const day = (await screen.findByText('Call Mum', {}, slow)).closest('[data-agenda-day]');
    expect(day).toHaveAttribute('data-agenda-day', tomorrow);
    expect(within(day as HTMLElement).queryByText('Nothing planned')).toBeNull();
  });

  it('draws events on the calendar as events that open the event, not a task', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [fakeEvent(today())];
    localStorage.setItem(
      'pecklist.calendar',
      JSON.stringify({ mode: 'days', days: 1, hourHeight: 48 }),
    );
    await signedIn(backend, '/calendar');

    const block = await screen.findByRole('button', { name: /Dentist$/ }, slow);
    expect(block).toHaveAttribute('data-event');
    await userEvent.click(block);
    expect(await screen.findByRole('dialog', { name: 'Event' })).toBeInTheDocument();
  });

  it('keeps showing the last events fetched when the calendars cannot be reached', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [fakeEvent(today())];
    const storage = createMemoryStorage();
    const first = await signedIn(backend, '/today', storage);
    await screen.findByText('Dentist', {}, slow);
    first.unmount();

    backend.calendars.offline = true;
    await signedIn(backend, '/today', storage);
    expect(await screen.findByText('Dentist', {}, slow)).toBeInTheDocument();
  });

  it('shows the last events on a start with no server at all, ticking off', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [fakeEvent(today())];
    const storage = createMemoryStorage();
    const first = await signedIn(backend, '/today', storage);
    await screen.findByText('Dentist', {}, slow);
    first.unmount();

    await signedIn(backend, '/today', storage, { offline: true });
    expect(await screen.findByText('Dentist', {}, slow)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Hide Dentist' })).toBeDisabled();
  });
});

describe('calendars in a View as tab', () => {
  it('shows no events and no Calendars settings, and asks the server nothing', async () => {
    const backend = backendWithCalendars();
    backend.calendars.shown = [fakeEvent(today())];
    connected(backend, fakeLink({ mode: 'show' }));
    const store = testStore();
    const transport = backend.device();
    transport.session = 'ben';
    const sync = createSyncEngine({
      transport,
      workspace: store,
      storage: createMemoryStorage(),
      debounceMs: 60_000,
      intervalMs: 600_000,
    });
    const view = (path: string) => (
      <ViewAsContext.Provider value={{ token: 't', username: 'ben' }}>
        <AppProviders store={store} sync={sync}>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </AppProviders>
      </ViewAsContext.Provider>
    );
    const first = render(view('/today'));
    expect(await screen.findByRole('heading', { name: 'Today' }, slow)).toBeInTheDocument();
    first.unmount();

    render(view('/settings'));
    expect(await screen.findByRole('link', { name: /Tasks/ }, slow)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Calendars/ })).toBeNull();
    expect(screen.queryByText('Dentist')).toBeNull();
    expect(backend.calendars.fetches).toEqual([]);
    expect(backend.calendars.calls).toEqual([]);
  });
});
