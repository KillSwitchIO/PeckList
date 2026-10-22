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

/** Leave the app for a provider's sign-in (a function of its own so tests can stand in for it). */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
