// A SyncTransport over the in-memory server, with accounts and a switch to go offline.
import type { UserStats } from '../ports/stats.ts';
import { CURRENT_SCHEMA_VERSION } from '../core/migrations.ts';
import {
  SyncFailure,
  type Account,
  type ChangeEvent,
  type AccountApi,
  type FileApi,
  type FriendsApi,
  type NotificationsApi,
  type PushApi,
  type ServerNotification,
  type ProfilePreview,
  type ServerInfo,
  type SignInMethods,
  type SignUpOutcome,
  type SyncTransport,
} from '../ports/sync.ts';
import type { AdminApi } from '../ports/admin.ts';
import { FakeSyncServer } from './fakeSyncServer.ts';

export interface FakeAccount {
  account: Account;
  password: string;
}

/** Shared by every device in a test: the server and its accounts. */
export class FakeBackend {
  readonly server = new FakeSyncServer();
  /** Files the server holds, by SHA-256. */
  readonly files = new Map<string, Blob>();
  /** The largest file it takes, in bytes. */
  maxFileBytes = 25 * 1024 * 1024;
  readonly accounts = new Map<string, FakeAccount>();

  /** An account's numbers as the server would count them: its live tasks by status. */
  stats(id: string, username: string): UserStats {
    const tasks = [...this.server.rows.values()]
      .filter((row) => row.change.collection === 'tasks')
      .map(
        (row) =>
          row.change.entity as { status?: string; deletedAt?: string | null; createdBy?: string },
      )
      .filter((task) => !task.deletedAt);
    const closed = tasks.filter(
      (task) => task.status === 'done' || task.status === 'wontdo',
    ).length;
    return {
      id,
      username,
      openTasks: tasks.length - closed,
      closedTasks: closed,
      closedThisMonth: closed,
      createdTasks: tasks.filter((task) => task.createdBy === id).length,
      lists: 0,
      sharedLists: 0,
      storageBytes: 0,
      devices: 1,
      lastActive: null,
      closedByMonth: [{ month: '2026-10', closed }],
    };
  }
  /** What sync responses say about the server data's life; change it to act out a restore. */
  epoch: string | null = 'epoch-1';
  /** Each account's linked provider accounts, by username. */
  readonly identities = new Map<string, SignInMethods['identities']>();
  /** What `/auth/providers` answers. */
  signIn: {
    providers: { name: string; displayName: string }[];
    localLogin: boolean;
    registration?: 'open' | 'invite' | 'closed';
  } = {
    providers: [],
    localLogin: true,
  };
  /** Where signing out sends the browser next (a provider's end-session address), if anywhere. */
  signOutRedirect: string | null = null;
  /** Invite links that still work: token to the uses left. */
  readonly invites = new Map<string, number>();
  schemaVersion = CURRENT_SCHEMA_VERSION;
  /** Each account's notifications, by username, newest first (tests add them). */
  readonly notifications = new Map<string, ServerNotification[]>();
  /** Event listeners of every device, by account username. */
  readonly listeners = new Set<{ username: string; onChange: (change: ChangeEvent) => void }>();

  addAccount(username: string, password: string, extra: Partial<Account> = {}): Account {
    const account: Account = {
      // A valid ULID, one per account.
      id: `01JBACCT${String(this.accounts.size + 1).padStart(18, '0')}`,
      username,
      role: 'user',
      mustChangePassword: false,
      authMode: 'local',
      ...extra,
    };
    this.accounts.set(username, { account, password });
    return account;
  }

  /** One device's connection (its own session). */
  device(): FakeTransport {
    return new FakeTransport(this);
  }
}

export class FakeTransport implements SyncTransport {
  offline = false;
  session: string | null = null;

  /** This device's id, sent with its syncs. */
  device: string | null = null;

  constructor(private readonly backend: FakeBackend) {}

  private previewOf(found: FakeAccount): ProfilePreview {
    return {
      userId: found.account.id,
      username: found.account.username,
      displayName: found.account.username,
      handle: found.account.username,
      avatarColor: '#A7C7E7',
      memberSince: '2026-10-01T08:00:00.000Z',
      self: found.account.username === this.session,
      friendship: null,
    };
  }

