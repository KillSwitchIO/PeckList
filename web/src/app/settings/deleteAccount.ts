import { t } from '../i18n/i18n.ts';

// Deleting your own account signs you out at once, so what happened is said on the sign-in page
// you land on: once, in this tab only.

const KEY = 'pecklist.accountDeleted';

/** Remember, for the sign-in page, that the account was deleted and until when it can be restored. */
export function rememberDeleted(removedAt: string, graceDays: number): void {
  const date = new Date(removedAt).toLocaleDateString(undefined, { dateStyle: 'long' });
  const text =
    graceDays > 0 && !Number.isNaN(Date.parse(removedAt))
      ? t('deleteAccount.doneGrace', { date })
      : t('deleteAccount.doneNow');
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    // Not remembered: the sign-in page simply says nothing.
  }
}

/** What to say about a deletion just done, read once; null when there is none. */
export function takeDeletedNotice(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}

/** Where a fresh sign-in comes back to: Settings > Account, with the delete dialog open again. */
const BACK_HERE = '/settings/account?delete=1';

/** The address of a real sign-in through `provider` (or `passkey`) that comes back to the delete dialog. */
export function freshSignInUrl(provider: string): string {
  return `/auth/oidc/${encodeURIComponent(provider)}/login?fresh=1&returnUrl=${encodeURIComponent(BACK_HERE)}`;
}
