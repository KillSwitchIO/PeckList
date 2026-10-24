import { SIDEBAR_FOOTER, type NavItem } from './navigation.tsx';

/** The sidebar footer: Search. Settings and Admin moved to the profile menu (spec: PL-086). */
export function useFooterItems(): NavItem[] {
  return SIDEBAR_FOOTER;
}
