/**
 * Whether this server shows the support card and the heart: the one place they ask (spec: PL-112).
 * Shown unless the server says otherwise, which also covers a static host with no server at all.
 * The server's `SUPPORT_LINKS=off` is read here once it exists.
 */
export function useSupportVisible(): boolean {
  return true;
}
