import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import type {
  AccountRole,
  AdminApi,
  AdminGroup,
  AdminInvite,
  AdminUser,
  AuditEntry,
  AuditQuery,
  OidcMapping,
  PendingSignIn,
} from '../../ports/admin.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** The admin API in memory: just enough server behavior for the screens. */
function memoryAdmin(benId: string) {
  const user = (id: string, username: string, role: AccountRole = 'user'): AdminUser => ({
    id,
    username,
    role,
    disabled: false,
    createdAt: '2026-10-22T08:00:00Z',
    groups: [],
    hasPassword: true,
    mustChangePassword: false,
    providers: [],
  });
  const state = {
    users: [user(benId, 'ben', 'superadmin'), user('U2', 'sam')],
    groups: [] as AdminGroup[],
    friendships: [] as [string, string][],
    page: {} as Record<string, string>,
    restarted: false,
    telemetry: { installId: 'id-1', noticeSeen: false },
    /** Signed in as a plain admin: sign-in settings come locked, as the server sends them. */
    signInLocked: false,
    setupDone: true,
    backups: [] as { name: string; taken: string; size: number }[],
    restores: [] as { source: unknown; username: string | null }[],
    deleted: [] as string[],
    linked: [] as string[],
    handedOver: [] as { from: string; to: string; ids: string[] }[],
    window: null as string | null,
    /** Provider accounts: who they sign into. */
    identities: [
      { provider: 'pocket', subject: 'kim-sub-1', username: 'kim', accountId: 'U2' },
    ] as { provider: string; subject: string; username: string; accountId: string }[],
    mappings: [
      {
        provider: 'pocket',
        providerUsername: 'boss',
        accountId: benId,
        accountUsername: 'ben',
        source: 'settings',
        createdAt: null,
      },
    ] as OidcMapping[],
    registration: 'invite' as 'open' | 'invite' | 'closed',
    invites: [] as AdminInvite[],
    pending: [
      {
        provider: 'pocket',
        subject: 'kim-sub',
        username: 'kim',
        displayName: 'Kim Lee',
        email: 'kim@example.com',
        groups: ['family'],
        firstSeen: '2026-10-22T08:00:00Z',
        lastSeen: '2026-10-22T08:00:00Z',
      },
    ] as PendingSignIn[],
  };
  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
  const entry = (fields: Partial<AuditEntry> & Pick<AuditEntry, 'id' | 'type'>): AuditEntry => ({
    time: '2026-10-22T09:00:00Z',
    kind: 'event',
    outcome: 'ok',
    actorId: null,
    actorName: null,
    impersonatorId: null,
    impersonatorName: null,
    targetId: null,
    targetName: null,
    ip: '192.168.1.20',
    device: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/131.0',
    method: null,
    route: null,
    status: null,
    durationMs: null,
    requestId: '0HN1',
    detail: null,
    ...fields,
  });
  const audit = [
    entry({
      id: 'A3',
      type: 'admin.role-changed',
      actorName: 'ben',
      targetName: 'sam',
      detail: 'role admin',
    }),
    entry({
      id: 'A2',
      type: 'auth.sign-in',
      outcome: 'failed',
      targetName: 'sam',
      ip: '203.0.113.9',
    }),
    entry({ id: 'A1', type: 'auth.sign-in', actorName: 'ben', impersonatorName: null }),
    entry({
      id: 'R1',
      kind: 'access',
      type: 'request',
      actorName: 'ben',
      method: 'POST',
      route: '/api/sync',
      status: 200,
      durationMs: 23,
    }),
  ];
  const auditQueries: AuditQuery[] = [];
  const months = (last: number) =>
    Array.from({ length: 12 }, (_, index) => ({
      month: `${index < 2 ? 2025 : 2026}-${String(((index + 10) % 12) + 1).padStart(2, '0')}`,
      closed: index === 11 ? last : index,
    }));
  const personStats = (
    id: string,
    username: string,
    open: number,
    closed: number,
    lastActive: string | null,
  ) => ({
    id,
    username,
    openTasks: open,
    closedTasks: closed,
    closedThisMonth: 1,
    createdTasks: open + closed,
    lists: 3,
    sharedLists: 1,
    storageBytes: 1536,
    devices: 2,
    lastActive,
    closedByMonth: months(1),
  });
  const output = (name: string, destination: string, healthy: boolean) => ({
    name,
    destination,
    healthy,
    sent: healthy ? 120 : 0,
    dropped: healthy ? 0 : 35,
    failures: healthy ? 0 : 4,
    queued: 0,
    lastSent: null,
    lastFailure: null,
    lastError: healthy ? null : 'HttpRequestException: Connection refused (loki:3100)',
  });
  const settingsView = () => ({
    pendingRestart: Object.keys(state.page).length > 0,
    problem: null,
    settings: [
      {
        key: 'REGISTRATION',
        group: 'general',
        kind: 'choice' as const,
        choices: ['open', 'invite', 'closed'],
        default: 'invite',
        value: state.page.REGISTRATION ?? null,
        source: state.page.REGISTRATION ? ('page' as const) : ('default' as const),
        locked: state.signInLocked,
        saved: Boolean(state.page.REGISTRATION),
        live: false,
        superAdminOnly: true,
      },
      {
        key: 'SMTP_HOST',
        group: 'email',
        kind: 'text' as const,
        choices: null,
        default: null,
        value: state.page.SMTP_HOST ?? 'smtp.example.com',
        source: 'environment' as const,
        locked: false,
        saved: false,
        live: true,
        superAdminOnly: false,
      },
      {
        key: 'TELEMETRY',
        group: 'telemetry',
        kind: 'flag' as const,
        choices: null,
        default: 'true',
        value: state.page.TELEMETRY ?? null,
        source: state.page.TELEMETRY ? ('page' as const) : ('default' as const),
        locked: false,
        saved: Boolean(state.page.TELEMETRY),
        live: true,
        superAdminOnly: false,
      },
      {
        key: 'SNAPSHOT_KEEP',
        group: 'backups',
        kind: 'number' as const,
        choices: null,
        default: '14',
        value: '5',
        source: 'environment' as const,
        locked: true,
        saved: false,
        live: false,
      },
      {
        key: 'DB_CONNECTION_STRING',
        group: 'environment',
        kind: 'secret' as const,
        choices: null,
        default: null,
        value: '********',
        source: 'environment' as const,
        locked: true,
        saved: false,
        live: false,
      },
    ],
  });
  const api: AdminApi = {
    users: () => Promise.resolve(state.users.map((each) => ({ ...each }))),
    addUser: (username, role) => {
      if (state.users.some((each) => each.username === username)) {
        return Promise.resolve({ ok: false, reason: 'taken' });
      }
      state.users.push({
        ...user(`U${state.users.length + 1}`, username, role),
        mustChangePassword: true,
      });
      return ok({ id: 'new', password: 'generated-secret-1' });
    },
    setRole: (id, role) => {
      state.users = state.users.map((each) => (each.id === id ? { ...each, role } : each));
      return ok(undefined);
    },
    setDisabled: (id, disabled) => {
      state.users = state.users.map((each) => (each.id === id ? { ...each, disabled } : each));
      return ok(undefined);
    },
    resetPassword: () => ok('reset-secret-2'),
    loginLink: () => ok({ url: 'https://tasks.example.com/auth/link/abc', expires: '' }),
    invites: () =>
      Promise.resolve({ registration: state.registration, invites: [...state.invites] }),
    createInvite: ({ days, uses, note }) => {
      if (state.registration === 'closed') {
        return Promise.resolve({ ok: false as const, reason: 'registration-closed' as const });
      }
      const invite: AdminInvite = {
        id: `I${state.invites.length + 1}`,
        note: note || null,
        createdBy: 'ben',
        createdAt: '2026-10-23T08:00:00Z',
        expires: new Date(Date.UTC(2026, 9, 23 + days, 8)).toISOString(),
        maxUses: uses,
        uses: 0,
        usedBy: [],
      };
      state.invites.unshift(invite);
      return ok({ url: `https://tasks.example.com/join/token-${invite.id}`, invite });
    },
    revokeInvite: (id) => {
      state.invites = state.invites.filter((each) => each.id !== id);
      return Promise.resolve();
    },
    identities: () => Promise.resolve([]),
    impersonate: (_, reason) =>
      reason.trim().length < 3
        ? Promise.resolve({ ok: false as const, reason: 'reason-required' as const })
        : ok({ token: 'view-token', expires: '' }),
    unlink: () => ok({ stranded: false }),
    friends: (id) =>
      Promise.resolve(
        state.friendships
          .filter((pair) => pair.includes(id))
          .map((pair) => {
            const other = pair.find((each) => each !== id)!;
            const found = state.users.find((each) => each.id === other)!;
            return { userId: other, username: found.username, state: 'accepted' as const };
          }),
      ),
    makeFriends: (a, b) => {
      state.friendships.push([a, b]);
      return Promise.resolve();
    },
    endFriendship: (a, b) => {
      state.friendships = state.friendships.filter(
        (pair) => !(pair.includes(a) && pair.includes(b)),
      );
      return Promise.resolve();
    },
    shared: () =>
      Promise.resolve([
        { kind: 'list' as const, id: 'L1', name: 'Chores', people: 3 },
        { kind: 'group' as const, id: 'G9', name: 'Household', people: 4 },
      ]),
    handOver: (from, to, ids) => {
      state.handedOver.push({ from, to, ids: ids ?? [] });
      return Promise.resolve(ids?.length ?? 0);
    },
    groups: () =>
      Promise.resolve(state.groups.map((each) => ({ ...each, members: [...each.members] }))),
    addGroup: (name, offeredForSharing) => {
      state.groups.push({
        id: `G${state.groups.length + 1}`,
        name,
        offeredForSharing,
        createdAt: '',
        members: [],
      });
      return ok(undefined);
    },
    updateGroup: (id, change) => {
      state.groups = state.groups.map((each) => (each.id === id ? { ...each, ...change } : each));
      return ok(undefined);
    },
    deleteGroup: (id) => {
      state.groups = state.groups.filter((each) => each.id !== id);
      return Promise.resolve();
    },
    setMember: (groupId, accountId, member) => {
      const group = state.groups.find((each) => each.id === groupId)!;
      group.members = member
        ? [...group.members, { accountId, sources: ['manual'] }]
        : group.members.filter((each) => each.accountId !== accountId);
      return Promise.resolve();
    },
    backups: () => Promise.resolve([...state.backups]),
    backUpNow: () => {
      state.backups.unshift({
        name: 'punchlist-20261022-120000.json',
        taken: '2026-10-22T12:00:00Z',
        size: 2048,
      });
      return Promise.resolve('punchlist-20261022-120000.json');
    },
    backupUrl: (name) => `/api/admin/backups/${name}`,
    exportUrl: () => '/api/admin/export',
    userExportUrl: (id) => `/api/admin/users/${id}/export`,
    restoreUser: (source, username) => {
      state.restores.push({ source, username: username ?? null });
      return !username && 'backup' in source
        ? Promise.resolve({
            ok: false as const,
            message: 'say whose data to restore from this server backup',
          })
        : Promise.resolve({
            ok: true as const,
            value: {
              username: username ?? 'sam',
              created: false,
              restored: 12,
              removed: 1,
              dropped: 0,
            },
          });
    },
    restoreServer: (source) => {
      state.restores.push({ source, username: 'everyone' });
      return Promise.resolve({ ok: true as const });
    },
    settings: () => Promise.resolve(settingsView()),
    saveSettings: (values) => {
      if (values.REGISTRATION === 'maybe') {
        return Promise.resolve({
          ok: false as const,
          message: "REGISTRATION: 'maybe' is not one of open, invite, closed",
        });
      }
      Object.assign(state.page, values);
      return Promise.resolve({ ok: true as const, value: settingsView() });
    },
    restart: () => {
      state.restarted = true;
      return Promise.resolve();
    },
    sendTestMail: (to) =>
      Promise.resolve(
        to.endsWith('@example.com')
          ? { ok: true as const }
          : { ok: false as const, message: 'The mail server said no: 550 relay denied' },
      ),
    telemetry: () =>
      Promise.resolve({
        enabled: state.page.TELEMETRY !== 'false',
        url: 'https://telemetry.example.test/v1/ping',
        sentAt: null,
        noticeSeen: state.telemetry.noticeSeen,
        report: { installId: state.telemetry.installId, version: '0.3.0', scale: { users: '2-5' } },
      }),
    renewTelemetryId: () => {
      state.telemetry.installId = 'id-2';
      return Promise.resolve();
    },
    telemetryNoticeSeen: () => {
      state.telemetry.noticeSeen = true;
      return Promise.resolve();
    },
    logging: () =>
      Promise.resolve({
        level: 'information',
        overrides: {},
        outputs: [
          output('console', 'standard output', true),
          output('loki', 'http://loki:3100/loki/api/v1/push', false),
        ],
      }),
    debugDumpUrl: () => '/api/admin/debug-dump',
    audit: (query) => {
      auditQueries.push(query);
      const entries = audit.filter(
        (each) =>
          each.kind === query.kind &&
          (!query.outcome || each.outcome === query.outcome) &&
          (!query.type || each.type.startsWith(query.type)) &&
          (!query.text || JSON.stringify(each).includes(query.text)),
      );
      return Promise.resolve({ entries, more: false });
    },
    deleteUser: (id) => {
      state.deleted.push(id);
      state.users = state.users.map((each) =>
        each.id === id
          ? {
              ...each,
              disabled: true,
              deletedAt: '2026-10-22T12:00:00Z',
              removedAt: '2026-10-29T12:00:00Z',
            }
          : each,
      );
      return ok('2026-10-29T12:00:00Z');
    },
    linkIdentity: (id, provider, subject) => {
      if (subject === 'someone-elses')
        return Promise.resolve({ ok: false as const, reason: 'linked-elsewhere' as const });
      state.linked.push(`${id}:${provider}:${subject}`);
      state.pending = state.pending.filter((each) => each.subject !== subject);
      return ok(undefined);
    },
    restoreAccount: (id) => {
      state.users = state.users.map((each) =>
        each.id === id ? { ...each, disabled: false, deletedAt: null, removedAt: null } : each,
      );
      return ok(undefined);
    },
    removeNow: (id) => {
      state.users = state.users.filter((each) => each.id !== id);
      return ok(undefined);
    },
    setup: () => Promise.resolve({ done: state.setupDone }),
    finishSetup: () => {
      state.setupDone = true;
      return Promise.resolve();
    },
    stats: () =>
      Promise.resolve({
        computed: '2026-10-22T12:00:00Z',
        timeZone: 'Europe/Berlin',
        users: 2,
        openTasks: 12,
        closedTasks: 40,
        closedThisMonth: 5,
        lists: 6,
        sharedLists: 2,
        storageBytes: 3 * 1024 * 1024,
        closedByMonth: months(3),
        people: [
          personStats('U2', 'sam', 2, 30, null),
          personStats(benId, 'ben', 10, 10, '2026-10-22T09:00:00Z'),
        ],
      }),
    auditCsvUrl: (query) =>
      `/api/admin/audit.csv?kind=${query.kind}&outcome=${query.outcome ?? ''}`,
    providers: () =>
      Promise.resolve([
        { name: 'pocket', displayName: 'Pocket ID', linked: 2, migrationWindowUntil: state.window },
      ]),
    unbindAll: () => Promise.resolve({ unbound: 2, stranded: ['kim'] }),
    openMigrationWindow: () => {
      state.window = '2026-10-23T08:00:00Z';
      return Promise.resolve(state.window);
    },
    closeMigrationWindow: () => {
      state.window = null;
      return Promise.resolve();
    },
    pending: () => Promise.resolve([...state.pending]),
    approve: (_, subject) => {
      state.pending = state.pending.filter((each) => each.subject !== subject);
      return Promise.resolve();
    },
    dismiss: () => Promise.resolve(),
    oidc: () =>
      Promise.resolve({
        providers: [
          {
            name: 'pocket',
            displayName: 'Pocket ID',
            linkByUsername: 'true' as const,
            autoCreate: true,
            linkByEmail: false,
            migrationWindowUntil: null,
          },
        ],
        accounts: state.users.map((each) => ({
          id: each.id,
          username: each.username,
          role: each.role,
          disabled: each.disabled,
          identities: state.identities
            .filter((identity) => identity.accountId === each.id)
            .map((identity) => ({
              provider: identity.provider,
              displayName: 'Pocket ID',
              subject: identity.subject,
              email: null,
              username: identity.username,
              linkedAt: '2026-10-22T08:00:00Z',
              lastUsedAt: '2026-10-22T08:00:00Z',
            })),
        })),
        mappings: state.mappings.map((each) => ({ ...each })),
      }),
    saveMapping: (provider, providerUsername, accountId) => {
      if (
        state.mappings.some(
          (each) => each.source === 'settings' && each.providerUsername === providerUsername,
        )
      ) {
        return Promise.resolve({ ok: false, reason: 'set-by-settings' });
      }
      state.mappings.push({
        provider,
        providerUsername: providerUsername.toLowerCase(),
        accountId,
        accountUsername: state.users.find((each) => each.id === accountId)?.username ?? accountId,
        source: 'admin',
        createdAt: '2026-10-22T09:00:00Z',
      });
      return Promise.resolve({ ok: true, value: undefined });
    },
    removeMapping: (_, providerUsername) => {
      state.mappings = state.mappings.filter((each) => each.providerUsername !== providerUsername);
      return Promise.resolve({ ok: true, value: undefined });
    },
    moveIdentity: (_, subject, accountId) => {
      const identity = state.identities.find((each) => each.subject === subject)!;
      const from = identity.accountId;
      identity.accountId = accountId;
      const stranded = state.identities.some((each) => each.accountId === from) ? [] : ['sam'];
      return Promise.resolve({ ok: true, value: { stranded } });
    },
  };
  return { api, state, auditQueries };
}

