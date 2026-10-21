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
  role: 'admin' | 'user';
  mustChangePassword: boolean;
  authMode: 'local' | 'none';
}

export interface SyncRequest {
  schemaVersion: number;
  cursor: number | null;
  changes: SyncChange[];
}

export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
  more: boolean;
  revoked: string[];
}

export type LoginOutcome =
  | { kind: 'ok'; account: Account }
  | { kind: 'invalid' }
  | { kind: 'locked'; until: string }
  | { kind: 'too-many' };

export type PasswordOutcome =
  { kind: 'ok'; account: Account } | { kind: 'wrong-password' | 'too-short' | 'unchanged' };

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
  login(username: string, password: string): Promise<LoginOutcome>;
  logout(): Promise<void>;
  changePassword(current: string, next: string): Promise<PasswordOutcome>;
  sync(request: SyncRequest): Promise<SyncResponse>;
}
