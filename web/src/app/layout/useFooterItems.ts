import { useAdminApi } from '../admin/useAdmin.ts';
import { ADMIN_ITEM, SIDEBAR_FOOTER, type NavItem } from './navigation.tsx';

/** The sidebar footer: Search and Settings, with Admin first for admins on a server. */
export function useFooterItems(): NavItem[] {
  return useAdminApi() ? [ADMIN_ITEM, ...SIDEBAR_FOOTER] : SIDEBAR_FOOTER;
}
