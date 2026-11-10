// What admins manage on a server (spec: Accounts & Admin, Admin UI). Adapter: HTTP to /api/admin.
import type { ServerStats } from './stats.ts';
import type { PasskeyInfo } from './sync.ts';

export type AccountRole = 'superadmin' | 'admin' | 'user';

/** A crash on the server itself (PL-116): the same bug counts up; the report is what would go. */
export interface ServerCrash {
  fingerprint: string;
  count: number;
  firstAt: string;
  lastAt: string;
  report: { kind: string; version: string; stack: string; logs: string[] } & Record<
    string,
    unknown
  >;
}

export interface AdminUser {
  id: string;
  username: string;
  role: AccountRole;
  disabled: boolean;
  createdAt: string;
  /** Server groups the account is in (ids). */
  groups: string[];
  /** Names of the groups people made that the account is in (owner or member). */
  peopleGroups?: string[];
  hasPassword: boolean;
  mustChangePassword: boolean;
  /** Identity providers linked to the account. */
  providers: string[];
  /** When an admin deleted it; it is removed for good at `removedAt` unless restored. */
  deletedAt?: string | null;
  removedAt?: string | null;
  /** The person's email and whether they confirmed it (PL-122); reset links go only to a confirmed one. */
  email?: string | null;
  emailConfirmed?: boolean;
  /** How many passkeys the account has (PL-123). */
  passkeys?: number;
  /**
   * When a role from a provider's ROLE_MAP drops to user unless a sign-in through that provider
   * renews it first (an instant); null for a role set by hand, a plain user, or with
   * ROLE_MAP_RENEW_DAYS at 0. Older servers send none.
   */
  roleRenewsBy?: string | null;
  /** The provider whose ROLE_MAP gave the role, when it renews. */
  roleProvider?: string | null;
}

export interface AdminIdentity {
  provider: string;
  displayName: string;
  subject: string;
  email: string | null;
  linkedAt: string;
  lastUsedAt: string;
  /** The provider's username at the last sign-in (null for links made before it was kept). */
  username?: string | null;
}

/** The OIDC page (spec: Accounts & Admin, Linking): who is paired with which provider account. */
export interface OidcOverview {
  providers: {
    name: string;
    displayName: string;
    /** `false`, `true` (plain users) or `all`. */
    linkByUsername: 'false' | 'true' | 'all';
    autoCreate: boolean;
    linkByEmail: boolean;
    migrationWindowUntil: string | null;
  }[];
  accounts: {
    id: string;
    username: string;
    role: AccountRole;
    disabled: boolean;
    identities: AdminIdentity[];
  }[];
  mappings: OidcMapping[];
}

/** A provider username that joins an account at its first sign-in, or a `sub:` subject that always signs into it. */
export interface OidcMapping {
  provider: string;
  providerUsername: string;
  /** Null when the setting names an account that does not exist. */
  accountId: string | null;
  accountUsername: string;
  /** `settings`: OIDC_<NAME>_USER_MAP, changed there only. */
  source: 'settings' | 'admin';
  createdAt: string | null;
}

export interface AdminGroup {
  id: string;
  name: string;
  offeredForSharing: boolean;
  createdAt: string;
  /** Why each member is in: `manual`, or `oidc:<provider>`. */
  members: { accountId: string; sources: string[] }[];
}

export interface AdminFriend {
  userId: string;
  username: string;
  state: 'accepted' | 'pending';
}

/** A shared list or group someone owns. */
export interface AdminShare {
  kind: 'list' | 'group';
  id: string;
  name: string;
  people: number;
}

export interface AdminProvider {
  name: string;
  displayName: string;
  linked: number;
  migrationWindowUntil: string | null;
}

export interface PendingSignIn {
  provider: string;
  subject: string;
  username: string;
  displayName: string | null;
  email: string | null;
  groups: string[];
  firstSeen: string;
  lastSeen: string;
}

/** The daily usage report as the admin settings page shows it (PL-116). */
export interface TelemetryView {
  enabled: boolean;
  url: string;
  /** When a report last went, ISO; null before the first. */
  sentAt: string | null;
  noticeSeen: boolean;
  /** The report exactly as it would go now. */
  report: Record<string, unknown>;
}

