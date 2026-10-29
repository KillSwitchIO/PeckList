import type { UserStats } from '../ports/stats.ts';
import type {
  Account,
  ChangeEvent,
  ProfilePreview,
  ServerNotification,
  HistoryEntry,
  LoginOutcome,
  PasswordOutcome,
  ServerInfo,
  UpdateInfo,
  ApiKeyInfo,
  SignInMethods,
  SignUpOutcome,
  SyncRequest,
  SyncResponse,
  SyncTransport,
} from '../ports/sync.ts';
import { SyncFailure } from '../ports/sync.ts';
import { messageOf } from '../core/errors.ts';
import { createHttpAdmin } from './http-admin.ts';

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
  /** A request with the session cookie and this device's name; no answer at all reads as offline. */
  const send = async (path: string, init: RequestInit & { headers: Record<string, string> }) => {
    try {
      return await fetcher(`${base}${path}`, {
        ...init,
        credentials: 'same-origin',
        headers: { ...init.headers, ...(device ? { 'X-Punchlist-Device': device } : {}) },
      });
    } catch (error) {
      throw new SyncFailure('offline', messageOf(error));
    }
  };
  /** A JSON request (or a plain GET). */
  const call = (path: string, init?: { method?: string; body?: unknown }) =>
    send(path, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: init?.body === undefined ? null : JSON.stringify(init.body),
    });
  /** A file's own request: raw bytes, not JSON. */
  const fileCall = (sha256: string, method: string, body?: Blob) =>
    send(`/api/attachments/${encodeURIComponent(sha256)}`, {
      method,
      headers: body ? { 'Content-Type': 'application/octet-stream' } : {},
      body: body ?? null,
    });
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

  const providerIcon = (name: string) => `${base}/auth/providers/${encodeURIComponent(name)}/icon`;

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

    files: {
      async has(sha256) {
        const response = await fileCall(sha256, 'HEAD');
        if (response.status === 404) return false;
        if (!response.ok) return fail(response);
        return true;
      },
      async upload(sha256, file) {
        const response = await fileCall(sha256, 'PUT', file);
        if (response.ok) return 'stored';
        if (response.status === 413) return 'too-large';
        if (response.status === 400 || response.status === 403) return 'refused';
        return fail(response);
      },
      async download(sha256) {
        const response = await fileCall(sha256, 'GET');
        if (response.status === 404) return null;
        if (!response.ok) return fail(response);
        return response.blob();
      },
    },

    async me() {
      const response = await call('/auth/me');
      if (response.status === 401) return null;
      if (!response.ok) return fail(response);
      const account = (await response.json()) as Account;
      return account.provider
        ? { ...account, providerIcon: providerIcon(account.provider) }
        : account;
    },

    async signInOptions(returnUrl, invite) {
      const response = await call('/auth/providers');
      // Servers from before OIDC (a 404, or the app's index.html): passwords only.
      if (response.status === 404 || !response.headers.get('content-type')?.includes('json')) {
        return { providers: [], localLogin: true };
      }
      if (!response.ok) return fail(response);
      const options = (await response.json()) as {
        providers: { name: string; displayName: string; icon?: string }[];
        localLogin: boolean;
        registration?: 'open' | 'invite' | 'closed';
      };
      const withInvite = invite ? `&invite=${encodeURIComponent(invite)}` : '';
      return {
        localLogin: options.localLogin,
        registration: options.registration ?? 'closed',
        providers: options.providers.map((provider) => ({
          ...provider,
          ...(provider.icon ? { icon: `${base}${provider.icon}` } : {}),
          url: `${base}/auth/oidc/${encodeURIComponent(provider.name)}/login?returnUrl=${encodeURIComponent(returnUrl)}${withInvite}`,
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
      if (
        response.status === 403 &&
        (await errorOf(response.clone())).error === 'local_login_disabled'
      ) {
        return { kind: 'disabled' };
      }
      return fail(response);
    },

    async signUp(username, password, invite): Promise<SignUpOutcome> {
      const response = await call('/auth/signup', {
        method: 'POST',
        body: { username, password, invite: invite ?? null },
      });
      if (response.ok) return { kind: 'ok', account: (await response.json()) as Account };
      if (response.status === 429) return { kind: 'too-many' };
      const { error } = await errorOf(response);
      // local_login_hidden is the name servers before 0.2.1 answer with.
      switch (error) {
        case 'username_taken':
          return { kind: 'username-taken' };
        case 'invalid_username':
          return { kind: 'invalid-username' };
        case 'too_short':
          return { kind: 'too-short' };
        case 'invite_invalid':
          return { kind: 'invite-invalid' };
        case 'registration_closed':
        case 'invite_required':
        case 'local_login_disabled':
        case 'local_login_hidden':
          return { kind: 'closed' };
        default:
          // Servers from before sign-up answer 404 (or the app's index.html for the POST).
          if (response.status === 404 || response.status === 405) return { kind: 'closed' };
          return fail(response);
      }
    },

    async checkInvite(token) {
      const response = await call(`/auth/invites/${encodeURIComponent(token)}`);
      if (response.status === 404) return null;
      if (!response.ok) return fail(response);
      if (!response.headers.get('content-type')?.includes('json')) return null;
      return (await response.json()) as { expires: string };
    },

    async logout() {
      const response = await call('/auth/logout', { method: 'POST' });
      if (!response.ok && response.status !== 401) await fail(response);
      if (response.status === 200 && response.headers.get('content-type')?.includes('json')) {
        const { redirect } = (await response.json()) as { redirect?: string };
        if (redirect) return { redirect };
      }
      return undefined;
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

    admin: createHttpAdmin(base, fetcher),

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
      async stats() {
        const response = await call('/api/account/stats');
        if (!response.ok) return fail(response);
        return (await response.json()) as UserStats;
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

    notifications: {
      async list() {
        const response = await call('/api/notifications');
        if (!response.ok) return fail(response);
        return (await response.json()) as { items: ServerNotification[]; unread: number };
      },
      async read(ids) {
        const response = await call('/api/notifications/read', { method: 'POST', body: { ids } });
        if (!response.ok) return fail(response);
      },
      async clear(ids) {
        const response = await call('/api/notifications/clear', { method: 'POST', body: { ids } });
        if (!response.ok) return fail(response);
      },
    },

    apiKeys: {
      async list() {
        const response = await call('/api/account/api-keys');
        if (!response.ok) return fail(response);
        return (await response.json()) as ApiKeyInfo[];
      },
      async create(input) {
        const response = await call('/api/account/api-keys', { method: 'POST', body: input });
        if (response.status === 400) {
          const body = (await response.json().catch(() => ({}))) as { message?: string };
          return { problem: body.message ?? 'The key could not be made.' };
        }
        if (!response.ok) return fail(response);
        return (await response.json()) as { key: ApiKeyInfo; token: string };
      },
      async revoke(id) {
        const response = await call(`/api/account/api-keys/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
        if (!response.ok && response.status !== 404) return fail(response);
      },
    },

    updates: {
      async latest() {
        const response = await call('/api/updates');
        if (response.status === 404) return null;
        if (!response.ok) return fail(response);
        return (await response.json()) as UpdateInfo;
      },
    },

    history: {
      async task(taskId) {
        const response = await call(`/api/tasks/${encodeURIComponent(taskId)}/history`);
        if (response.status === 404) return [];
        if (!response.ok) return fail(response);
        return (await response.json()) as HistoryEntry[];
      },
    },

    push: {
      async key() {
        const response = await call('/api/push/key');
        if (!response.ok) return fail(response);
        return ((await response.json()) as { publicKey: string }).publicKey;
      },
      async subscribe(subscription) {
        const response = await call('/api/push/subscriptions', {
          method: 'POST',
          body: subscription,
        });
        if (!response.ok) return fail(response);
      },
      async unsubscribe(endpoint) {
        const response = await call('/api/push/unsubscribe', {
          method: 'POST',
          body: { endpoint },
        });
        if (!response.ok) return fail(response);
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
