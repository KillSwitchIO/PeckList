import { describe, expect, it } from 'vitest';
import { isServerPath } from './serverPaths.ts';

describe('server paths', () => {
  it('are the sign-in trips, the API, health and assets', () => {
    for (const path of [
      '/auth/oidc/pocket/login?returnUrl=%2Ftoday',
      '/auth/oidc/pocket/callback?code=abc&state=xyz',
      '/auth/link/token',
      '/auth/me',
      '/api/attachments/ab12',
      '/healthz',
      '/assets/index-abc.js',
      '/AUTH/oidc/pocket/login',
    ]) {
      expect(isServerPath(path), path).toBe(true);
    }
  });

  it('leave the app its own pages, even ones that start the same', () => {
    for (const path of [
      '/',
      '/today',
      '/login',
      '/list/abc',
      '/authors',
      '/apiary',
      '/healthzone',
    ]) {
      expect(isServerPath(path), path).toBe(false);
    }
  });
});
