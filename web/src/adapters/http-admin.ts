import type {
  AccountRole,
  AdminApi,
  AdminFriend,
  AdminGroup,
  AdminIdentity,
  AdminProvider,
  AdminShare,
  AdminRefusal,
  AdminResult,
  AdminUser,
  PendingSignIn,
  ServerSettingsView,
} from '../ports/admin.ts';
import { SyncFailure } from '../ports/sync.ts';

/** The server's error names, as the app reads them. */
const REFUSALS: Record<string, AdminRefusal> = {
  last_super_admin: 'last-super-admin',
  self: 'self',
  username_taken: 'taken',
  name_taken: 'taken',
  invalid_username: 'invalid',
  invalid_name: 'invalid',
  invalid_role: 'invalid',
  too_short: 'too-short',
  admins_only_by_super_admins: 'admins-only',
  not_allowed: 'not-allowed',
  reason_required: 'reason-required',
};

/** `/api/admin` over fetch, with the session cookie (same origin). */
export function createHttpAdmin(
  base = '',
  fetcher: typeof fetch = (...args) => fetch(...args),
): AdminApi {
  const call = async (path: string, method = 'GET', body?: unknown) => {
    let response: Response;
    try {
      response = await fetcher(`${base}/api/admin${path}`, {
        method,
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? null : JSON.stringify(body),
      });
    } catch (error) {
      throw new SyncFailure('offline', error instanceof Error ? error.message : String(error));
    }
    if (response.status === 401) throw new SyncFailure('signed-out', 'not signed in');
    return response;
  };
  const json = async <T>(response: Response): Promise<T> => {
    if (!response.ok) throw new SyncFailure('server', `server error ${response.status}`);
    return (await response.json()) as T;
  };
  /** A refusal the person can act on, or a failure for anything else. */
  const result = async <T>(
    response: Response,
    value: (response: Response) => Promise<T>,
  ): Promise<AdminResult<T>> => {
    if (response.ok) return { ok: true, value: await value(response) };
    if (response.status === 400 || response.status === 403 || response.status === 409) {
      let error = '';
      try {
        error = ((await response.json()) as { error?: string }).error ?? '';
      } catch {
        // No body (a plain 403): the caller may not do it.
      }
      const reason = REFUSALS[error] ?? (response.status === 403 ? 'admins-only' : undefined);
      if (reason) return { ok: false, reason };
    }
    throw new SyncFailure('server', `server error ${response.status}`);
  };
  const none = () => Promise.resolve();
  const segment = encodeURIComponent;

  return {
    users: async () => json<AdminUser[]>(await call('/users')),
    addUser: async (username, role: AccountRole) =>
      result(await call('/users', 'POST', { username, role }), async (response) => {
        const made = (await response.json()) as { id: string; password: string };
        return { id: made.id, password: made.password };
      }),
    setRole: async (id, role) =>
      result(await call(`/users/${segment(id)}/role`, 'PUT', { role }), none),
    setDisabled: async (id, disabled) =>
      result(await call(`/users/${segment(id)}/disabled`, 'PUT', { disabled }), none),
    resetPassword: async (id) =>
      result(
        await call(`/users/${segment(id)}/password`, 'POST', {}),
        async (response) => ((await response.json()) as { password: string }).password,
      ),
    loginLink: async (id) =>
      result(
        await call(`/users/${segment(id)}/login-link`, 'POST'),
        async (response) => (await response.json()) as { url: string; expires: string },
      ),
    impersonate: async (id, reason) =>
      result(
        await call(`/users/${segment(id)}/impersonate`, 'POST', { reason }),
        async (response) => (await response.json()) as { token: string; expires: string },
      ),
    identities: async (id) => json<AdminIdentity[]>(await call(`/users/${segment(id)}/identities`)),
    unlink: async (id, provider, subject) =>
      result(
        await call(
          `/users/${segment(id)}/identities/${segment(provider)}/${segment(subject)}`,
          'DELETE',
        ),
        async (response) => ({
          stranded: ((await response.json()) as { stranded: string[] }).stranded.length > 0,
        }),
      ),

    friends: async (id) => json<AdminFriend[]>(await call(`/users/${segment(id)}/friends`)),
    makeFriends: async (a, b) => {
      const response = await call('/friendships', 'POST', { userA: a, userB: b });
      if (!response.ok) throw new SyncFailure('server', `server error ${response.status}`);
    },
    endFriendship: async (a, b) => {
      const response = await call(`/friendships/${segment(a)}/${segment(b)}`, 'DELETE');
      if (!response.ok && response.status !== 404) {
        throw new SyncFailure('server', `server error ${response.status}`);
      }
    },

    shared: async (id) => json<AdminShare[]>(await call(`/users/${segment(id)}/shared`)),
    handOver: async (from, to, ids) =>
      (
        await json<{ moved: number }>(
          await call(`/users/${segment(from)}/hand-over`, 'POST', ids ? { to, ids } : { to }),
        )
      ).moved,

    groups: async () => json<AdminGroup[]>(await call('/groups')),
    addGroup: async (name, offeredForSharing) =>
      result(await call('/groups', 'POST', { name, offeredForSharing }), none),
    updateGroup: async (id, change) =>
      result(await call(`/groups/${segment(id)}`, 'PATCH', change), none),
    deleteGroup: async (id) => {
      const response = await call(`/groups/${segment(id)}`, 'DELETE');
      if (!response.ok && response.status !== 404)
        throw new SyncFailure('server', `server error ${response.status}`);
    },
    setMember: async (groupId, accountId, member) => {
      const response = await call(
        `/groups/${segment(groupId)}/members/${segment(accountId)}`,
        member ? 'PUT' : 'DELETE',
      );
      if (!response.ok) throw new SyncFailure('server', `server error ${response.status}`);
    },

    settings: async () => json<ServerSettingsView>(await call('/settings')),
    saveSettings: async (values) => {
      const response = await call('/settings', 'PUT', { values });
      if (response.ok) return { ok: true, value: (await response.json()) as ServerSettingsView };
      if (response.status === 400 || response.status === 409) {
        const body = (await response.json()) as { message?: string };
        return { ok: false, message: body.message ?? `server error ${response.status}` };
      }
      throw new SyncFailure('server', `server error ${response.status}`);
    },
    restart: async () => {
      await call('/restart', 'POST');
    },
    providers: async () => json<AdminProvider[]>(await call('/providers')),
    unbindAll: async (provider) =>
      json<{ unbound: number; stranded: string[] }>(
        await call(`/providers/${segment(provider)}/unbind-all`, 'POST'),
      ),
    openMigrationWindow: async (provider, hours) =>
      (
        await json<{ until: string }>(
          await call(`/providers/${segment(provider)}/migration-window`, 'PUT', { hours }),
        )
      ).until,
    closeMigrationWindow: async (provider) => {
      await call(`/providers/${segment(provider)}/migration-window`, 'DELETE');
    },
    pending: async () => json<PendingSignIn[]>(await call('/pending-signins')),
    approve: async (provider, subject) => {
      const response = await call(
        `/pending-signins/${segment(provider)}/${segment(subject)}/approve`,
        'POST',
      );
      if (!response.ok && response.status !== 404)
        throw new SyncFailure('server', `server error ${response.status}`);
    },
    dismiss: async (provider, subject) => {
      await call(`/pending-signins/${segment(provider)}/${segment(subject)}`, 'DELETE');
    },
  };
}
