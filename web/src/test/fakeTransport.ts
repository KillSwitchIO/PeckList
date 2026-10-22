// A SyncTransport over the in-memory server, with accounts and a switch to go offline.
import type { UserStats } from '../ports/stats.ts';
import { CURRENT_SCHEMA_VERSION } from '../core/migrations.ts';
import {
  SyncFailure,
  type Account,
  type ChangeEvent,
  type AccountApi,
  type FriendsApi,
  type ProfilePreview,
  type ServerInfo,
  type SignInMethods,
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
  signIn: { providers: { name: string; displayName: string }[]; localLogin: boolean } = {
    providers: [],
    localLogin: true,
  };
  schemaVersion = CURRENT_SCHEMA_VERSION;
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

  signInOptions(returnUrl: string) {
    this.check();
    const { providers, localLogin } = this.backend.signIn;
    return Promise.resolve({
      localLogin,
      providers: providers.map((provider) => ({
        ...provider,
        url: `/auth/oidc/${provider.name}/login?returnUrl=${encodeURIComponent(returnUrl)}`,
      })),
    });
  }

  login(username: string, password: string) {
    this.check();
    const found = this.backend.accounts.get(username);
    if (!found || found.password !== password) return Promise.resolve({ kind: 'invalid' as const });
    this.session = username;
    return Promise.resolve({ kind: 'ok' as const, account: found.account });
  }

  logout() {
    this.session = null;
    return Promise.resolve();
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
