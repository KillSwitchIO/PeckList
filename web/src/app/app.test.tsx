import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, localTimeZone, todayIn } from '../core/dates.ts';
import { createTag } from '../core/tags.ts';
import { dayHeading } from './views/dayLabels.ts';
import { mockViewport, renderApp, testStore } from '../test/renderApp.tsx';
import { setLocale, t } from './i18n/i18n.ts';
import { activeItem, SIDEBAR_ITEMS } from './layout/navigation.tsx';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('app shell', () => {
  it('scrolls the page column on wider screens, from the top on each page (R-FB-96)', async () => {
    mockViewport('desktop');
    await renderApp('/today');
    const main = screen.getByRole('main');
    // The column scrolls, so its scroll bar covers the page only, not the top bar.
    expect(getComputedStyle(main).overflowY).toBe('auto');
    main.scrollTop = 500;
    await userEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
    await screen.findByRole('heading', { level: 1, name: 'Upcoming' });
    expect(main.scrollTop).toBe(0);
  });

  it('scrolls the window on phones (pull to refresh, the browser bars)', async () => {
    mockViewport('phone');
    await renderApp('/today');
    expect(getComputedStyle(screen.getByRole('main')).overflowY).not.toBe('auto');
  });

  it('redirects / to Today and shows the empty state', async () => {
    mockViewport('desktop');
    await renderApp('/');
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('All punched out.')).toBeInTheDocument();
  });

  it('shows the permanent sidebar on desktop and navigates', async () => {
    mockViewport('desktop');
    await renderApp('/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    await userEvent.click(within(nav).getByText('Mess Drawer'));
    expect(screen.getByRole('heading', { level: 1, name: 'Mess Drawer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('nav.openMenu') })).not.toBeInTheDocument();
  });

  it('uses bottom navigation on phones', async () => {
    mockViewport('phone');
    await renderApp('/today');
    expect(screen.queryByRole('button', { name: t('nav.openMenu') })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    // The calendar loads on first visit (R-FB-94).
    expect(await screen.findByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    // On a phone the unscheduled tasks wait in a drawer.
    expect(screen.getByRole('button', { name: 'Unscheduled' })).toBeInTheDocument();
  });

  it('gives phones a + button that opens the new task screen (R-FB-74)', async () => {
    mockViewport('phone');
    const { store } = await renderApp('/today');
    await userEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    // A blank task, full screen, dated today as the page's tasks are.
    const form = await screen.findByRole('dialog');
    expect(within(form).getByLabelText('Title')).toHaveValue('');
    const blank = () =>
      store.getState().workspace!.entities.tasks.filter((task) => task.title === '');
    expect(blank()).toHaveLength(1);
    expect(blank()[0]!.schedule).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // A page without an add field: the Inbox's.
    await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mess Drawer' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens a drawer from the menu button on tablets', async () => {
    mockViewport('tablet');
    await renderApp('/today');
    await userEvent.click(screen.getByRole('button', { name: t('nav.openMenu') }));
    // Trash sits in the collapsed "More" group.
    await userEvent.click(await screen.findByRole('button', { name: /^More/ }));
    await userEvent.click(await screen.findByText('Trash'));
    // The drawer hides the page from assistive tech until its exit transition ends.
    expect(await screen.findByRole('heading', { level: 1, name: 'Trash' })).toBeInTheDocument();
  });

  it('edits the sidebar: hide a view, Done saves, Cancel drops', async () => {
    mockViewport('desktop');
    await renderApp('/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    // Right-click (like a hold or a drag) starts editing.
    fireEvent.contextMenu(within(nav).getByText('Calendar'));
    const bar = within(nav).getByRole('toolbar', { name: 'Edit sidebar' });
    await userEvent.click(within(nav).getByRole('button', { name: 'Hide Calendar' }));
    await userEvent.click(within(bar).getByRole('button', { name: 'Done' }));
    expect(within(nav).queryByText('Calendar')).toBeNull();
    expect(screen.getByText('Sidebar updated')).toBeInTheDocument();

    // Show it again, then cancel: it stays hidden.
    fireEvent.contextMenu(within(nav).getByText('Today'));
    await userEvent.click(within(nav).getByRole('button', { name: 'Show Calendar' }));
    await userEvent.click(within(nav).getByRole('button', { name: 'Cancel' }));
    expect(within(nav).queryByText('Calendar')).toBeNull();
    expect(within(nav).queryByRole('toolbar', { name: 'Edit sidebar' })).toBeNull();

    // Reset brings back the default layout (Calendar shown) once saved.
    fireEvent.contextMenu(within(nav).getByText('Today'));
    await userEvent.click(within(nav).getByRole('button', { name: 'Reset' }));
    await userEvent.click(within(nav).getByRole('button', { name: 'Done' }));
    expect(within(nav).getByText('Calendar')).toBeInTheDocument();
  });

  it('makes a saved filter from sidebar editing and opens it', async () => {
    mockViewport('desktop');
    await renderApp('/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    fireEvent.contextMenu(within(nav).getByText('All'));
    await userEvent.click(within(nav).getByRole('button', { name: 'New filter' }));
    const dialog = await screen.findByRole('dialog', { name: 'New filter' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Urgent');
    await userEvent.click(within(dialog).getByRole('button', { name: 'High' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create filter' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Urgent' })).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole('button', { name: 'Done' }));
    expect(within(nav).getByText('Urgent')).toBeInTheDocument();
  });

  it('pins a nested tag to the top with its whole path, then unpins it', async () => {
    mockViewport('desktop');
    const store = testStore();
    await renderApp('/today', store);
    store.getState().apply((ctx, ws) => createTag(ctx, ws, 'home/yard').workspace);
    const nav = screen.getAllByRole('navigation')[0]!;
    fireEvent.contextMenu(within(nav).getByText('Today'));
    await userEvent.click(within(nav).getByRole('button', { name: 'Pin home/yard' }));
    await userEvent.click(within(nav).getByRole('button', { name: 'Done' }));
    // Shown in both places: pinned at the top (full path) and in the tag tree.
    expect(within(nav).getByTitle('home/yard')).toBeInTheDocument();
    expect(within(nav).getByText('yard')).toBeInTheDocument();

    fireEvent.contextMenu(within(nav).getByText('Today'));
    await userEvent.click(within(nav).getAllByRole('button', { name: 'Unpin home/yard' })[0]!);
    await userEvent.click(within(nav).getByRole('button', { name: 'Done' }));
    expect(within(nav).queryByTitle('home/yard')).toBeNull();
  });

  it('picks the theme in settings and remembers it, with no theme button in the top bar', async () => {
    mockViewport('desktop', true);
    await renderApp('/settings');
    expect(screen.queryByRole('button', { name: /switch theme/i })).not.toBeInTheDocument();
    const theme = screen.getByRole('group', { name: 'Theme' });
    expect(within(theme).getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(theme).getByRole('button', { name: 'Light' }));
    expect(localStorage.getItem('punchlist.themeMode')).toBe('light');
    expect(within(theme).getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('carries a theme mode picked in this browser into the synced settings', async () => {
    mockViewport('desktop');
    localStorage.setItem('punchlist.themeMode', 'dark');
    const store = testStore();
    await renderApp('/today', store);
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.themeMode).toBe('dark'),
    );
  });

  it('shows a not-found page', async () => {
    mockViewport('desktop');
    await renderApp('/nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('stable frame', () => {
  it('keeps the same sidebar and header when switching views', async () => {
    mockViewport('desktop');
    await renderApp('/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    const profile = screen.getByRole('button', { name: /account/i });
    await userEvent.click(within(nav).getByText('Mess Drawer'));
    await screen.findByRole('heading', { level: 1, name: 'Mess Drawer' });
    expect(screen.getAllByRole('navigation')[0]).toBe(nav);
    expect(screen.getByRole('button', { name: /account/i })).toBe(profile);
  });

  it('lists Today before the Mess Drawer in the sidebar and the bottom bar', async () => {
    mockViewport('desktop');
    const desktop = await renderApp('/today');
    const sidebar = within(screen.getAllByRole('navigation')[0]!)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(sidebar.indexOf('Today')).toBeLessThan(sidebar.indexOf('Mess Drawer'));
    desktop.unmount();
    mockViewport('phone');
    await renderApp('/today');
    const bottom = within(screen.getByRole('navigation'))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(bottom.slice(0, 2)).toEqual(['Today', 'Mess Drawer']);
  });
});

describe('sidebar frame', () => {
  it('folds the sidebar away and back, and remembers it', async () => {
    mockViewport('desktop');
    const first = await renderApp('/today');
    expect(screen.getByRole('navigation', { name: 'Punchlist' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hide the sidebar' }));
    expect(screen.queryByRole('navigation', { name: 'Punchlist' })).toBeNull();
    first.unmount();

    await renderApp('/today');
    expect(screen.queryByRole('navigation', { name: 'Punchlist' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show the sidebar' }));
    expect(screen.getByRole('navigation', { name: 'Punchlist' })).toBeInTheDocument();
  });

  it("opens a day of the mini calendar as that day's list, and shows the version", async () => {
    mockViewport('desktop');
    await renderApp('/calendar');
    const mini = screen.getByRole('region', { name: 'Mini calendar' });
    await userEvent.click(within(mini).getByRole('button', { name: 'Show the whole month' }));
    expect(within(mini).getAllByRole('gridcell')).toHaveLength(42);
    await userEvent.click(within(mini).getByRole('button', { name: 'Next month' }));
    expect(within(mini).queryByRole('gridcell', { current: 'date' })).toBeNull();
    await userEvent.click(within(mini).getByRole('button', { name: 'Back to this month' }));
    // Today opens Today.
    await userEvent.click(within(mini).getByRole('gridcell', { current: 'date' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();

    // Another day opens its own list; a task added there lands on that day.
    const now = todayIn(localTimeZone(), Date.now());
    const tomorrow = addDays(now, 1);
    await userEvent.click(within(mini).getByRole('gridcell', { name: `Open ${tomorrow}` }));
    const title = dayHeading(tomorrow, now);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(within(mini).getByRole('gridcell', { name: `Open ${tomorrow}` })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Nothing on this day')).toBeInTheDocument();
    const add = screen.getByPlaceholderText(`Add a task to ${title}`);
    await userEvent.type(add, 'Pick up the cake{Enter}');
    expect(
      await screen.findByRole('button', { name: 'Open Pick up the cake' }),
    ).toBeInTheDocument();
    expect(
      within(mini).getByRole('gridcell', { name: `Open ${tomorrow} (has tasks)` }),
    ).toBeInTheDocument();

    // The arrows step a day, and back onto today is Today.
    await userEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: dayHeading(addDays(now, 2), now) }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Pick up the cake' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Previous day' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: /^Punchlist v\d+\.\d+\.\d+.*: what changed$/ }),
    ).toHaveAttribute('href', 'https://gitlab.com/killswitch10/punchlist/-/blob/main/CHANGELOG.md');
  });

  it('zooms the mini calendar out to months and years from its title', async () => {
    mockViewport('desktop');
    await renderApp('/today');
    const mini = screen.getByRole('region', { name: 'Mini calendar' });
    const now = todayIn(localTimeZone(), Date.now());
    const year = Number(now.slice(0, 4));
    await userEvent.click(within(mini).getByRole('button', { name: 'Show the whole month' }));
    await userEvent.click(within(mini).getByRole('button', { name: /: pick a month$/ }));
    await userEvent.click(within(mini).getByRole('button', { name: `${year}: pick a year` }));
    await userEvent.click(within(mini).getByRole('button', { name: 'Later years' }));
    await userEvent.click(within(mini).getByRole('button', { name: String(year + 12) }));
    await userEvent.click(within(mini).getByRole('button', { name: `March ${year + 12}` }));
    expect(within(mini).getByRole('grid', { name: `March ${year + 12}` })).toBeVisible();
    expect(within(mini).getByRole('gridcell', { name: `Open ${year + 12}-03-01` })).toBeVisible();
    await userEvent.click(within(mini).getByRole('button', { name: 'Back to this month' }));
    expect(within(mini).getByRole('gridcell', { current: 'date' })).toBeVisible();
  });

  it('starts the mini calendar folded to this week, every time (R-FB-76)', async () => {
    mockViewport('desktop');
    const first = await renderApp('/today');
    const mini = screen.getByRole('region', { name: 'Mini calendar' });
    expect(within(mini).getAllByRole('gridcell')).toHaveLength(7);
    expect(within(mini).getByRole('gridcell', { current: 'date' })).toBeInTheDocument();
    await userEvent.click(within(mini).getByRole('button', { name: 'Next week' }));
    expect(within(mini).queryByRole('gridcell', { current: 'date' })).toBeNull();
    await userEvent.click(within(mini).getByRole('button', { name: 'Back to this week' }));
    expect(within(mini).getByRole('gridcell', { current: 'date' })).toBeInTheDocument();
    await userEvent.click(within(mini).getByRole('button', { name: 'Show the whole month' }));
    expect(within(mini).getAllByRole('gridcell')).toHaveLength(42);
    first.unmount();

    // Unfolded last time, folded again now.
    await renderApp('/today');
    const again = screen.getByRole('region', { name: 'Mini calendar' });
    expect(within(again).getAllByRole('gridcell')).toHaveLength(7);
  });
});

describe('navigation helpers', () => {
  it('matches nested paths to their nav item', () => {
    expect(activeItem(SIDEBAR_ITEMS, '/inbox/123')).toBe('/inbox');
    expect(activeItem(SIDEBAR_ITEMS, '/elsewhere')).toBe(false);
  });
});

describe('i18n', () => {
  it('interpolates parameters and falls back to English', () => {
    setLocale('fr-FR');
    expect(t('empty.comingSoon', { milestone: '0.3' })).toBe('This view arrives in milestone 0.3.');
    expect(t('empty.comingSoon')).toBe('This view arrives in milestone {milestone}.');
    setLocale('en');
  });
});
