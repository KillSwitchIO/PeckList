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
  /**
   * Which build of the app (api 9): `play`, the Google Play one, which follows Play's rules (no
   * payment links, battery and exact alarms by hand), or `foss`. Absent (an older shell): foss.
   */
  distribution?: 'play' | 'foss';
}

/** A kind of notification with a channel of its own on the phone (PL-115); `constant` has no in-app switch. */
export type PhoneChannelKind = 'reminders' | 'assignments' | 'shares' | 'comments' | 'constant';

/** The in-app switches (settings.notifications) a phone channel's on or off is carried into. */
export type SyncedChannelKind = Exclude<PhoneChannelKind, 'constant'>;

/**
 * The phone's notification channels (api 10): each kind's on or off in Android's settings, and the
 * kinds switched there since the last ask (asking takes them), for the synced switches.
 */
export interface PhoneChannels {
  channels: Partial<Record<PhoneChannelKind, boolean>>;
  changed: Partial<Record<SyncedChannelKind, boolean>>;
}

/**
 * Whether reminders can go off at the exact minute (api 9). `canAsk`: Android 12 and up has a page
 * to allow it and it is not allowed yet (the Play build on Android 14 and up, until the person says
 * yes).
 */
export interface ExactAlarms {
  allowed: boolean;
  canAsk: boolean;
}

/** Why an address cannot be used. */
export type ServerProblem =
  | 'invalid'
  | 'unreachable'
  | 'certificate'
  | 'not-pecklist'
  | 'gated'
  /** Trusted only through a certificate authority installed on this phone (api 8, audit A2). */
  | 'installed-ca';

/**
 * What the person agreed to on the connect page (api 8, audit A2): plain http, or a certificate
 * from an authority installed on this phone. The shell keeps each per server.
 */
export interface ConnectTrust {
  plainHttp?: boolean;
  installedCa?: boolean;
}

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

/**
 * A reminder's Complete or Snooze that the shell held for the app (api 7): pressed standalone, or
 * on a server too old to move a repeating task. `at`: when it was pressed (ms since the epoch).
 */
export interface HeldPress {
  action: 'complete' | 'snooze';
  taskId: string;
  minutes: number;
  at: number;
}

/** What the Android shell counted for the usage report (PL-116), and the permissions reminders need. */
export interface ShellUsage {
  counts: Record<string, number>;
  permissions: { notify: 'on' | 'off'; exact: 'on' | 'off'; battery: 'on' | 'off' };
}

/** A crash or ANR the shell noticed since the app last ran (PL-116). */
export interface ShellCrash {
  kind: string;
  stack: string;
}

export interface NativeShell {
  info(): Promise<ShellInfo>;
  /** The shell's counts since the last ask (asking starts them afresh); older shells have none. */
  usage?(): Promise<ShellUsage | null>;
  /** The crash since the last start, used up by asking; older shells have none. */
  lastCrash?(): Promise<ShellCrash | null>;
  /** Whether an address is a PeckList server, and the origin it answers on. */
  checkServer(address: string): Promise<ServerCheck>;
  /**
   * Run on this server from now on. The app restarts on it, so this never really returns. From
   * api 8 the shell asks in its own dialog first when a server's page calls it (audit A4), and
   * rejects when the person says no.
   */
  connect(url: string, trust?: ConnectTrust): Promise<void>;
  /** Run standalone from now on. The app restarts. From api 8 the shell asks first, as connect. */
  disconnect(): Promise<void>;
  /** Api 2 and up (check info().api first). */
  backgroundCheck(): Promise<BackgroundCheck>;
  setBackgroundCheck(change: { enabled?: boolean; minutes?: number }): Promise<BackgroundCheck>;
  /**
   * Android's dialog to let the app run in the background; the state once it closes. `pressed`:
   * the person pressed a button for it. The Google Play build opens its list of apps only then
   * (from 0.13.0's shell); otherwise it answers with the state.
   */
  allowBackground(pressed?: boolean): Promise<BackgroundCheck>;
  /** Api 5: Android's notification settings for the app (each kind's sound and vibration). */
  notificationSettings(): Promise<void>;
  /**
   * Api 6: keep this device's own tasks (a workspace file) for the server it is about to connect
   * to; after signing in there, the server's web app asks whether they join the account (PL-070).
   */
  carry(workspace: string, server: string): Promise<void>;
  /** Api 6: the tasks handed over for the server the app is on now; null when there are none. */
  carried(): Promise<string | null>;
  /** Api 6: forget the handed-over tasks (added to the account, or left on the phone). */
  clearCarried(): Promise<void>;
  /** Api 7: the reminder presses held for the app, oldest first; taking them clears them. */
  held(): Promise<HeldPress[]>;
  /** Api 7: `listener` runs whenever another press is held; returns a stop function. */
  onHeld(listener: () => void): () => void;
  /** Api 9: whether exact alarms are allowed, and whether there is a page to allow them. */
  exactAlarms?(): Promise<ExactAlarms>;
  /** Api 9: Android's page to allow exact alarms; the state once it closes, or at once with nothing to ask. */
  allowExactAlarms?(): Promise<ExactAlarms>;
  /** Api 10: each kind's channel on or off on the phone, and the kinds switched there since the last ask. */
  notificationChannels?(): Promise<PhoneChannels>;
  /** Api 10: one kind's channel in Android's settings (its on or off, sound and vibration). */
  openNotificationChannel?(kind: PhoneChannelKind): Promise<void>;
}
