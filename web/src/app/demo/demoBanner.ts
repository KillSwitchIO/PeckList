// The demo banner's dismissal (PL-117): for this tab's session only, so the next visit sees it
// again. Storage may be missing or refuse (private windows); the banner then just shows.
const KEY = 'punchlist.demoBanner';

export function bannerDismissed(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'hidden';
  } catch {
    return false;
  }
}

export function dismissBanner(): void {
  try {
    sessionStorage.setItem(KEY, 'hidden');
  } catch {
    // Hidden until the page reloads, which is all a refusing browser allows.
  }
}
