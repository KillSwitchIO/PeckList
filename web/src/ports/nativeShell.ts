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
  /** Left a server on purpose, so no connect page on start (api 3; older: absent). */
  choseStandalone?: boolean;
}

/** Why an address cannot be used. */
export type ServerProblem = 'invalid' | 'unreachable' | 'certificate' | 'not-punchlist' | 'gated';

export type ServerCheck =
  | { ok: true; url: string; info: ServerInfo }
  /** `url`: the origin it answered on, for a sign-in page in front of it (gated). */
  | { ok: false; problem: ServerProblem; url?: string };

/**
 * The background check-in (api 2): with the app closed, Android wakes it every few minutes to ask
 * the server what is new and set the reminders ahead. On unless turned off.
 */
export interface BackgroundCheck {
  enabled: boolean;
  minutes: number;
  /** The intervals to choose from, in minutes. */
  choices: number[];
  /** Whether Android lets the app run in the background (no battery optimization), so checks come on time. */
  unrestricted: boolean;
  /** Whether the app has asked for that already (it asks once by itself). */
  asked: boolean;
  /** The phone's maker, lowercase ("samsung"): some put apps to sleep on top of Android. */
  maker: string;
}

export interface NativeShell {
  info(): Promise<ShellInfo>;
  /** Whether an address is a Punchlist server, and the origin it answers on. */
  checkServer(address: string): Promise<ServerCheck>;
  /** Run on this server from now on. The app restarts on it, so this never really returns. */
  connect(url: string): Promise<void>;
  /** Run standalone from now on. The app restarts. */
  disconnect(): Promise<void>;
  /** Api 2 and up (check info().api first). */
  backgroundCheck(): Promise<BackgroundCheck>;
  setBackgroundCheck(change: { enabled?: boolean; minutes?: number }): Promise<BackgroundCheck>;
  /** Android's dialog to let the app run in the background; the state once it closes. */
  allowBackground(): Promise<BackgroundCheck>;
  /** Api 5: Android's notification settings for the app (each kind's sound and vibration). */
  notificationSettings(): Promise<void>;
}