async function adminApp(
  role: AccountRole,
  path = '/admin',
  options: {
    setupDone?: boolean;
    path?: string;
    registration?: 'open' | 'invite' | 'closed';
    prepare?: (state: ReturnType<typeof memoryAdmin>['state']) => void;
  } = {},
) {
  const backend = new FakeBackend();
  const ben = backend.addAccount('ben', 'correct horse battery', { role });
  const transport = backend.device();
  transport.session = 'ben';
  const admin = memoryAdmin(ben.id);
  if (options.setupDone !== undefined) admin.state.setupDone = options.setupDone;
  if (options.registration) admin.state.registration = options.registration;
  options.prepare?.(admin.state);
  transport.admin = admin.api;
  const store = testStore();
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await renderApp(options.path ?? path, store, sync);
  return admin;
}

describe('admin', () => {
  it('is only for admins', async () => {
    await adminApp('user', '/today');
    await userEvent.click(await screen.findByRole('button', { name: /^Account: / }));
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Admin' })).toBeNull();
  });

  it('turns plain users away at the address too', async () => {
    await adminApp('user');
    expect(
      await screen.findByText('Only admins of this server can open this page.'),
    ).toBeInTheDocument();
  });

  it('on a phone the tab strip scrolls instead of cutting the last tabs off', async () => {
    mockViewport('phone');
    await adminApp('superadmin', '/admin/stats');
    const tabs = await screen.findByRole('tablist');
    // MUI's standard strip hides what does not fit; the scrollable one can be swiped.
    expect(tabs.parentElement).toHaveClass('MuiTabs-scrollableX');
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true');
  });

  it('adds people, resets passwords and turns accounts off', async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    expect(await within(list).findByRole('listitem', { name: 'sam' })).toHaveTextContent(
      'User · Password',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add user' }));
    const add = await screen.findByRole('dialog', { name: 'Add user' });
    await userEvent.type(within(add).getByLabelText(/Username/), 'Zoe');
    await userEvent.click(within(add).getByRole('button', { name: 'Add' }));
    const shown = await screen.findByRole('dialog', { name: 'Password for zoe' });
    expect(shown).toHaveTextContent('generated-secret-1');
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(list).findByRole('listitem', { name: 'zoe' })).toHaveTextContent(
      'Must choose a password',
    );

    await userEvent.click(within(list).getByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset password' }));
    expect(await screen.findByRole('dialog', { name: 'New password for sam' })).toHaveTextContent(
      'reset-secret-2',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(within(list).getByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Turn off' }));
    const confirm = await screen.findByRole('dialog', { name: 'Turn off sam?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Turn off' }));
    await waitFor(() =>
      expect(within(list).getByRole('listitem', { name: 'sam' })).toHaveTextContent('Turned off'),
    );
    expect(state.users.find((each) => each.username === 'sam')?.disabled).toBe(true);

    // The own account cannot be turned off from here.
    await userEvent.click(within(list).getByRole('button', { name: 'Actions for ben' }));
    expect(await screen.findByRole('menuitem', { name: 'Reset password' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Turn off' })).toBeNull();
  });

  it('makes invite links that are shown once, lists them and withdraws them', async () => {
    const { state } = await adminApp('admin');
    await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    const make = await screen.findByRole('dialog', { name: 'Invite people' });
    await userEvent.type(within(make).getByLabelText('Who it is for'), 'The Lees');
    await userEvent.click(within(make).getByLabelText('Can be used by'));
    await userEvent.click(await screen.findByRole('option', { name: '5 people' }));
    await userEvent.click(within(make).getByRole('button', { name: 'Create link' }));

    const shown = await screen.findByRole('dialog', { name: 'Invite link' });
    expect(shown).toHaveTextContent('https://tasks.example.com/join/token-I1');
    expect(shown).toHaveTextContent('It works for 5 people until Oct 30');
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(state.invites[0]).toMatchObject({ note: 'The Lees', maxUses: 5 });

    const invites = await screen.findByRole('list', { name: 'Invite links' });
    expect(within(invites).getByRole('listitem', { name: 'The Lees' })).toHaveTextContent(
      '0 of 5 used',
    );
    await userEvent.click(within(invites).getByRole('button', { name: 'Withdraw The Lees' }));
    const confirm = await screen.findByRole('dialog', { name: 'Withdraw this invite link?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Invite links' })).toBeNull());
    expect(state.invites).toEqual([]);
  });

  it('says invite links do not work while sign-up is closed', async () => {
    await adminApp('admin', '/admin', { registration: 'closed' });
    await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    const make = await screen.findByRole('dialog', { name: 'Invite people' });
    expect(make).toHaveTextContent('Sign-up is closed on this server');
    expect(within(make).getByRole('button', { name: 'Create link' })).toBeDisabled();
  });

  it('an admin leaves admin accounts to super admins', async () => {
    await adminApp('admin');
    await userEvent.click(await screen.findByRole('button', { name: /^Account: / }));
    expect(await screen.findByRole('menuitem', { name: 'Admin' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    const list = await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Actions for ben' }));
    expect(
      await screen.findByText("Only a super admin can change an admin's account."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Reset password' })).toBeNull();
  });

  it('sets up and ends friendships for people', async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Friends' }));
    const dialog = await screen.findByRole('dialog', { name: "sam's friends" });
    expect(await within(dialog).findByText('No friends yet.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Make friends with'));
    await userEvent.click(await screen.findByRole('option', { name: 'ben' }));
    expect(await within(dialog).findByText('ben')).toBeInTheDocument();
    expect(state.friendships).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'End friendship with ben' }));
    expect(await within(dialog).findByText('No friends yet.')).toBeInTheDocument();
  });

  it("hands someone's shared lists to another person", async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hand over shared lists' }));
    const dialog = await screen.findByRole('dialog', { name: "Hand over sam's shared lists" });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Household/ }));
    expect(within(dialog).getByRole('button', { name: 'Hand over' })).toBeDisabled();
    await userEvent.click(within(dialog).getByLabelText('New owner'));
    await userEvent.click(await screen.findByRole('option', { name: 'ben' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hand over' }));
    expect(await screen.findByText('Handed over 1.')).toBeInTheDocument();
    expect(state.handedOver).toEqual([{ from: 'U2', to: expect.any(String), ids: ['L1'] }]);
  });

  it('a super admin opens a tab viewing the app as someone, saying why', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'View as sam' }));
    const dialog = await screen.findByRole('dialog', { name: 'View the app as sam' });
    await userEvent.type(within(dialog).getByLabelText(/Why/), 'ok');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }));
    expect(await within(dialog).findByText('Say why, in a few words.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Why/), ' then, sam asked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('/today#view-as=view-token&name=sam', '_blank'),
    );
    // Not for oneself.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(within(list).getByRole('button', { name: 'Actions for ben' }));
    await screen.findByRole('menuitem', { name: 'Reset password' });
    expect(screen.queryByRole('menuitem', { name: /View as/ })).toBeNull();
    open.mockRestore();
  });

  it("changes server settings, leaves the environment's alone, and restarts to apply them", async () => {
    const { state } = await adminApp('superadmin', '/admin/settings');
    const general = await screen.findByRole('region', { name: 'General' });
    expect(within(general).getByText('REGISTRATION · default: invite')).toBeInTheDocument();
    const backups = screen.getByRole('region', { name: 'Backups' });
    const kept = within(backups).getByRole('spinbutton', { name: 'Backups kept' });
    expect(kept).toBeDisabled();
    expect(kept).toHaveValue(5);
    expect(within(backups).getByText('SNAPSHOT_KEEP · set by the environment')).toBeInTheDocument();
    // Environment-only settings come last, secrets never shown.
    const environment = screen.getByRole('region', { name: 'Set in the environment only' });
    expect(within(environment).getByLabelText('Database connection')).toHaveValue('');

    await userEvent.click(within(general).getByRole('combobox', { name: 'Who can join' }));
    await userEvent.click(await screen.findByRole('option', { name: 'open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await within(general).findByText('REGISTRATION · saved here')).toBeInTheDocument();
    expect(state.page).toEqual({ REGISTRATION: 'open' });
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(state.restarted).toBe(true);
  });

  it('tells the admin once that the server reports, shows the report as it goes, and renews the install id', async () => {
    const { state } = await adminApp('superadmin', '/admin/settings');
    const notice = await screen.findByText(/sends an anonymous usage report once a day/);
    const telemetry = screen.getByRole('region', { name: 'Telemetry' });
    expect(within(telemetry).getByText(/Not sent yet/)).toBeInTheDocument();

    await userEvent.click(within(telemetry).getByRole('button', { name: "See what's sent" }));
    const report = await screen.findByRole('dialog', {
      name: 'The usage report, as it would go now',
    });
    expect(report).toHaveTextContent('"installId": "id-1"');
    expect(report).toHaveTextContent('"users": "2-5"');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(within(telemetry).getByRole('button', { name: 'New install id' }));
    expect(await within(telemetry).findByRole('status')).toHaveTextContent('a new install id');
    expect(state.telemetry.installId).toBe('id-2');

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(notice).not.toBeInTheDocument());
    expect(state.telemetry.noticeSeen).toBe(true);
  });

  it('backs up, restores one person or the whole server, and exports', async () => {
    const { state } = await adminApp('superadmin', '/admin/backups');
    const scheduled = await screen.findByRole('region', { name: 'Backups on the server' });
    expect(await within(scheduled).findByText('No backups yet.')).toBeInTheDocument();
    await userEvent.click(within(scheduled).getByRole('button', { name: 'Back up now' }));
    const row = await within(scheduled).findByRole('listitem', {
      name: 'punchlist-20261022-120000.json',
    });
    expect(within(row).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/admin/backups/punchlist-20261022-120000.json',
    );
    expect(screen.getByRole('link', { name: 'Download the whole server' })).toHaveAttribute(
      'href',
      '/api/admin/export',
    );

    // One person from a whole-server backup needs a name.
    await userEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(
      await within(dialog).findByText('say whose data to restore from this server backup'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Whose data'), 'sam');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(
      await screen.findByText(/sam is back as the backup had them: 12 things restored, 1 removed/),
    ).toBeInTheDocument();

    // The whole server.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('The whole server'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(
      await screen.findByText(/The server is restarting to restore the backup/),
    ).toBeInTheDocument();
    expect(state.restores.map((each) => each.username)).toEqual([null, 'sam', 'everyone']);
  });

  it('offers a plain admin no whole-server backups', async () => {
    const { state } = await adminApp('admin', '/admin/backups', {
      prepare: (admin) => {
        admin.signInLocked = true;
      },
    });
    const scheduled = await screen.findByRole('region', { name: 'Backups on the server' });
    await userEvent.click(within(scheduled).getByRole('button', { name: 'Back up now' }));
    const row = await within(scheduled).findByRole('listitem', {
      name: 'punchlist-20261022-120000.json',
    });
    expect(within(row).queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Download the whole server' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Restore' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('radio', { name: 'The whole server' }),
    ).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Whose data'), 'sam');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(state.restores).toHaveLength(1));
  });

  it('sends a test email and says what the mail server answered (PL-122)', async () => {
    await adminApp('admin', '/admin/settings');
    const email = await screen.findByRole('region', { name: 'Email' });
    const to = within(email).getByLabelText('Send a test to');
    await userEvent.type(to, 'ben@example.com');
    await userEvent.click(within(email).getByRole('button', { name: 'Send test email' }));
    expect(await within(email).findByText(/^Sent to ben@example.com/)).toBeInTheDocument();
    await userEvent.clear(to);
    await userEvent.type(to, 'ben@elsewhere.test');
    await userEvent.click(within(email).getByRole('button', { name: 'Send test email' }));
    expect(
      await within(email).findByText('The mail server said no: 550 relay denied'),
    ).toBeInTheDocument();
  });

  it('shows a plain admin the sign-in settings locked to super admins', async () => {
    await adminApp('admin', '/admin/settings', {
      prepare: (admin) => {
        admin.signInLocked = true;
      },
    });
    const general = await screen.findByRole('region', { name: 'General' });
    expect(
      within(general).getByText('REGISTRATION · default: invite · super admins only'),
    ).toBeInTheDocument();
    expect(within(general).getByRole('combobox', { name: 'Who can join' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('links a provider account by hand, to a person or from a waiting sign-in', async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    const sam = await within(list).findByRole('listitem', { name: 'sam' });
    await userEvent.click(within(sam).getByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Link a provider account' }));
    let dialog = await screen.findByRole('dialog', { name: 'Link a provider account to sam' });
    await userEvent.type(within(dialog).getByLabelText(/Subject/), 'someone-elses');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Link' }));
    expect(
      await within(dialog).findByText('That provider account is linked to someone else.'),
    ).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText(/Subject/));
    await userEvent.type(within(dialog).getByLabelText(/Subject/), 'sam-at-pocket');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Link' }));
    expect(await screen.findByText('Linked to sam.')).toBeInTheDocument();
    expect(state.linked).toEqual(['U2:pocket:sam-at-pocket']);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByRole('tab', { name: 'Sign-in' }));
    const waiting = await screen.findByRole('region', { name: 'Waiting to be let in' });
    await userEvent.click(
      await within(waiting).findByRole('button', { name: 'Link to an account' }),
    );
    dialog = await screen.findByRole('dialog', { name: 'Link kim to an existing account' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Person' }));
    await userEvent.click(await screen.findByRole('option', { name: 'sam' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(state.linked).toContain('U2:pocket:kim-sub'));
  });

  it('deletes an account after offering the hand-over, and restores it within the grace period', async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    const sam = await within(list).findByRole('listitem', { name: 'sam' });
    await userEvent.click(within(sam).getByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog', { name: "Delete sam's account?" });
    expect(
      await within(dialog).findByText(/owns 2 lists or groups shared with others/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Hand over first' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(state.deleted).toEqual(['U2']);
    expect(await within(list).findByText(/Deleted, removed for good/)).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(within(sam).getByRole('button', { name: 'Actions for sam' }));
    expect(screen.queryByRole('menuitem', { name: 'Delete account' })).toBeNull();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Restore account' }));
    await waitFor(() => expect(within(list).queryByText(/Deleted, removed for good/)).toBeNull());
  });

  it('restores a deleted account, or deletes it for good now, from its row', async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    const sam = await within(list).findByRole('listitem', { name: 'sam' });
    expect(within(sam).queryByRole('button', { name: 'Delete now' })).toBeNull();
    await userEvent.click(within(sam).getByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete account' }));
    const dialog = await screen.findByRole('dialog', { name: "Delete sam's account?" });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(await within(sam).findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(within(list).queryByText(/Deleted, removed for good/)).toBeNull());
    expect(within(sam).queryByRole('button', { name: 'Restore' })).toBeNull();

    await userEvent.click(within(sam).getByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete account' }));
    const again = await screen.findByRole('dialog', { name: "Delete sam's account?" });
    await userEvent.click(within(again).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(await within(sam).findByRole('button', { name: 'Delete now' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete sam for good now?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete now' }));
    await waitFor(() => expect(within(list).queryByRole('listitem', { name: 'sam' })).toBeNull());
    expect(await screen.findByText('sam is deleted for good.')).toBeInTheDocument();
    expect(state.users.map((each) => each.username)).toEqual(['ben']);
  });

  it('shows the groups each user is in, server groups and the ones people made', async () => {
    await adminApp('superadmin', '/admin', {
      prepare: (state) => {
        state.users = state.users.map((each) =>
          each.username === 'sam'
            ? { ...each, groups: ['G1'], peopleGroups: ['Game night'] }
            : each,
        );
        state.groups = [
          {
            id: 'G1',
            name: 'Household',
            offeredForSharing: true,
            createdAt: '2026-10-22T08:00:00Z',
            members: [{ accountId: 'U2', sources: ['manual'] }],
          },
        ];
      },
    });
    const list = await screen.findByRole('list', { name: 'Users' });
    const sam = await within(list).findByRole('listitem', { name: 'sam' });
    expect(await within(sam).findByText('Groups: Household, Game night')).toBeInTheDocument();
    const ben = within(list).getByRole('listitem', { name: 'ben' });
    expect(within(ben).queryByText(/^Groups:/)).toBeNull();
  });

  it('walks a new server through setup: address, a provider, who can join, then a restart', async () => {
    const { state } = await adminApp('superadmin', '/admin', {
      setupDone: false,
      path: '/admin/setup',
    });
    const wizard = await screen.findByRole('region', { name: 'Set up your server' });
    expect(within(wizard).getByText('Step 1 of 3: Public address')).toBeInTheDocument();
    const address = within(wizard).getByLabelText('Public address');
    await userEvent.clear(address);
    await userEvent.type(address, 'https://tasks.example.com');
    await userEvent.click(within(wizard).getByRole('button', { name: 'Next' }));

    expect(
      await within(wizard).findByText('Step 2 of 3: Sign-in with a provider'),
    ).toBeInTheDocument();
    expect(within(wizard).getByRole('button', { name: 'Next' })).toBeDisabled();
    await userEvent.type(
      within(wizard).getByLabelText('Provider name on the sign-in button'),
      'Pocket ID',
    );
    await userEvent.type(within(wizard).getByLabelText('Issuer address'), 'https://id.example.com');
    await userEvent.type(within(wizard).getByLabelText('Client ID'), 'punchlist');
    expect(
      within(wizard).getByText(
        'Register this callback address with the provider: https://tasks.example.com/auth/oidc/pocket-id/callback',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(wizard).getByRole('button', { name: 'Next' }));

    expect(await within(wizard).findByText('Step 3 of 3: Who can join')).toBeInTheDocument();
    await userEvent.click(within(wizard).getByLabelText(/^Closed/));
    await userEvent.click(within(wizard).getByRole('button', { name: 'Finish' }));

    expect(await screen.findByText('Your server is set up')).toBeInTheDocument();
    expect(state.page).toEqual({
      PUBLIC_URL: 'https://tasks.example.com',
      OIDC_PROVIDERS: 'pocket-id',
      OIDC_POCKET_ID_AUTHORITY: 'https://id.example.com',
      OIDC_POCKET_ID_CLIENT_ID: 'punchlist',
      OIDC_POCKET_ID_DISPLAY_NAME: 'Pocket ID',
      OIDC_POCKET_ID_AUTO_CREATE: 'true',
      REGISTRATION: 'closed',
    });
    expect(state.setupDone).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    expect(state.restarted).toBe(true);
  });

  it('offers setup on the admin page until it is dismissed, and a set-up server skips the wizard', async () => {
    const { state } = await adminApp('admin', '/admin', { setupDone: false });
    expect(await screen.findByText('Finish setting up this server')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Finish setting up this server')).toBeNull();
    expect(state.setupDone).toBe(true);
  });

  it('shows server totals, closed tasks per month and a sortable row per person', async () => {
    await adminApp('superadmin', '/admin/stats');
    const totals = await screen.findByRole('region', { name: 'Server totals' });
    expect(within(totals).getByRole('group', { name: 'Open tasks' })).toHaveTextContent('12');
    expect(within(totals).getByRole('group', { name: 'Storage' })).toHaveTextContent('3.0 MB');
    expect(screen.getByText('Months in Europe/Berlin time')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem', { name: /closed$/ }).length).toBe(12);

    const table = screen.getByRole('table', { name: 'By person' });
    const names = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
    // Most open tasks first.
    expect(names()).toEqual(['ben', 'sam']);
    await userEvent.click(within(table).getByRole('button', { name: 'Closed tasks' }));
    expect(names()).toEqual(['sam', 'ben']);
    await userEvent.click(within(table).getByRole('button', { name: 'Closed tasks' }));
    expect(names()).toEqual(['ben', 'sam']);
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent('Not lately');

    await userEvent.click(within(table).getByRole('cell', { name: 'sam' }));
    expect(screen.getByRole('list', { name: 'Closed per month by sam' })).toBeInTheDocument();
  });

  it('shows what people did, filters it, opens an entry and lists requests', async () => {
    const { auditQueries } = await adminApp('superadmin', '/admin/logs');
    const events = await screen.findByRole('list', { name: 'Events' });
    expect(
      await within(events).findByRole('listitem', { name: "ben changed sam's role" }),
    ).toHaveTextContent('role admin');
    const failed = within(events).getByRole('listitem', { name: 'sam signed in' });
    expect(failed).toHaveTextContent('sam signed in · Failed');
    expect(failed).toHaveTextContent('203.0.113.9 · Firefox on Windows');

    await userEvent.click(screen.getByRole('combobox', { name: 'Outcome' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Failed' }));
    await waitFor(() => expect(within(events).getAllByRole('listitem')).toHaveLength(1));
    expect(auditQueries.at(-1)).toMatchObject({ kind: 'event', outcome: 'failed' });
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      '/api/admin/audit.csv?kind=event&outcome=failed',
    );
    await userEvent.click(within(events).getByRole('button', { name: /sam signed in/ }));
    expect(within(events).getByText('Request id')).toBeInTheDocument();
    expect(within(events).getByText('auth.sign-in')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'nobody');
    expect(await within(events).findByText('Nothing here.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Requests' }));
    const requests = await screen.findByRole('list', { name: 'Requests' });
    expect(
      await within(requests).findByRole('listitem', { name: 'POST /api/sync 200' }),
    ).toHaveTextContent('ben · 23 ms');
  });

  it('shows where logs go, which output is failing, and offers the debug dump', async () => {
    await adminApp('superadmin', '/admin/logs');
    await userEvent.click(await screen.findByRole('button', { name: 'Outputs' }));
    const outputs = await screen.findByRole('region', { name: 'Where logs go' });
    expect(await within(outputs).findByText('Writing information and above.')).toBeInTheDocument();
    expect(within(outputs).getByRole('listitem', { name: 'Console' })).toHaveTextContent(
      'Keeping up · 120 sent, 0 dropped',
    );
    const loki = within(outputs).getByRole('listitem', { name: 'Loki' });
    expect(loki).toHaveTextContent('Failing · 0 sent, 35 dropped');
    expect(loki).toHaveTextContent('Connection refused (loki:3100)');
    expect(screen.getByRole('link', { name: 'Download debug dump' })).toHaveAttribute(
      'href',
      '/api/admin/debug-dump',
    );
    await userEvent.click(within(outputs).getByRole('link', { name: /Change levels/ }));
    expect(await screen.findByRole('region', { name: 'General' })).toBeInTheDocument();
  });

  it('makes a group and fills it', async () => {
    const { state } = await adminApp('superadmin', '/admin/groups');
    await userEvent.click(await screen.findByRole('button', { name: 'New group' }));
    const made = await screen.findByRole('dialog', { name: 'New group' });
    await userEvent.type(within(made).getByLabelText(/Name/), 'Family');
    await userEvent.click(within(made).getByLabelText('Offer for sharing'));
    await userEvent.click(within(made).getByRole('button', { name: 'Save' }));
    const list = await screen.findByRole('list', { name: 'Groups' });
    await userEvent.click(await within(list).findByText('Family'));

    const group = await screen.findByRole('dialog', { name: 'Family' });
    await userEvent.click(within(group).getByLabelText('Add someone'));
    await userEvent.click(await screen.findByRole('option', { name: 'sam' }));
    expect(await within(group).findByText('Added by hand')).toBeInTheDocument();
    expect(state.groups[0]).toMatchObject({
      name: 'Family',
      offeredForSharing: true,
      members: [{ accountId: 'U2' }],
    });
  });

  it('opens a migration window and lets a waiting person in', async () => {
    const { state } = await adminApp('superadmin', '/admin/sign-in');
    const providers = await screen.findByRole('region', { name: 'Identity providers' });
    expect(await within(providers).findByText(/^2 linked/)).toBeInTheDocument();
    await userEvent.click(within(providers).getByRole('button', { name: 'Open migration window' }));
    expect(await within(providers).findByText(/Migration window open until/)).toBeInTheDocument();

    const waiting = screen.getByRole('region', { name: 'Waiting to be let in' });
    await userEvent.click(await within(waiting).findByRole('button', { name: 'Let in' }));
    expect(await within(waiting).findByText('Nobody is waiting.')).toBeInTheDocument();
    expect(state.pending).toEqual([]);

    await userEvent.click(within(providers).getByRole('button', { name: 'Unbind all' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Unbind all' }),
    );
    expect(await screen.findByText(/No way to sign in now: kim/)).toBeInTheDocument();
  });

  it('shows who signs in with which provider account and maps, moves and unlinks them', async () => {
    const { state } = await adminApp('superadmin', '/admin/sign-in');
    const providers = await screen.findByRole('region', { name: 'Identity providers' });
    expect(await within(providers).findByText(/Joins plain users by username/)).toBeInTheDocument();

    const accounts = await screen.findByRole('region', {
      name: 'Accounts and their provider accounts',
    });
    const sam = await within(accounts).findByRole('listitem', { name: 'sam' });
    expect(within(sam).getByText(/Pocket ID: kim/)).toBeInTheDocument();
    // Accounts without one show only when asked.
    expect(within(accounts).queryByRole('listitem', { name: 'ben' })).not.toBeInTheDocument();
    await userEvent.click(
      within(accounts).getByLabelText('Show accounts without a provider account'),
    );
    expect(within(accounts).getByRole('listitem', { name: 'ben' })).toBeInTheDocument();

    // Move kim's provider account to ben: sam has no way in left.
    await userEvent.click(within(sam).getByRole('button', { name: 'Move' }));
    const move = await screen.findByRole('dialog');
    await userEvent.click(within(move).getByLabelText('Signs into'));
    await userEvent.click(await screen.findByRole('option', { name: 'ben' }));
    await userEvent.click(within(move).getByRole('button', { name: 'Move' }));
    expect(await screen.findByText(/sam has no way to sign in now/)).toBeInTheDocument();
    expect(state.identities[0]?.accountId).not.toBe('U2');

    // The settings' mapping is read-only; a new one can be added and removed.
    const mappings = screen.getByRole('region', { name: 'Mappings' });
    const boss = within(mappings).getByRole('listitem', { name: 'Pocket ID: boss → ben' });
    expect(within(boss).getByText('From the server settings')).toBeInTheDocument();
    expect(within(boss).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    await userEvent.click(within(mappings).getByRole('button', { name: 'Add mapping' }));
    const map = await screen.findByRole('dialog');
    await userEvent.type(within(map).getByLabelText('Username at the provider'), 'Sammy');
    await userEvent.click(within(map).getByLabelText('Signs into'));
    await userEvent.click(await screen.findByRole('option', { name: 'sam' }));
    await userEvent.click(within(map).getByRole('button', { name: 'Save mapping' }));
    const sammy = await within(mappings).findByRole('listitem', { name: 'Pocket ID: sammy → sam' });
    await userEvent.click(within(sammy).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.mappings).toHaveLength(1));

    // Unlink, after a confirmation.
    const ben = within(accounts).getByRole('listitem', { name: 'ben' });
    await userEvent.click(within(ben).getByRole('button', { name: 'Unlink' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Unlink' }),
    );
    expect(await screen.findByText('Unlinked.')).toBeInTheDocument();
  });
});