/** One server setting as the settings page shows it (spec: Server settings). */
export interface ServerSetting {
  key: string;
  /** general, sign-in, backups, network, logging, environment, or provider:<name> */
  group: string;
  kind: 'text' | 'url' | 'choice' | 'number' | 'flag' | 'list' | 'secret';
  choices: string[] | null;
  default: string | null;
  /** The value in force; secrets show as asterisks when set. */
  value: string | null;
  source: 'environment' | 'file' | 'page' | 'default';
  /** Set outside the page (or only settable there): shown, not editable. */
  locked: boolean;
  /** A value is saved on the page (it may be overridden). */
  saved: boolean;
  /** Decides who signs in (identity providers, passwords, registration, proxies, the public
   * address): only super admins save it; for admins it is locked. */
  superAdminOnly?: boolean;
  /** Applies as soon as it is saved (logging), not at the next restart. */
  live: boolean;
}

export interface ServerSettingsView {
  settings: ServerSetting[];
  /** Saved values differ from those the server started with. */
  pendingRestart: boolean;
  /** Why the saved values were set aside at the last start, if they were. */
  problem: string | null;
  /** The mail providers SMTP_PROVIDER can pick, and what each fills in. */
  mailProviders?: MailPreset[];
}

/** A mail provider preset: the settings it fills in, and those it only suggests. */
export interface MailPreset {
  name: string;
  displayName: string;
  /** Setting key to the value picking this provider gives it (shown greyed out). */
  sets: Record<string, string>;
  /** Setting key to a suggested value the admin may change (Amazon SES's regional host). */
  suggests: Record<string, string>;
}

/** One place the server's logs go, and how it is keeping up (spec: Logging). */
export interface LogOutput {
  /** console, file, otlp, loki, gelf, elastic or syslog */
  name: string;
  /** Where it sends, without passwords. */
  destination: string;
  healthy: boolean;
  sent: number;
  /** Entries lost while the output was down or behind. */
  dropped: number;
  failures: number;
  queued: number;
  lastSent: string | null;
  lastFailure: string | null;
  lastError: string | null;
}

export interface LoggingView {
  level: string;
  overrides: Record<string, string>;
  outputs: LogOutput[];
}

export type AuditKind = 'event' | 'access';

/** One entry of the access or event log (spec: Access and event log). */
export interface AuditEntry {
  id: string;
  time: string;
  kind: AuditKind;
  /** auth.sign-in, admin.role-changed, ...; "request" for access entries */
  type: string;
  /** ok, failed, denied, refused, locked, throttled, pending or error */
  outcome: string;
  actorId: string | null;
  actorName: string | null;
  /** The admin viewing the app as the actor, when one was. */
  impersonatorId: string | null;
  impersonatorName: string | null;
  targetId: string | null;
  targetName: string | null;
  ip: string | null;
  /** The User-Agent. */
  device: string | null;
  method: string | null;
  /** The route template, never the query string. */
  route: string | null;
  status: number | null;
  durationMs: number | null;
  requestId: string | null;
  detail: string | null;
}

