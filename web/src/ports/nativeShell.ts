import type { ServerInfo } from './sync.ts';

/**
 * The Android app around the web app (ADR-0017), when there is one. It decides which server the
 * WebView runs on: none (standalone, the bundled web build) or one the person connected to, whose
 * own web build then runs. Browsers have no shell.
 */
export interface ShellInfo {
  /** Which methods the shell has; only ever grows. */
  api: number;
  /** The server the app runs on, as an origin; null when standalone. */
  server: string | null;
  /** The app's own version (its web build may be the server's). */
  version: string;
}

/** Why an address cannot be used. */
export type ServerProblem = 'invalid' | 'unreachable' | 'certificate' | 'not-punchlist';

export type ServerCheck =
  { ok: true; url: string; info: ServerInfo } | { ok: false; problem: ServerProblem };

export interface NativeShell {
  info(): Promise<ShellInfo>;
  /** Whether an address is a Punchlist server, and the origin it answers on. */
  checkServer(address: string): Promise<ServerCheck>;
  /** Run on this server from now on. The app restarts on it, so this never really returns. */
  connect(url: string): Promise<void>;
  /** Run standalone from now on. The app restarts. */
  disconnect(): Promise<void>;
}
