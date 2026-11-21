import { useEffect, useState } from 'react';
import type { AccountApi, StartOverInfo } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { intlLocale } from '../../core/intl.ts';

/** This account's own API, on a server with accounts; undefined anywhere else. */
export function useAccountApi(): AccountApi | undefined {
  return useSyncState((state) =>
    state.phase === 'ready' && state.account?.authMode === 'local'
      ? state.transport.account
      : undefined,
  );
}

/**
 * Whether the server offers Start over to this account (PL-147): the answer, null when it does not
 * (no account, or a server from before it), and undefined while asking.
 */
export function useStartOverOffer(api: AccountApi | undefined): StartOverInfo | null | undefined {
  const [offer, setOffer] = useState<StartOverInfo | null | undefined>(undefined);
  useEffect(() => {
    if (!api?.startOverInfo) return;
    let live = true;
    api.startOverInfo().then(
      (answer) => live && setOffer(answer),
      () => live && setOffer(null),
    );
    return () => {
      live = false;
    };
  }, [api]);
  return api?.startOverInfo ? offer : null;
}

// Deleting your own account signs you out at once, so what happened is said on the sign-in page
// you land on: once, in this tab only.

const KEY = 'pecklist.accountDeleted';

/** Remember, for the sign-in page, that the account was deleted and until when it can be restored. */
export function rememberDeleted(removedAt: string, graceDays: number): void {
  const date = new Date(removedAt).toLocaleDateString(intlLocale(), { dateStyle: 'long' });
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

/** Which dialog a fresh sign-in comes back to in Settings > Account: Delete my account, or Start over. */
export type ComeBackTo = 'delete' | 'startover';

/** The address of a real sign-in through `provider` (or `passkey`) that comes back to that dialog. */
export function freshSignInUrl(provider: string, back: ComeBackTo = 'delete'): string {
  const returnUrl = `/settings/account?${back}=1`;
  return `/auth/oidc/${encodeURIComponent(provider)}/login?fresh=1&returnUrl=${encodeURIComponent(returnUrl)}`;
}

/** A way to sign in again first, for an account without a password to type. */
export interface WayBack {
  label: string;
  url: string;
}

/** The ways this account can sign in again for a dialog: each linked provider once, and a passkey if it has one. */
export async function waysBack(api: AccountApi | undefined, back: ComeBackTo): Promise<WayBack[]> {
  const [methods, keys] = await Promise.all([
    api?.signInMethods().catch(() => null),
    api?.passkeys?.().catch(() => null),
  ]);
  const seen = new Set<string>();
  const found: WayBack[] = [];
  for (const each of methods?.identities ?? []) {
    if (seen.has(each.provider)) continue;
    seen.add(each.provider);
    found.push({
      label: t('deleteAccount.signInWith', { name: each.displayName }),
      url: freshSignInUrl(each.provider, back),
    });
  }
  if ((keys?.passkeys.length ?? 0) > 0) {
    found.push({ label: t('deleteAccount.signInPasskey'), url: freshSignInUrl('passkey', back) });
  }
  return found;
}
