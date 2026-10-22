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

/** Why an admin action was refused, when the person can do something about it. */
export type AdminRefusal =
  'last-super-admin' | 'self' | 'taken' | 'invalid' | 'too-short' | 'admins-only';

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
  /** `stranded`: the account has no way to sign in left. */
  unlink(
    id: string,
    provider: string,
    subject: string,
  ): Promise<AdminResult<{ stranded: boolean }>>;

  groups(): Promise<AdminGroup[]>;
  addGroup(name: string, offeredForSharing: boolean): Promise<AdminResult>;
  updateGroup(
    id: string,
    change: { name?: string; offeredForSharing?: boolean },
  ): Promise<AdminResult>;
  deleteGroup(id: string): Promise<void>;
  /** Add or remove a member by hand (members from a provider stay). */
  setMember(groupId: string, accountId: string, member: boolean): Promise<void>;

  providers(): Promise<AdminProvider[]>;
  unbindAll(provider: string): Promise<{ unbound: number; stranded: string[] }>;
  openMigrationWindow(provider: string, hours: number): Promise<string>;
  closeMigrationWindow(provider: string): Promise<void>;
  pending(): Promise<PendingSignIn[]>;
  approve(provider: string, subject: string): Promise<void>;
  dismiss(provider: string, subject: string): Promise<void>;
}
