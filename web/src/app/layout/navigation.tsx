import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import DateRangeRounded from '@mui/icons-material/DateRangeRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import InboxRounded from '@mui/icons-material/InboxRounded';
import LayersRounded from '@mui/icons-material/LayersRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import TodayRounded from '@mui/icons-material/TodayRounded';
import type { ReactElement } from 'react';
import type { MessageKey } from '../i18n/i18n.ts';
import { AssignedIcon } from '../icons/icons.tsx';

export interface NavItem {
  path: string;
  label: MessageKey;
  icon: ReactElement;
}

/** Smart views shown in the sidebar (their default order; users can reorder them). */
export const SIDEBAR_ITEMS: NavItem[] = [
  { path: '/today', label: 'nav.today', icon: <TodayRounded /> },
  { path: '/inbox', label: 'nav.inbox', icon: <InboxRounded /> },
  { path: '/upcoming', label: 'nav.upcoming', icon: <DateRangeRounded /> },
  { path: '/all', label: 'nav.all', icon: <LayersRounded /> },
  { path: '/calendar', label: 'nav.calendar', icon: <CalendarMonthRounded /> },
  { path: '/completed', label: 'nav.completed', icon: <TaskAltRounded /> },
  { path: '/trash', label: 'nav.trash', icon: <DeleteOutlineRounded /> },
];

/** Views that need a server with accounts (core/sidebar.ts SHARED_VIEWS). */
export const SHARED_ITEMS: NavItem[] = [
  { path: '/assigned', label: 'nav.assigned', icon: <AssignedIcon /> },
];

/** The sidebar views by id (see core/sidebar.ts). */
export const VIEW_ITEMS: Record<string, NavItem> = Object.fromEntries(
  [...SIDEBAR_ITEMS, ...SHARED_ITEMS].map((item) => [item.path.slice(1), item]),
);

export const SIDEBAR_FOOTER: NavItem[] = [
  { path: '/search', label: 'nav.search', icon: <SearchRounded /> },
  { path: '/settings', label: 'nav.settings', icon: <SettingsRounded /> },
];

/** Bottom navigation on phones */
export const BOTTOM_ITEMS: NavItem[] = [
  { path: '/today', label: 'nav.today', icon: <TodayRounded /> },
  { path: '/inbox', label: 'nav.inbox', icon: <InboxRounded /> },
  { path: '/calendar', label: 'nav.calendar', icon: <CalendarMonthRounded /> },
  { path: '/search', label: 'nav.search', icon: <SearchRounded /> },
  { path: '/more', label: 'nav.more', icon: <MoreHorizRounded /> },
];

/** The nav item a path belongs to, so nested routes keep their tab highlighted. */
export function activeItem(items: NavItem[], pathname: string): string | false {
  const match = items.find(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  return match ? match.path : false;
}
