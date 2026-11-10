// A SyncTransport over the in-memory server, with accounts and a switch to go offline.
import type { UserStats } from '../ports/stats.ts';
import type { Snooze } from '../core/reminders.ts';
import { CURRENT_SCHEMA_VERSION } from '../core/migrations.ts';
import {
  SyncFailure,
  type Account,
  type AccountEmail,
  type ClientReport,
  type CrashChoice,
  type CrashReportDraft,
  type TelemetryApi,
  type PasskeyInfo,
  type ChangeEvent,
  type AccountApi,
  type FileApi,
  type FriendsApi,
  type HistoryApi,
  type UpdatesApi,
  type ApiKeyInfo,
  type ApiKeysApi,
  type HistoryEntry,
  type NotificationsApi,
  type PushApi,
  type ReminderPress,
  type RemindersApi,
  type ServerNotification,
  type ProfilePreview,
  type DemoInfo,
  type ServerInfo,
  type SignInMethods,
  type ResetOutcome,
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
  /** The server answers every upload "later" (its daily allowance is used up). */
  uploadsWait = false;
  readonly accounts = new Map<string, FakeAccount>();
  /** Ids the server sets aside when pushed (as the real one does a malformed change), with why. */
  readonly invalid = new Map<string, 'invalid_change' | 'clock_drift'>();
  /** No PUBLIC_URL on a public name: friend codes come without a link (S16). */
  noLinks = false;
  /** The server's time sent with every sync (ms since epoch); null sends none. */
  serverTime: number | null = null;
  /** Each person's snoozes (audit B3), by username. */
  readonly snoozes = new Map<string, Snooze[]>();
  /** Dismiss and Snooze presses the server heard, with whose. */
  readonly reminderPresses: (ReminderPress & { username: string })[] = [];
  /** The server's clock for a snooze's time (ms since epoch). */
  now: () => number = () => Date.now();
  /** Presses and the snooze list answer as an unreachable server would. */
  failReminderPresses = false;
  failSnoozes = false;

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
    providers: { name: string; displayName: string; preset?: string | null }[];
    localLogin: boolean;
    registration?: 'open' | 'invite' | 'closed';
  } = {
    providers: [],
    localLogin: true,
  };
  /** Where signing out sends the browser next (a provider's end-session address), if anywhere. */
  signOutRedirect: string | null = null;
  /** The sign-in page offers "Forgot your password?" (PL-122). */
  passwordReset = false;
  /** Whether the server sends email at all. */
  mailWorks = true;
  /** Each account's email, by username. */
  readonly emails = new Map<string, { email: string; confirmed: boolean }>();
  /** Reset links that still work: token to username. */
  readonly resetLinks = new Map<string, string>();
  /** What the server emailed: to whom, and what. */
  readonly sentMail: { to: string; kind: 'reset' | 'confirm' }[] = [];
  /** The sign-in page offers passkeys (PL-123). */
  passkeysOn = false;
  /** Whether the server sends its daily usage report (PL-116); off by default, as in tests. */
  telemetryOn = false;
  /** Each person's usage choice, by username. */
  readonly shareUsage = new Map<string, boolean>();
  /** The usage reports devices sent. */
  readonly usageReports: ClientReport[] = [];
  /** Whether the server takes crash reports (`CRASH_REPORTS`). */
  crashReportsOn = false;
  /** Each person's crash report choice, by username. */
  readonly crashChoice = new Map<string, CrashChoice>();
  /** The crash reports sent. */
  readonly crashes: CrashReportDraft[] = [];
  /** Passkeys by credential id: whose, and as listed. */
  readonly passkeys = new Map<string, { username: string; info: PasskeyInfo }>();

  passkeysOf(username: string): PasskeyInfo[] {
    return [...this.passkeys.values()]
      .filter((each) => each.username === username)
      .map((each) => each.info);
  }

  /** The email view of an account, as `/api/account/email` answers. */
  emailOf(username: string, sent?: boolean): AccountEmail {
    const kept = this.emails.get(username);
    return {
      email: kept?.email ?? null,
      confirmed: kept?.confirmed ?? false,
      mailWorks: this.mailWorks,
      ...(sent === undefined ? {} : { sent }),
    };
  }
  /** Invite links that still work: token to the uses left. */
  readonly invites = new Map<string, number>();
  schemaVersion = CURRENT_SCHEMA_VERSION;
  /** Each account's notifications, by username, newest first (tests add them). */
  readonly notifications = new Map<string, ServerNotification[]>();
  /** Each task's history, newest first (tests add them). */
  readonly history = new Map<string, HistoryEntry[]>();
  /** Each account's API keys, by username (the fake keeps them as listed). */
  readonly apiKeys = new Map<string, ApiKeyInfo[]>();
  /** The version the server says it runs. */
  serverVersion = '0.1.0';
  /** What a demo server (`DEMO_MODE`) tells the app; null on an ordinary one. */
  demo: DemoInfo | null = null;
  /** The newest release the server knows of (tests set it). */
  latestRelease: { version: string; url: string } | null = null;
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
      if (this.backend.uploadsWait) return Promise.resolve('later' as const);
      this.backend.files.set(sha256, file);
      return Promise.resolve('stored' as const);
    },
    download: (sha256) => Promise.resolve(this.backend.files.get(sha256) ?? null),
  };

  /** Admin actions; tests that need them put a stand-in here. */
  admin?: AdminApi;

  readonly telemetry: TelemetryApi = {
    status: () => Promise.resolve(this.usageStatus()),
    choose: (choice) => {
      const name = this.current()?.account.username;
      if (name && choice.shareUsage !== undefined)
        this.backend.shareUsage.set(name, choice.shareUsage);
      if (name && choice.crashReports) {
        this.backend.crashChoice.set(name, choice.crashReports);
        if (choice.crashReports === 'never') this.backend.shareUsage.set(name, false);
      }
      return Promise.resolve(this.usageStatus());
    },
    crash: (report) => {
      this.backend.crashes.push(report);
      return Promise.resolve();
    },
    report: (report) => {
      this.backend.usageReports.push(report);
      return Promise.resolve();
    },
  };

  private usageStatus() {
    const name = this.current()?.account.username ?? '';
    return {
      enabled: this.backend.telemetryOn,
      shareUsage: this.backend.shareUsage.get(name) ?? true,
      crashReports: this.backend.crashChoice.get(name) ?? ('ask' as const),
      crashReportsEnabled: this.backend.crashReportsOn,
    };
  }

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
    passkeys: () => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      return Promise.resolve({
        available: this.backend.passkeysOn,
        password: found.password !== '',
        passkeys: this.backend.passkeysOf(found.account.username),
      });
    },
    passkeyOptions: () =>
      Promise.resolve({
        ceremony: 'register-1',
        options: {
          challenge: 'AAAA',
          rp: { id: 'localhost', name: 'PeckList' },
          user: { id: 'dXNlcg', name: this.current()?.account.username ?? '', displayName: '' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          excludeCredentials: [],
        },
      }),
    addPasskey: (_ceremony, credential, name) => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      const id = (credential as { id: string }).id;
      const info = {
        id,
        name: name || 'Passkey',
        createdAt: '2026-11-04T09:00:00Z',
        lastUsedAt: null,
        synced: true,
      };
      this.backend.passkeys.set(id, { username: found.account.username, info });
      return Promise.resolve(info);
    },
    renamePasskey: (id, name) => {
      const kept = this.backend.passkeys.get(id);
      if (kept) kept.info = { ...kept.info, name };
      return Promise.resolve();
    },
    removePasskey: (id) => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      if (found.password === '' && this.backend.passkeysOf(found.account.username).length <= 1) {
        return Promise.resolve('last-way-in' as const);
      }
      this.backend.passkeys.delete(id);
      return Promise.resolve('ok' as const);
    },
    removePassword: (current) => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      if (this.backend.passkeysOf(found.account.username).length === 0)
        return Promise.resolve('last-way-in' as const);
      if (found.password !== current) return Promise.resolve('wrong-password' as const);
      found.password = '';
      return Promise.resolve('ok' as const);
    },
    email: () => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      return Promise.resolve(this.backend.emailOf(found.account.username));
    },
    setEmail: (email) => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      const name = found.account.username;
      const typed = email.trim().toLowerCase();
      if (typed === '') {
        this.backend.emails.delete(name);
        return Promise.resolve(this.backend.emailOf(name));
      }
      if (!/^[^@\s]+@[^@\s]+$/.test(typed)) return Promise.resolve('invalid' as const);
      if (this.backend.emails.get(name)?.email === typed)
        return Promise.resolve(this.backend.emailOf(name));
      this.backend.emails.set(name, { email: typed, confirmed: false });
      if (!this.backend.mailWorks) return Promise.resolve(this.backend.emailOf(name));
      this.backend.sentMail.push({ to: typed, kind: 'confirm' });
      return Promise.resolve(this.backend.emailOf(name, true));
    },
    resendConfirmation: () => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      const kept = this.backend.emails.get(found.account.username);
      if (kept) this.backend.sentMail.push({ to: kept.email, kind: 'confirm' });
      return Promise.resolve(this.backend.emailOf(found.account.username, true));
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

  readonly reminders: RemindersApi = {
    snoozes: () => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      if (this.backend.failSnoozes) return Promise.reject(new SyncFailure('offline', 'no answer'));
      return Promise.resolve([...(this.backend.snoozes.get(found.account.username) ?? [])]);
    },
    act: (press) => {
      const found = this.current();
      if (!found) return Promise.reject(new SyncFailure('signed-out', 'signed out'));
      if (this.backend.failReminderPresses) {
        return Promise.reject(new SyncFailure('offline', 'no answer'));
      }
      const username = found.account.username;
      this.backend.reminderPresses.push({ ...press, username });
      if (press.action === 'snooze') {
        // That many minutes on (ten unless said), on the minute, as the real server keeps it.
        const later = this.backend.now() + (press.minutes ?? 10) * 60_000;
        const at = Math.floor(later / 60_000) * 60_000;
        const mine = this.backend.snoozes.get(username) ?? [];
        this.backend.snoozes.set(username, [...mine, { taskId: press.taskId, at }]);
      }
      return Promise.resolve();
    },
  };

  readonly apiKeys: ApiKeysApi = {
    list: () => Promise.resolve([...(this.backend.apiKeys.get(this.session ?? '') ?? [])]),
    create: (input) => {
      if (!input.name.trim()) return Promise.resolve({ problem: 'An API key needs a name.' });
      const mine = this.backend.apiKeys.get(this.session ?? '') ?? [];
      const id = `k${mine.length + 1}`;
      const key: ApiKeyInfo = {
        id,
        name: input.name.trim(),
        scopes: input.scopes,
        createdAt: '2026-10-29T10:00:00.000Z',
        expiresAt: input.expiresAt,
        lastUsedAt: null,
        revokedAt: null,
      };
      this.backend.apiKeys.set(this.session ?? '', [key, ...mine]);
      return Promise.resolve({ key, token: `pl_${id}_secretsecret` });
    },
    revoke: (id) => {
      const mine = this.backend.apiKeys.get(this.session ?? '') ?? [];
      this.backend.apiKeys.set(
        this.session ?? '',
        mine.map((key) =>
          key.id === id ? { ...key, revokedAt: '2026-10-29T11:00:00.000Z' } : key,
        ),
      );
      return Promise.resolve();
    },
  };

  readonly updates: UpdatesApi = {
    latest: () =>
      Promise.resolve({
        enabled: true,
        current: this.backend.serverVersion,
        latest: this.backend.latestRelease?.version ?? null,
        releaseUrl: this.backend.latestRelease?.url ?? null,
      }),
  };

  readonly history: HistoryApi = {
    task: (taskId) => Promise.resolve([...(this.backend.history.get(taskId) ?? [])]),
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
        link: this.backend.noLinks
          ? null
          : `https://pecklist.test/f/${(this.session ?? '').toUpperCase()}`,
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
      name: 'pecklist',
      version: this.backend.serverVersion,
      schemaVersion: this.backend.schemaVersion,
      ...(this.backend.demo ? { demo: this.backend.demo } : {}),
    });
  }

  me(): Promise<Account | null> {
    this.check();
    return Promise.resolve(this.current()?.account ?? null);
  }

  signInOptions(returnUrl: string, invite?: string) {
    // Offline, a request rejects (the HTTP transport's promise does), it does not throw.
    if (this.offline) return Promise.reject(new SyncFailure('offline', 'offline'));
    const { providers, localLogin, registration } = this.backend.signIn;
    const withInvite = invite ? `&invite=${encodeURIComponent(invite)}` : '';
    return Promise.resolve({
      localLogin,
      registration: registration ?? 'closed',
      passwordReset: this.backend.passwordReset,
      passkeys: this.backend.passkeysOn,
      providers: providers.map((provider) => ({
        ...provider,
        url: `/auth/oidc/${provider.name}/login?returnUrl=${encodeURIComponent(returnUrl)}${withInvite}`,
      })),
    });
  }

  passkeySignInOptions() {
    this.check();
    if (!this.backend.passkeysOn) return Promise.resolve(null);
    return Promise.resolve({
      ceremony: 'sign-in-1',
      options: { challenge: 'AAAA', allowCredentials: [] },
    });
  }

  passkeySignIn(_ceremony: string, credential: unknown) {
    this.check();
    const kept = this.backend.passkeys.get((credential as { id?: string }).id ?? '');
    const found = kept ? this.backend.accounts.get(kept.username) : undefined;
    if (!kept || !found) return Promise.resolve({ kind: 'invalid' as const });
    this.session = kept.username;
    return Promise.resolve({ kind: 'ok' as const, account: found.account });
  }

  forgotPassword(login: string) {
    this.check();
    if (!this.backend.passwordReset) return Promise.resolve('unavailable' as const);
    const typed = login.trim().toLowerCase();
    for (const [username, kept] of this.backend.emails) {
      if (!kept.confirmed || (username !== typed && kept.email !== typed)) continue;
      this.backend.resetLinks.set(`reset-${username}`, username);
      this.backend.sentMail.push({ to: kept.email, kind: 'reset' });
    }
    return Promise.resolve('sent' as const);
  }

  checkResetLink(token: string) {
    this.check();
    return Promise.resolve(this.backend.resetLinks.get(token) ?? null);
  }

  resetPassword(token: string, password: string): Promise<ResetOutcome> {
    this.check();
    const username = this.backend.resetLinks.get(token);
    const found = username ? this.backend.accounts.get(username) : undefined;
    if (!username || !found) return Promise.resolve({ kind: 'expired' });
    if (password.length < 12) return Promise.resolve({ kind: 'too-short' });
    found.password = password;
    this.backend.resetLinks.delete(token);
    return Promise.resolve({ kind: 'ok', username });
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
    if (this.offline) return Promise.reject(new SyncFailure('offline', 'offline'));
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

  sync(request: Parameters<SyncTransport['sync']>[0]): ReturnType<SyncTransport['sync']> {
    this.check();
    const found = this.current();
    if (!found) throw new SyncFailure('signed-out', 'signed out');
    if (found.account.mustChangePassword) throw new SyncFailure('password-change', 'change it');
    if (request.schemaVersion !== this.backend.schemaVersion) {
      throw new SyncFailure('schema', 'schema mismatch', this.backend.schemaVersion);
    }
    // From a device that has not seen a restore yet: nothing written, the new epoch said (audit C6).
    if (request.epoch && this.backend.epoch && request.epoch !== this.backend.epoch) {
      return Promise.resolve({
        cursor: 0,
        changes: [],
        more: false,
        revoked: [],
        rejected: [],
        corrections: [],
        epoch: this.backend.epoch,
      });
    }
    // A copy, as over the wire.
    const before = this.backend.server.calls;
    const seqBefore = Math.max(0, ...[...this.backend.server.rows.values()].map((row) => row.seq));
    const sent = structuredClone(request);
    const invalid = sent.changes.flatMap((change, index) => {
      const code = this.backend.invalid.get(change.entity.id);
      return code ? [{ index, id: change.entity.id, code, reason: code }] : [];
    });
    const response = this.backend.server.sync(found.account.id, {
      ...sent,
      changes: sent.changes.filter((change) => !this.backend.invalid.has(change.entity.id)),
    });
    const seqAfter = Math.max(0, ...[...this.backend.server.rows.values()].map((row) => row.seq));
    if (seqAfter > seqBefore && this.backend.server.calls > before) {
      for (const listener of this.backend.listeners) {
        if (listener.username === found.account.username) {
          listener.onChange({ cursor: seqAfter, source: this.device });
        }
      }
    }
    const serverTime = this.backend.serverTime;
    return Promise.resolve({
      ...response,
      epoch: this.backend.epoch,
      invalid,
      ...(serverTime === null ? {} : { serverTime: new Date(serverTime).toISOString() }),
    });
  }
}
