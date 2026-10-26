import type { UserStats } from './stats.ts';
import type { SyncChange } from '../core/sync.ts';
import type { AdminApi } from './admin.ts';

/** What `/api/info` says about the server. */
export interface ServerInfo {
  name: string;
  version: string;
  schemaVersion: number;
  /** The server's time zone, the default for people who pick none (older servers: absent). */
  timeZone?: string | null;
  /** The largest file the server takes, in megabytes (older servers: absent). */
  attachmentMaxMb?: number | null;
  /** Whether the Android app may sign in through a browser tab (older servers: absent). */
  appSignIn?: boolean;
}

/** What became of a file sent to the server. */
export type UploadOutcome = 'stored' | 'too-large' | 'refused';

/** Attached files on the server, by the SHA-256 of their bytes (spec: PL-051). */
export interface FileApi {
  /** Whether the server holds the file already. */
  has(sha256: string): Promise<boolean>;
  upload(sha256: string, file: Blob): Promise<UploadOutcome>;
  /** The file, or null when the server has none this person may see. */
  download(sha256: string): Promise<Blob | null>;
}

/** The signed-in account (`/auth/me`). */
export interface Account {
  id: string;
  username: string;
  role: 'superadmin' | 'admin' | 'user';
  mustChangePassword: boolean;
  authMode: 'local' | 'none';
  /** The identity provider this session came through, if any. */
  provider?: string | null;
  /** Where the server serves that provider's icon (it answers 404 when there is none). */
  providerIcon?: string | null;
  /** The provider has a picture of the person (served at /api/account/provider-picture) */
  hasProviderPicture?: boolean;
  /** Whether passwords work on this server (false with `LOCAL_LOGIN=disabled`; older servers: absent). */
  localLogin?: boolean;
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
  /**
   * Which life of the server's data this is; it changes when a backup is restored over it, and a
   * device then starts over from what the server has. Absent from older servers.
   */
  epoch?: string | null;
  /**
   * Pushed changes the server set aside (malformed, or stamped too far ahead of its clock). It
   * took the rest of the push; the device keeps its copy of these. Absent from older servers.
   */
  invalid?: SyncInvalid[];
  /** The server's time (ISO), so the device can tell when its own clock is off. */
  serverTime?: string | null;
}

/** One pushed change the server set aside, and why. */
export interface SyncInvalid {
  /** Where it was in the push. */
  index: number;
  id: string | null;
  /** `invalid_change` or `clock_drift`. */
  code: string;
  reason: string;
}

/** Ways to sign in on this server (`/auth/providers`). */
export interface SignInOptions {
  /** Identity providers, each with the address that starts its sign-in. */
  providers: { name: string; displayName: string; url: string; icon?: string }[];
  /** False when the server turns password sign-in off (`LOCAL_LOGIN=disabled`). */
  localLogin: boolean;
  /** Who may make an account: anyone, people with an invite link, or nobody (older servers: closed). */
  registration?: Registration;
}

export type Registration = 'open' | 'invite' | 'closed';

export type SignUpOutcome =
  | { kind: 'ok'; account: Account }
  | {
      kind:
        | 'username-taken'
        | 'invalid-username'
        | 'too-short'
        | 'invite-invalid'
        | 'closed'
        | 'too-many';
    };

export type LoginOutcome =
  | { kind: 'ok'; account: Account }
  | { kind: 'invalid' }
  | { kind: 'locked'; until: string }
  | { kind: 'too-many' }
  /** Password sign-in is turned off on the server (`LOCAL_LOGIN=disabled`). */
  | { kind: 'disabled' };

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
  /** This account's own numbers, the same as on the admin's stats page. */
  stats(): Promise<UserStats>;
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

/** One of my notifications on the server (spec: PL-061): ids only, the app names them. */
export interface ServerNotification {
  id: string;
  kind: 'assigned' | 'shared' | 'mentioned' | 'reminder';
  /** ISO time */
  at: string;
  actorId: string | null;
  taskId: string | null;
  listId: string | null;
  commentId: string | null;
  read: boolean;
}

export interface NotificationsApi {
  /** My latest notifications, newest first, and how many are unread. */
  list(): Promise<{ items: ServerNotification[]; unread: number }>;
  /** Mark some (null: all) read. */
  read(ids: string[] | null): Promise<void>;
  /** Clear some (null: all). */
  clear(ids: string[] | null): Promise<void>;
}

/** Web Push on the server (spec: PL-061): its key, and this browser's subscription. */
export interface PushApi {
  /** The server's VAPID public key (base64url). */
  key(): Promise<string>;
  /** Save this browser's subscription (`PushSubscription.toJSON()`). */
  subscribe(subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }): Promise<void>;
  unsubscribe(endpoint: string): Promise<void>;
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
  /** With `invite`, the providers' addresses carry it, so a new provider account may come in on it. */
  signInOptions?(returnUrl: string, invite?: string): Promise<SignInOptions>;
  login(username: string, password: string): Promise<LoginOutcome>;
  /** Make an account and sign in (optional: older servers have no sign-up). */
  signUp?(username: string, password: string, invite?: string): Promise<SignUpOutcome>;
  /** When an invite link stops working, or null when it already has (used, revoked, expired). */
  checkInvite?(token: string): Promise<{ expires: string } | null>;
  /**
   * End the session. A session from a provider set to sign out there too answers with the
   * provider's end-session address, for the browser to go to next.
   */
  logout(): Promise<{ redirect: string } | undefined>;
  changePassword(current: string, next: string): Promise<PasswordOutcome>;
  sync(request: SyncRequest): Promise<SyncResponse>;
  /**
   * Hear about changes as they happen (optional: without it the app syncs on its timer). Returns
   * a function that stops listening. Reconnecting after a drop is the transport's job.
   */
  events?(onChange: (change: ChangeEvent) => void): () => void;
  friends?: FriendsApi;
  /** Notifications (optional: older servers keep none). */
  notifications?: NotificationsApi;
  /** Web Push (optional: older servers send none). */
  push?: PushApi;
  account?: AccountApi;
  /** Attached files (optional: older servers keep none). */
  files?: FileApi;
  /** Admin actions; the server refuses them for anyone without the permission. */
  admin?: AdminApi;
}
