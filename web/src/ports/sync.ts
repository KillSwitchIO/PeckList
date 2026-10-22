import type { SyncChange } from '../core/sync.ts';

/** What `/api/info` says about the server. */
export interface ServerInfo {
  name: string;
  version: string;
  schemaVersion: number;
}

/** The signed-in account (`/auth/me`). */
export interface Account {
  id: string;
  username: string;
  role: 'superadmin' | 'admin' | 'user';
  mustChangePassword: boolean;
  authMode: 'local' | 'none';
}

export interface SyncRequest {
  schemaVersion: number;
  cursor: number | null;
  changes: SyncChange[];
}

/** The server says the user's data changed (another device synced). */
export interface ChangeEvent {
  cursor: number;
  /** The device that made the change, so a device can skip its own. */
  source: string | null;
}

export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
  more: boolean;
  revoked: string[];
  /** Pushed changes the server refused (the user may not make them). Absent from older servers. */
  rejected?: string[];
  /** The server's copies of refused entities the user may see: they replace the device's own. */
  corrections?: SyncChange[];
}

/** Ways to sign in on this server (`/auth/providers`). */
export interface SignInOptions {
  /** Identity providers, each with the address that starts its sign-in. */
  providers: { name: string; displayName: string; url: string }[];
  /** False when the server hides the password form (`/login?local` still shows it). */
  localLogin: boolean;
}

export type LoginOutcome =
  | { kind: 'ok'; account: Account }
  | { kind: 'invalid' }
  | { kind: 'locked'; until: string }
  | { kind: 'too-many' };

export type PasswordOutcome =
  { kind: 'ok'; account: Account } | { kind: 'wrong-password' | 'too-short' | 'unchanged' };

/** Who someone is, before becoming friends (a friend link or a lookup). */
export interface ProfilePreview {
  userId: string;
  username: string;
  displayName: string;
  handle: string;
  avatarColor: string;
  memberSince: string;
  /** The viewer's own link. */
  self: boolean;
  friendship: 'accepted' | 'pending' | null;
}

/** How the signed-in account can sign in (`/api/account/sign-in`). */
export interface SignInMethods {
  password: boolean;
  identities: {
    provider: string;
    displayName: string;
    subject: string;
    email: string | null;
    linkedAt: string;
    lastUsedAt: string;
  }[];
  /** Providers not linked yet, each with the address that starts linking it. */
  canLink: { name: string; displayName: string; url: string }[];
}

/** The signed-in user's own account (servers with accounts). */
export interface AccountApi {
  signInMethods(): Promise<SignInMethods>;
  /** `last-way-in` when it is the account's only way to sign in, so it stays. */
  unlink(provider: string, subject: string): Promise<'ok' | 'last-way-in'>;
}

/** Friend links and lookups (servers only). */
export interface FriendsApi {
  /** This account's friend link; `rotate` makes a new one and retires the old. */
  code(rotate?: boolean): Promise<{ code: string; link: string }>;
  /** Who a link belongs to, or null for an unknown or retired code. */
  preview(code: string): Promise<ProfilePreview | null>;
  /** Accept a link: friends at once. Returns the friendship id, or null when the code leads nowhere. */
  accept(code: string): Promise<string | null>;
  /** Someone by exact username or handle, or null. */
  lookup(query: string): Promise<ProfilePreview | null>;
}

/**
 * Why a request failed: `offline` (no answer), `signed-out` (401), `password-change` (must change
 * the password first), `schema` (the server speaks another schema version), `rejected` (the
 * server refused the data), `server` (anything else).
 */
export class SyncFailure extends Error {
  constructor(
    readonly kind: 'offline' | 'signed-out' | 'password-change' | 'schema' | 'rejected' | 'server',
    message: string,
    readonly serverSchemaVersion?: number,
  ) {
    super(message);
    this.name = 'SyncFailure';
  }
}

/**
 * The server, as the app sees it (adapter: HTTP to the same origin). Every call either answers or
 * throws a `SyncFailure`.
 */
export interface SyncTransport {
  /** The server's info, or null when this origin serves no Punchlist server (a static PWA). */
  info(): Promise<ServerInfo | null>;
  /** The signed-in account, or null when not signed in. */
  me(): Promise<Account | null>;
  /** Identity providers and whether the password form shows (optional: older servers have none). */
  signInOptions?(returnUrl: string): Promise<SignInOptions>;
  login(username: string, password: string): Promise<LoginOutcome>;
  logout(): Promise<void>;
  changePassword(current: string, next: string): Promise<PasswordOutcome>;
  sync(request: SyncRequest): Promise<SyncResponse>;
  /**
   * Hear about changes as they happen (optional: without it the app syncs on its timer). Returns
   * a function that stops listening. Reconnecting after a drop is the transport's job.
   */
  events?(onChange: (change: ChangeEvent) => void): () => void;
  friends?: FriendsApi;
  account?: AccountApi;
}
