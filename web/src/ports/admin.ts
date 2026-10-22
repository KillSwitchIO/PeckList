// What admins manage on a server (spec: Accounts & Admin, Admin UI). Adapter: HTTP to /api/admin.

export type AccountRole = 'superadmin' | 'admin' | 'user';

export interface AdminUser {
  id: string;
  username: string;
  role: AccountRole;
  disabled: boolean;
  createdAt: string;
  /** Server groups the account is in. */
  groups: string[];
  hasPassword: boolean;
  mustChangePassword: boolean;
  /** Identity providers linked to the account. */
  providers: string[];
}

export interface AdminIdentity {
  provider: string;
  displayName: string;
  subject: string;
  email: string | null;
  linkedAt: string;
  lastUsedAt: string;
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
}

export interface ServerSettingsView {
  settings: ServerSetting[];
  /** Saved values differ from those the server started with. */
  pendingRestart: boolean;
  /** Why the saved values were set aside at the last start, if they were. */
  problem: string | null;
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
  | 'admins-only';

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
  /** A generated password the person must change; shown once. */
  resetPassword(id: string): Promise<AdminResult<string>>;
  loginLink(id: string): Promise<AdminResult<{ url: string; expires: string }>>;
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

  settings(): Promise<ServerSettingsView>;
  /** Save page values (empty to clear); refused with the server's message when one does not work. */
  saveSettings(
    values: Record<string, string>,
  ): Promise<{ ok: true; value: ServerSettingsView } | { ok: false; message: string }>;
  /** Stop the server so it starts again with the saved values (needs a restart policy). */
  restart(): Promise<void>;

  providers(): Promise<AdminProvider[]>;
  unbindAll(provider: string): Promise<{ unbound: number; stranded: string[] }>;
  openMigrationWindow(provider: string, hours: number): Promise<string>;
  closeMigrationWindow(provider: string): Promise<void>;
  pending(): Promise<PendingSignIn[]>;
  approve(provider: string, subject: string): Promise<void>;
  dismiss(provider: string, subject: string): Promise<void>;
}
