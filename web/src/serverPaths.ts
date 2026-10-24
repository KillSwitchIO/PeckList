// Paths the server answers itself, never the PWA's router: the same prefixes as the server's
// StaticSite.ServerPrefixes. The service worker must let page loads of these through to the
// network. Otherwise it answers them with the app shell: "Sign in with Pocket ID" (a page load of
// /auth/oidc/<name>/login) and the provider's return to /auth/oidc/<name>/callback?code=... never
// reach the server, and the router shows its not-found page instead.

export const SERVER_PREFIXES = ['/api', '/auth', '/healthz', '/assets'] as const;

/** One pattern per prefix: the prefix itself, or the prefix and anything under it. */
export const serverPathPatterns: RegExp[] = SERVER_PREFIXES.map(
  (prefix) => new RegExp(`^${prefix}(?:[/?#]|$)`, 'i'),
);

/** Whether the server, not the app, owns this path. */
export function isServerPath(path: string): boolean {
  return serverPathPatterns.some((pattern) => pattern.test(path));
}
