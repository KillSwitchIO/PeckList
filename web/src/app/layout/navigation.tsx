import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import DateRangeRounded from '@mui/icons-material/DateRangeRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import InboxRounded from '@mui/icons-material/InboxRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import TodayRounded from '@mui/icons-material/TodayRounded';
import type { ReactElement } from 'react';
import type { MessageKey } from '../i18n/i18n.ts';

export interface NavItem {
  path: string;
  label: MessageKey;
  icon: ReactElement;
}

/** Smart views shown in the sidebar. Keep the order of the first items in step with BOTTOM_ITEMS. */
export const SIDEBAR_ITEMS: NavItem[] = [
  { path: '/today', label: 'nav.today', icon: <TodayRounded /> },
  { path: '/inbox', label: 'nav.inbox', icon: <InboxRounded /> },
  { path: '/upcoming', label: 'nav.upcoming', icon: <DateRangeRounded /> },
  { path: '/calendar', label: 'nav.calendar', icon: <CalendarMonthRounded /> },
  { path: '/completed', label: 'nav.completed', icon: <TaskAltRounded /> },
  { path: '/trash', label: 'nav.trash', icon: <DeleteOutlineRounded /> },
];

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
