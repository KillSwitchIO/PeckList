import type {
  Account,
  ChangeEvent,
  ProfilePreview,
  LoginOutcome,
  PasswordOutcome,
  ServerInfo,
  SignInMethods,
  SyncRequest,
  SyncResponse,
  SyncTransport,
} from '../ports/sync.ts';
import { SyncFailure } from '../ports/sync.ts';

interface ErrorBody {
  error?: string;
  message?: string;
  until?: string;
  serverSchemaVersion?: number;
}

/**
 * The server on the same origin, over fetch with the session cookie. Same origin keeps the cookie
 * first-party (the BFF pattern in ADR-0006); `base` is only for tests and a dev proxy.
 */
export function createHttpSync(
  base = '',
  fetcher: typeof fetch = (...args) => fetch(...args),
  /** This device (tab), sent with each sync so the server's change events can name it. */
  device: string | null = null,
): SyncTransport {
  const call = async (path: string, init?: { method?: string; body?: unknown }) => {
    try {
      return await fetcher(`${base}${path}`, {
        method: init?.method ?? 'GET',
        credentials: 'same-origin',
        headers: {
          ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(device ? { 'X-Punchlist-Device': device } : {}),
        },
        body: init?.body === undefined ? null : JSON.stringify(init.body),
      });
    } catch (error) {
      throw new SyncFailure('offline', error instanceof Error ? error.message : String(error));
    }
  };
  const errorOf = async (response: Response): Promise<ErrorBody> => {
    try {
      return (await response.json()) as ErrorBody;
    } catch {
      return {};
    }
  };
  /** Turn a failed response into the failure the app acts on. */
  const fail = async (response: Response): Promise<never> => {
    const body = await errorOf(response);
    if (response.status === 401) throw new SyncFailure('signed-out', 'not signed in');
    if (response.status === 403 && body.error === 'password_change_required') {
      throw new SyncFailure('password-change', 'the password must be changed first');
    }
    if (response.status === 409 && body.error === 'schema_mismatch') {
      throw new SyncFailure('schema', body.message ?? 'schema mismatch', body.serverSchemaVersion);
    }
    if (response.status === 400) throw new SyncFailure('rejected', body.message ?? 'rejected');
    // A proxy or gateway that cannot reach the server reads as being offline.
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      throw new SyncFailure('offline', `server unavailable (${response.status})`);
    }
    throw new SyncFailure('server', body.message ?? `server error ${response.status}`);
  };

  return {
    async info() {
      const response = await call('/api/info');
      if (response.status === 404) return null;
      if (!response.ok) return fail(response);
      // A static host may answer every path with the app's index.html.
      if (!response.headers.get('content-type')?.includes('json')) return null;
      const info = (await response.json()) as ServerInfo;
      return info.name === 'punchlist' ? info : null;
    },

    async me() {
      const response = await call('/auth/me');
      if (response.status === 401) return null;
      if (!response.ok) return fail(response);
      return (await response.json()) as Account;
    },

    async signInOptions(returnUrl) {
      const response = await call('/auth/providers');
      // Servers from before OIDC (a 404, or the app's index.html): passwords only.
      if (response.status === 404 || !response.headers.get('content-type')?.includes('json')) {
        return { providers: [], localLogin: true };
      }
      if (!response.ok) return fail(response);
      const options = (await response.json()) as {
        providers: { name: string; displayName: string }[];
        localLogin: boolean;
      };
      return {
        localLogin: options.localLogin,
        providers: options.providers.map((provider) => ({
          ...provider,
          url: `${base}/auth/oidc/${encodeURIComponent(provider.name)}/login?returnUrl=${encodeURIComponent(returnUrl)}`,
        })),
      };
    },

    async login(username, password): Promise<LoginOutcome> {
      const response = await call('/auth/login', { method: 'POST', body: { username, password } });
      if (response.ok) return { kind: 'ok', account: (await response.json()) as Account };
      if (response.status === 401) return { kind: 'invalid' };
      if (response.status === 423)
        return { kind: 'locked', until: (await errorOf(response)).until ?? '' };
      if (response.status === 429) return { kind: 'too-many' };
      return fail(response);
    },

    async logout() {
      const response = await call('/auth/logout', { method: 'POST' });
      if (!response.ok && response.status !== 401) await fail(response);
    },

    async changePassword(current, next): Promise<PasswordOutcome> {
      const response = await call('/auth/password', { method: 'POST', body: { current, next } });
      if (response.ok) return { kind: 'ok', account: (await response.json()) as Account };
      if (response.status === 400) {
        const { error } = await errorOf(response);
        if (error === 'wrong_password') return { kind: 'wrong-password' };
        if (error === 'too_short') return { kind: 'too-short' };
        if (error === 'unchanged') return { kind: 'unchanged' };
      }
      return fail(response);
    },

    async sync(request: SyncRequest): Promise<SyncResponse> {
      const response = await call('/api/sync', { method: 'POST', body: request });
      if (!response.ok) return fail(response);
      return (await response.json()) as SyncResponse;
    },

    account: {
      async signInMethods() {
        const response = await call('/api/account/sign-in');
        if (!response.ok) return fail(response);
        return (await response.json()) as SignInMethods;
      },
      async unlink(provider, subject) {
        const response = await call(
          `/api/account/identities/${encodeURIComponent(provider)}/${encodeURIComponent(subject)}`,
          { method: 'DELETE' },
        );
        if (response.status === 409) return 'last-way-in';
        if (!response.ok && response.status !== 404) return fail(response);
        return 'ok';
      },
    },

    friends: {
      async code(rotate = false) {
        const response = await call('/api/friends/code', rotate ? { method: 'POST' } : undefined);
        if (!response.ok) return fail(response);
        return (await response.json()) as { code: string; link: string };
      },
      async preview(code) {
        const response = await call(`/api/friends/link/${encodeURIComponent(code)}`);
        if (response.status === 404) return null;
        if (!response.ok) return fail(response);
        return (await response.json()) as ProfilePreview;
      },
      async accept(code) {
        const response = await call(`/api/friends/link/${encodeURIComponent(code)}`, {
          method: 'POST',
        });
        if (response.status === 404) return null;
        if (!response.ok) return fail(response);
        return ((await response.json()) as { friendshipId: string }).friendshipId;
      },
      async lookup(query) {
        const response = await call(`/api/users/lookup?q=${encodeURIComponent(query)}`);
        if (response.status === 404) return null;
        if (!response.ok) return fail(response);
        return (await response.json()) as ProfilePreview;
      },
    },

    events(onChange) {
      // Server-Sent Events; the browser reconnects by itself after a drop.
      if (typeof EventSource === 'undefined') return () => undefined;
      const source = new EventSource(`${base}/api/events`, { withCredentials: true });
      source.addEventListener('changed', (event) => {
        try {
          onChange(JSON.parse((event as MessageEvent<string>).data) as ChangeEvent);
        } catch {
          // A malformed event: the next timer sync catches up anyway.
        }
      });
      return () => source.close();
    },
  };
}