  /** An empty password stands for an account that signs in only through a provider. */
  readonly files: FileApi = {
    has: (sha256) => {
      if (this.offline) return Promise.reject(new SyncFailure('offline', 'offline'));
      return Promise.resolve(this.backend.files.has(sha256));
    },
    upload: (sha256, file) => {
      if (this.offline) return Promise.reject(new SyncFailure('offline', 'offline'));
      if (file.size > this.backend.maxFileBytes) return Promise.resolve('too-large' as const);
      this.backend.files.set(sha256, file);
      return Promise.resolve('stored' as const);
    },
    download: (sha256) => Promise.resolve(this.backend.files.get(sha256) ?? null),
  };

  /** Admin actions; tests that need them put a stand-in here. */
  admin?: AdminApi;

  readonly account: AccountApi = {
    signInMethods: () => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      const linked = this.backend.identities.get(found.account.username) ?? [];
      return Promise.resolve({
        password: found.password !== '',
        identities: linked,
        canLink: this.backend.signIn.providers
          .filter((provider) => !linked.some((each) => each.provider === provider.name))
          .map((provider) => ({ ...provider, url: `/auth/oidc/${provider.name}/link` })),
      });
    },
    unlink: (provider, subject) => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      const linked = this.backend.identities.get(found.account.username) ?? [];
      if (found.password === '' && linked.length <= 1)
        return Promise.resolve('last-way-in' as const);
      this.backend.identities.set(
        found.account.username,
        linked.filter((each) => each.provider !== provider || each.subject !== subject),
      );
      return Promise.resolve('ok' as const);
    },
    stats: () => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      return Promise.resolve(this.backend.stats(found.account.id, found.account.username));
    },
  };

  /** Push subscriptions the fake server holds, by endpoint: the username. */
  readonly pushed = new Map<string, string>();
  readonly push: PushApi = {
    key: () => Promise.resolve('BFAKEKEY'),
    subscribe: (subscription) => {
      this.pushed.set(subscription.endpoint, this.session ?? '');
      return Promise.resolve();
    },
    unsubscribe: (endpoint) => {
      this.pushed.delete(endpoint);
      return Promise.resolve();
    },
  };

  readonly notifications: NotificationsApi = {
    list: () => {
      const mine = this.backend.notifications.get(this.session ?? '') ?? [];
      return Promise.resolve({
        items: mine.map((each) => ({ ...each })),
        unread: mine.filter((each) => !each.read).length,
      });
    },
    read: (ids) => {
      for (const each of this.backend.notifications.get(this.session ?? '') ?? []) {
        if (ids === null || ids.includes(each.id)) each.read = true;
      }
      return Promise.resolve();
    },
    clear: (ids) => {
      const mine = this.backend.notifications.get(this.session ?? '') ?? [];
      this.backend.notifications.set(
        this.session ?? '',
        ids === null ? [] : mine.filter((each) => !ids.includes(each.id)),
      );
      return Promise.resolve();
    },
  };

  /** Friend codes are the username in capitals here; accepting only records the request. */
  readonly accepted: string[] = [];
  readonly friends: FriendsApi = {
    code: () =>
      Promise.resolve({
        code: (this.session ?? '').toUpperCase(),
        link: `https://punchlist.test/f/${(this.session ?? '').toUpperCase()}`,
      }),
    preview: (code) => {
      const found = this.backend.accounts.get(code.toLowerCase());
      return Promise.resolve(found ? this.previewOf(found) : null);
    },
    accept: (code) => {
      this.accepted.push(code);
      return Promise.resolve(this.backend.accounts.has(code.toLowerCase()) ? 'F-ACCEPTED' : null);
    },
    lookup: (query) => {
      const found = this.backend.accounts.get(query.toLowerCase());
      return Promise.resolve(found ? this.previewOf(found) : null);
    },
  };

  events(onChange: (change: ChangeEvent) => void) {
    const listener = { username: this.session ?? '', onChange };
    this.backend.listeners.add(listener);
    return () => {
      this.backend.listeners.delete(listener);
    };
  }

  private check() {
    if (this.offline) throw new SyncFailure('offline', 'offline');
  }

  private current(): FakeAccount | null {
    return this.session ? (this.backend.accounts.get(this.session) ?? null) : null;
  }

  info(): Promise<ServerInfo | null> {
    this.check();
    return Promise.resolve({
      name: 'punchlist',
      version: '0.1.0',
      schemaVersion: this.backend.schemaVersion,
    });
  }

  me(): Promise<Account | null> {
    this.check();
    return Promise.resolve(this.current()?.account ?? null);
  }

  signInOptions(returnUrl: string, invite?: string) {
    this.check();
    const { providers, localLogin, registration } = this.backend.signIn;
    const withInvite = invite ? `&invite=${encodeURIComponent(invite)}` : '';
    return Promise.resolve({
      localLogin,
      registration: registration ?? 'closed',
      providers: providers.map((provider) => ({
        ...provider,
        url: `/auth/oidc/${provider.name}/login?returnUrl=${encodeURIComponent(returnUrl)}${withInvite}`,
      })),
    });
  }

  checkInvite(token: string) {
    this.check();
    const works = (this.backend.invites.get(token) ?? 0) > 0;
    return Promise.resolve(works ? { expires: '2026-10-30T08:00:00Z' } : null);
  }

  signUp(username: string, password: string, invite?: string): Promise<SignUpOutcome> {
    this.check();
    const registration = this.backend.signIn.registration ?? 'closed';
    if (registration === 'closed') return Promise.resolve({ kind: 'closed' });
    if (!invite && registration !== 'open') return Promise.resolve({ kind: 'closed' });
    const name = username.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(name)) {
      return Promise.resolve({ kind: 'invalid-username' });
    }
    if (password.length < 12) return Promise.resolve({ kind: 'too-short' });
    if (this.backend.accounts.has(name)) return Promise.resolve({ kind: 'username-taken' });
    if (invite) {
      const left = this.backend.invites.get(invite) ?? 0;
      if (left < 1) return Promise.resolve({ kind: 'invite-invalid' });
      this.backend.invites.set(invite, left - 1);
    }
    const account = this.backend.addAccount(name, password);
    this.session = name;
    return Promise.resolve({ kind: 'ok', account });
  }

  login(username: string, password: string) {
    this.check();
    if (!this.backend.signIn.localLogin) return Promise.resolve({ kind: 'disabled' as const });
    const found = this.backend.accounts.get(username);
    if (!found || found.password !== password) return Promise.resolve({ kind: 'invalid' as const });
    this.session = username;
    return Promise.resolve({ kind: 'ok' as const, account: found.account });
  }

  logout() {
    this.session = null;
    const redirect = this.backend.signOutRedirect;
    return Promise.resolve(redirect ? { redirect } : undefined);
  }

  changePassword(current: string, next: string) {
    this.check();
    const found = this.current();
    if (!found) throw new SyncFailure('signed-out', 'signed out');
    if (found.password !== current) return Promise.resolve({ kind: 'wrong-password' as const });
    if (next.length < 12) return Promise.resolve({ kind: 'too-short' as const });
    found.password = next;
    found.account = { ...found.account, mustChangePassword: false };
    return Promise.resolve({ kind: 'ok' as const, account: found.account });
  }

  sync(request: Parameters<SyncTransport['sync']>[0]) {
    this.check();
    const found = this.current();
    if (!found) throw new SyncFailure('signed-out', 'signed out');
    if (found.account.mustChangePassword) throw new SyncFailure('password-change', 'change it');
    if (request.schemaVersion !== this.backend.schemaVersion) {
      throw new SyncFailure('schema', 'schema mismatch', this.backend.schemaVersion);
    }
    // A copy, as over the wire.
    const before = this.backend.server.calls;
    const seqBefore = Math.max(0, ...[...this.backend.server.rows.values()].map((row) => row.seq));
    const response = this.backend.server.sync(found.account.id, structuredClone(request));
    const seqAfter = Math.max(0, ...[...this.backend.server.rows.values()].map((row) => row.seq));
    if (seqAfter > seqBefore && this.backend.server.calls > before) {
      for (const listener of this.backend.listeners) {
        if (listener.username === found.account.username) {
          listener.onChange({ cursor: seqAfter, source: this.device });
        }
      }
    }
    return Promise.resolve({ ...response, epoch: this.backend.epoch });
  }
}
