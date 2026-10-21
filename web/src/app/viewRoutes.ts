import type { MessageKey } from './i18n/i18n.ts';

export interface ViewRoute {
  path: string;
  title: MessageKey;
  /** Milestone that brings the real view; placeholder until then */
  milestone: string;
  empty?: { title: MessageKey; hint?: MessageKey };
}

export const VIEW_ROUTES: ViewRoute[] = [
  {
    path: '/today',
    title: 'nav.today',
    milestone: '0.2',
    empty: { title: 'empty.today', hint: 'empty.today.hint' },
  },
  { path: '/inbox', title: 'nav.inbox', milestone: '0.2' },
  { path: '/upcoming', title: 'nav.upcoming', milestone: '0.2' },
  { path: '/calendar', title: 'nav.calendar', milestone: '0.3' },
  { path: '/completed', title: 'nav.completed', milestone: '0.2' },
  { path: '/trash', title: 'nav.trash', milestone: '0.2' },
  { path: '/search', title: 'nav.search', milestone: '0.2' },
  { path: '/settings', title: 'nav.settings', milestone: '0.2' },
  { path: '/more', title: 'nav.more', milestone: '0.2' },
];
