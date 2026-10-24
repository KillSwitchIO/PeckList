// The identity provider this device last signed in with. When its session ends on schedule (the
// server re-checks provider sessions, spec: Accounts & Admin, OIDC), the sign-in page goes back
// through that provider by itself. Signing out or a refused sign-in forgets it.

const KEY = 'punchlist.signInWith';

export function rememberedProvider(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberProvider(name: string | null): void {
  try {
    if (name === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, name);
  } catch {
    // Private windows may refuse storage: the person clicks the button again instead.
  }
}

const AUTO_KEY = 'punchlist.signInWith.autoAt';
/** How long after going back through a provider by itself the sign-in page waits to do it again. */
const AUTO_PAUSE_MS = 60_000;

/**
 * Whether the sign-in page may go back through the remembered provider by itself now, and if so
 * notes that it did. At most once a minute per tab: when the trip comes straight back signed out
 * (a provider refusing quietly, or anything between here and the server answering in its place),
 * the page stays put with its buttons instead of looping.
 */
export function mayContinueOnItsOwn(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(AUTO_KEY) ?? 0);
    if (now - last < AUTO_PAUSE_MS) return false;
    sessionStorage.setItem(AUTO_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Leave the app for a provider's sign-in (a function of its own so tests can stand in for it). */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
