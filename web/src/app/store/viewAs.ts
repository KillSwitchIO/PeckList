// Viewing the app as someone else (spec: Accounts & Admin, impersonation). The tab a super admin
// opens for it holds the token in sessionStorage only: other tabs, and the admin's own data on this
// device, never see it. That tab runs on a throwaway in-memory store.
import { createContext, useContext } from 'react';

export interface ViewAs {
  token: string;
  username: string;
}

const KEY = 'punchlist.viewAs';
const HASH = /^#view-as=([^&]+)&name=([^&]+)$/;

/**
 * This tab's view-as session, if it is one: taken from the address the admin's tab opened (then
 * cleared from it), or from this tab's session storage after a reload.
 */
export function takeViewAs(): ViewAs | null {
  try {
    const match = HASH.exec(window.location.hash);
    if (match) {
      const view = {
        token: decodeURIComponent(match[1]!),
        username: decodeURIComponent(match[2]!),
      };
      sessionStorage.setItem(KEY, JSON.stringify(view));
      window.history.replaceState(window.history.state, '', window.location.pathname);
      return view;
    }
    const kept = sessionStorage.getItem(KEY);
    return kept ? (JSON.parse(kept) as ViewAs) : null;
  } catch {
    return null;
  }
}

export function forgetViewAs(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}

/** Open a new tab viewing the app as `username`. */
export function openViewAs(token: string, username: string): void {
  window.open(
    `/today#view-as=${encodeURIComponent(token)}&name=${encodeURIComponent(username)}`,
    '_blank',
  );
}

export const ViewAsContext = createContext<ViewAs | null>(null);

export function useViewAs(): ViewAs | null {
  return useContext(ViewAsContext);
}
