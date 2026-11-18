// Starting the right thing for a smart link (PL-146): a browser tab, the email app, the dialer,
// a text message or the maps app. Only the addresses `openable` allows are ever opened.
//
// In the Android app, the WebView hands any address off its server to Android (Capacitor sends it
// out as a view intent), so tel:, sms:, mailto:, geo: and other sites open in their own apps and
// never inside the app, with no shell method needed, old shells included.

import {
  appleMapsHref,
  geoHref,
  googleMapsHref,
  mailHref,
  openable,
  telHref,
  webHref,
  type SmartKind,
} from '../../core/smartLinks.ts';

/** Opens `href` outside the app. False (and nothing opened) for an address notes may not open. */
export function openOutside(href: string): boolean {
  if (!openable(href)) return false;
  const link = document.createElement('a');
  link.href = href;
  // Web pages in a new tab, never in place of the app; mail, calls, texts and maps go to their
  // apps, which a browser does without leaving the page.
  if (/^https?:/i.test(href)) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  link.style.display = 'none';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
  return true;
}

function apple(): boolean {
  const agent = navigator.userAgent;
  return (
    /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)
  );
}

/**
 * What a tap does on a touch screen, with no menu first (PL-146): open the page, write the email,
 * call, or show the address in the maps app (Android's own, Apple Maps on an iPhone or iPad, and
 * Google Maps on the web elsewhere).
 */
export function mainHref(kind: SmartKind, text: string): string {
  switch (kind) {
    case 'web':
      return webHref(text);
    case 'email':
      return mailHref(text);
    case 'phone':
      return telHref(text);
    case 'address':
      if (/Android/.test(navigator.userAgent)) return geoHref(text);
      return apple() ? appleMapsHref(text) : googleMapsHref(text);
  }
}

/**
 * Whether a click came from a finger (or pen) rather than a mouse: its pointer type where the
 * event has one (click), whether touch made it (Chromium tells, for mousedown and mouseup too),
 * else whether this screen's main pointer is coarse.
 */
export function touchClick(event: MouseEvent): boolean {
  const type = (event as Partial<PointerEvent>).pointerType;
  if (type) return type !== 'mouse';
  const source = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } })
    .sourceCapabilities;
  if (source && typeof source.firesTouchEvents === 'boolean') return source.firesTouchEvents;
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