export interface AuditQuery {
  kind: AuditKind;
  /** Matches type, people, IP, route and detail. */
  text?: string | undefined;
  /** A name or id: as the actor, the target or the impersonator. */
  user?: string | undefined;
  /** An exact type or a prefix ending in a dot ("auth."). */
  type?: string | undefined;
  outcome?: string | undefined;
  ip?: string | undefined;
  /** ISO times; `to` is exclusive. */
  from?: string | undefined;
  to?: string | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

export interface AuditPage {
  entries: AuditEntry[];
  more: boolean;
}

/** A scheduled backup on the server. */
export interface BackupFile {
  name: string;
  taken: string;
  size: number;
}

/** Where a restore reads from: an uploaded file or a backup already on the server. */
export type RestoreSource = { file: File } | { backup: string };

export interface UserRestoreResult {
  username: string;
  created: boolean;
  restored: number;
  removed: number;
  dropped: number;
}

/** An invite link for self sign-up; its address is shown only when it is made. */
export interface AdminInvite {
  id: string;
  /** Who it is for, as the admin wrote it. */
  note: string | null;
  createdBy: string;
  createdAt: string;
  expires: string;
  /** How many accounts it may make; null for any number until it expires. */
  maxUses: number | null;
  uses: number;
  /** Usernames of the accounts it made. */
  usedBy: string[];
}

export interface InviteList {
  /** `closed` makes no invites, and those already made stop working. */
  registration: 'open' | 'invite' | 'closed';
  invites: AdminInvite[];
}

/** Why an admin action was refused, when the person can do something about it. */
export type AdminRefusal =
  | 'not-allowed'
  | 'reason-required'
  | 'last-super-admin'
  | 'self'
  | 'taken'
  | 'invalid'
  | 'too-short'
  | 'too-long'
  | 'admins-only'
  | 'admin-linked'
  | 'linked-elsewhere'
  | 'registration-closed'
  | 'set-by-settings'
  | 'admin-needs-subject'
  | 'subject-not-username'
  | 'no-email'
  | 'mail-off'
  | 'mail-failed'
  | 'invalid-email'
  | 'needs-public-url';

export type AdminResult<T = void> = { ok: true; value: T } | { ok: false; reason: AdminRefusal };

export interface AdminApi {
  users(): Promise<AdminUser[]>;
  /** A new account with a generated password, to be changed at first sign-in. */
  addUser(
    username: string,
    role: AccountRole,
  ): Promise<AdminResult<{ id: string; password: string }>>;
  setRole(id: string, role: AccountRole): Promise<AdminResult>;
  setDisabled(id: string, disabled: boolean): Promise<AdminResult>;
  /** Delete: off at once, removed for good after the grace period (returns when). */
  deleteUser(id: string): Promise<AdminResult<string>>;
  /** Attach a provider account (by its subject) to someone; a waiting sign-in with it is settled. */
  linkIdentity(id: string, provider: string, subject: string): Promise<AdminResult>;
  /** Take a deletion back within the grace period. */
  restoreAccount(id: string): Promise<AdminResult>;
  /** Remove a deleted account for good now, without waiting out the grace period. */
  removeNow(id: string): Promise<AdminResult>;
  /** A generated password the person must change; shown once. */
  resetPassword(id: string): Promise<AdminResult<string>>;
  loginLink(id: string): Promise<AdminResult<{ url: string; expires: string }>>;
  /** Email a password reset link to the person's confirmed email (PL-122). */
  sendResetLink(id: string): Promise<AdminResult>;
  /** Someone's passkeys (PL-123), to remove a lost one. */
  passkeys(id: string): Promise<PasskeyInfo[]>;
  removePasskey(id: string, passkeyId: string): Promise<AdminResult>;
  /** Invite links that still work, and whether sign-up takes them. */
  invites(): Promise<InviteList>;
  /** A new invite link: lasts `days`, for `uses` people (null: any number). */
  createInvite(invite: {
    days: number;
    uses: number | null;
    note: string;
    /** Email the link here as well (PL-122). */
    sendTo?: string;
  }): Promise<
    AdminResult<{
      url: string;
      invite: AdminInvite;
      sent?: boolean | null;
      mailProblem?: string | null;
    }>
  >;
  revokeInvite(id: string): Promise<void>;
  identities(id: string): Promise<AdminIdentity[]>;
  /** Start viewing the app as someone (super admins); the token goes to a new tab only. */
  impersonate(id: string, reason: string): Promise<AdminResult<{ token: string; expires: string }>>;
  /** `stranded`: the account has no way to sign in left. */
  unlink(
    id: string,
    provider: string,
    subject: string,
  ): Promise<AdminResult<{ stranded: boolean }>>;

  friends(id: string): Promise<AdminFriend[]>;
  /** Make two people friends, as if one accepted the other's link. */
  makeFriends(a: string, b: string): Promise<void>;
  endFriendship(a: string, b: string): Promise<void>;

  /** Shared lists and groups the account owns (private lists are not listed). */
  shared(id: string): Promise<AdminShare[]>;
  /** Hand them (or only `ids`) to another account; returns how many moved. */
  handOver(from: string, to: string, ids?: string[]): Promise<number>;

