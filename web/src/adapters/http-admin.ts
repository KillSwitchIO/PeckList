import type {
  AccountRole,
  AdminApi,
  AdminFriend,
  AdminGroup,
  AdminIdentity,
  AdminInvite,
  InviteList,
  AdminProvider,
  AdminShare,
  AdminRefusal,
  AdminResult,
  AdminUser,
  AuditPage,
  AuditQuery,
  BackupFile,
  LoggingView,
  RestoreSource,
  UserRestoreResult,
  OidcOverview,
  PendingSignIn,
  ServerSettingsView,
} from '../ports/admin.ts';
import type { ServerStats } from '../ports/stats.ts';
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
  taken: 'linked-elsewhere',
  registration_closed: 'registration-closed',
  set_by_settings: 'set-by-settings',
};

/** `/api/admin` over fetch, with the session cookie (same origin). */
/** The query string for an audit query: only the filters that are set. */
function auditParams(query: AuditQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

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
  /** A restore's form: the file or the backup's name, and whose data when it matters. */
  const upload = async (path: string, source: RestoreSource, username?: string) => {
    const form = new FormData();
    if ('file' in source) form.append('file', source.file);
    else form.append('backup', source.backup);
    if (username) form.append('username', username);
    try {
      const response = await fetcher(`${base}/api/admin${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      if (response.status === 401) throw new SyncFailure('signed-out', 'not signed in');
      return response;
    } catch (error) {
      if (error instanceof SyncFailure) throw error;
      throw new SyncFailure('offline', error instanceof Error ? error.message : String(error));
    }
  };
  /** The server's explanation of a refused restore. */
  const reason = async (response: Response): Promise<string> => {
    if (response.status !== 400) throw new SyncFailure('server', `server error ${response.status}`);
    return (
      ((await response.json()) as { message?: string }).message ??
      'not a backup this server can use'
    );
  };
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
    deleteUser: async (id) =>
      result(
        await call(`/users/${segment(id)}`, 'DELETE'),
        async (response) => ((await response.json()) as { removedAt: string }).removedAt,
      ),
    linkIdentity: async (id, provider, subject) =>
      result(await call(`/users/${segment(id)}/identities`, 'POST', { provider, subject }), none),
    restoreAccount: async (id) => result(await call(`/users/${segment(id)}/restore`, 'POST'), none),
    removeNow: async (id) => result(await call(`/users/${segment(id)}/remove-now`, 'POST'), none),
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
    invites: async () => json<InviteList>(await call('/invites')),
    createInvite: async ({ days, uses, note }) =>
      result(
        await call('/invites', 'POST', { days, uses, anyNumber: uses === null, note }),
        async (response) => (await response.json()) as { url: string; invite: AdminInvite },
      ),
    revokeInvite: async (id) => {
      const response = await call(`/invites/${segment(id)}`, 'DELETE');
      if (!response.ok && response.status !== 404) {
        throw new SyncFailure('server', `server error ${response.status}`);
      }
    },
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

    backups: async () => json<BackupFile[]>(await call('/backups')),
    backUpNow: async () => (await json<{ name: string }>(await call('/backups', 'POST'))).name,
    backupUrl: (name) => `${base}/api/admin/backups/${segment(name)}`,
    exportUrl: () => `${base}/api/admin/export`,
    userExportUrl: (id) => `${base}/api/admin/users/${segment(id)}/export`,
    restoreUser: async (source, username) => {
      const response = await upload('/users/restore', source, username);
      if (response.ok) return { ok: true, value: (await response.json()) as UserRestoreResult };
      return { ok: false, message: await reason(response) };
    },
    restoreServer: async (source) => {
      const response = await upload('/restore', source);
      if (response.ok) return { ok: true };
      return { ok: false, message: await reason(response) };
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
    logging: async () => json<LoggingView>(await call('/logging')),
    debugDumpUrl: () => `${base}/api/admin/debug-dump`,
    audit: async (query) => json<AuditPage>(await call(`/audit?${auditParams(query)}`)),
    stats: async () => json<ServerStats>(await call('/stats')),
    setup: async () => json<{ done: boolean }>(await call('/setup')),
    finishSetup: async () => {
      const response = await call('/setup', 'PUT', { done: true });
      if (!response.ok) throw new SyncFailure('server', `server error ${response.status}`);
    },
    auditCsvUrl: (query) => `${base}/api/admin/audit.csv?${auditParams(query)}`,
    providers: async () => json<AdminProvider[]>(await call('/providers')),
    oidc: async () => json<OidcOverview>(await call('/oidc')),
    saveMapping: async (provider, providerUsername, accountId) =>
      result(await call('/oidc/mappings', 'PUT', { provider, providerUsername, accountId }), none),
    removeMapping: async (provider, providerUsername) => {
      const response = await call(
        `/oidc/mappings/${segment(provider)}/${segment(providerUsername)}`,
        'DELETE',
      );
      if (response.status === 404) return { ok: true, value: undefined };
      return result(response, none);
    },
    moveIdentity: async (provider, subject, accountId) =>
      result(
        await call(`/oidc/identities/${segment(provider)}/${segment(subject)}/account`, 'PUT', {
          accountId,
        }),
        async (response) => ({
          stranded: ((await response.json()) as { stranded: string[] }).stranded,
        }),
      ),
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