  groups(): Promise<AdminGroup[]>;
  addGroup(name: string, offeredForSharing: boolean): Promise<AdminResult>;
  updateGroup(
    id: string,
    change: { name?: string; offeredForSharing?: boolean },
  ): Promise<AdminResult>;
  deleteGroup(id: string): Promise<void>;
  /** Add or remove a member by hand (members from a provider stay). */
  setMember(groupId: string, accountId: string, member: boolean): Promise<void>;

  backups(): Promise<BackupFile[]>;
  backUpNow(): Promise<string>;
  /** Addresses that download (the session cookie goes along). */
  backupUrl(name: string): string;
  exportUrl(): string;
  userExportUrl(id: string): string;
  /** Put one person back as a backup had them (`username` picks them from a whole-server backup). */
  restoreUser(
    source: RestoreSource,
    username?: string,
  ): Promise<{ ok: true; value: UserRestoreResult } | { ok: false; message: string }>;
  /** Restore the whole server: checked now, done at a restart. */
  restoreServer(source: RestoreSource): Promise<{ ok: true } | { ok: false; message: string }>;

  settings(): Promise<ServerSettingsView>;
  /** Save page values (empty to clear); refused with the server's message when one does not work. */
  saveSettings(
    values: Record<string, string>,
  ): Promise<{ ok: true; value: ServerSettingsView } | { ok: false; message: string }>;
  /** Stop the server so it starts again with the saved values (needs a restart policy). */
  restart(): Promise<void>;
  /** Send a test email with the email settings as they apply now (PL-122); the mail server's answer when it fails. */
  sendTestMail(to: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** The daily usage report (PL-116): whether it goes, where, and the report as it would go now. */
  telemetry(): Promise<TelemetryView>;
  /** A new random install id: later reports cannot be tied to earlier ones. */
  renewTelemetryId(): Promise<void>;
  /** Stop the first-start notice about the usage report. */
  telemetryNoticeSeen(): Promise<void>;
  /** The server's own crashes (PL-116), newest first, and whether crash reports are on. */
  crashReports?(): Promise<{ enabled: boolean; crashes: ServerCrash[] }>;
  /** Send one to the project (then it leaves the list). */
  sendCrashReport?(fingerprint: string): Promise<void>;
  /** Take one off the list without sending it. */
  forgetCrashReport?(fingerprint: string): Promise<void>;

  logging(): Promise<LoggingView>;
  /** Downloads a zip of recent logs, settings (secrets hidden), versions and counts. */
  debugDumpUrl(): string;
  /** The access or event log, newest first. */
  audit(query: AuditQuery): Promise<AuditPage>;
  /** Whether the first-run wizard is finished (or was waved away). */
  setup(): Promise<{ done: boolean }>;
  /** Mark the first setup finished: the wizard stops offering itself. */
  finishSetup(): Promise<void>;
  /** Server totals and a row per person (spec: Server stats). */
  stats(): Promise<ServerStats>;
  /** Downloads the filtered log as CSV, oldest first. */
  auditCsvUrl(query: AuditQuery): string;

  providers(): Promise<AdminProvider[]>;
  oidc(): Promise<OidcOverview>;
  /** Whoever signs in through `provider` as `providerUsername` lands in the account from then on. */
  saveMapping(provider: string, providerUsername: string, accountId: string): Promise<AdminResult>;
  removeMapping(provider: string, providerUsername: string): Promise<AdminResult>;
  /** Remap: the provider account signs into `accountId`; nothing the old account owns moves. */
  moveIdentity(
    provider: string,
    subject: string,
    accountId: string,
  ): Promise<AdminResult<{ stranded: string[] }>>;
  unbindAll(provider: string): Promise<AdminResult<{ unbound: number; stranded: string[] }>>;
  openMigrationWindow(provider: string, hours: number): Promise<string>;
  closeMigrationWindow(provider: string): Promise<void>;
  pending(): Promise<PendingSignIn[]>;
  approve(provider: string, subject: string): Promise<void>;
  dismiss(provider: string, subject: string): Promise<void>;
}
