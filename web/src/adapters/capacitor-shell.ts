import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type {
  BackgroundCheck,
  ConnectTrust,
  HeldPress,
  NativeShell,
  ServerCheck,
  ServerProblem,
  ShellCrash,
  ShellInfo,
  ShellUsage,
} from '../ports/nativeShell.ts';
import type { ServerInfo } from '../ports/sync.ts';

/** `ShellPlugin.java` in mobile/android: what it takes and answers. */
interface ShellPlugin {
  info(): Promise<ShellInfo>;
  usage(): Promise<ShellUsage>;
  lastCrash(): Promise<{ crash?: ShellCrash | null }>;
  checkServer(options: { url: string }): Promise<{ url: string; info: ServerInfo }>;
  connect(options: { url: string } & ConnectTrust): Promise<void>;
  disconnect(): Promise<void>;
  backgroundCheck(): Promise<BackgroundCheck>;
  setBackgroundCheck(options: { enabled?: boolean; minutes?: number }): Promise<BackgroundCheck>;
  allowBackground(): Promise<BackgroundCheck>;
  notificationSettings(): Promise<void>;
  carry(options: { data: string; server: string }): Promise<void>;
  carried(): Promise<{ data?: string }>;
  clearCarried(): Promise<void>;
  held(): Promise<{ presses?: unknown }>;
  addListener(event: 'held', listener: () => void): Promise<PluginListenerHandle>;
}

/** The presses the shell answered with, leaving out any it got wrong. */
export function heldPresses(answer: { presses?: unknown }): HeldPress[] {
  if (!Array.isArray(answer.presses)) return [];
  return answer.presses.flatMap((each: unknown) => {
    const press = each as Partial<Record<keyof HeldPress, unknown>> | null;
    const action = press?.action;
    if (
      (action !== 'complete' && action !== 'snooze') ||
      typeof press?.taskId !== 'string' ||
      typeof press.minutes !== 'number' ||
      typeof press.at !== 'number'
    ) {
      return [];
    }
    return [{ action, taskId: press.taskId, minutes: press.minutes, at: press.at }];
  });
}

const PROBLEMS: readonly ServerProblem[] = [
  'invalid',
  'unreachable',
  'certificate',
  'not-pecklist',
  'gated',
  'installed-ca',
];

/** A rejected call's code, as the plugin names the problem; anything else is "unreachable". */
export function problemOf(error: unknown): ServerProblem {
  const code = (error as { code?: unknown } | null)?.code;
  // Shells from before the rename (PL-127) say not-punchlist.
  if (code === 'not-punchlist') return 'not-pecklist';
  return PROBLEMS.find((each) => each === code) ?? 'unreachable';
}

/**
 * The shell plugin's name in this app: PeckListShell, or PunchlistShell in an APK from before the
 * rename (PL-127); null in a browser or a shell without either.
 */
export function shellPluginName(): 'PeckListShell' | 'PunchlistShell' | null {
  if (!Capacitor.isNativePlatform()) return null;
  if (Capacitor.isPluginAvailable('PeckListShell')) return 'PeckListShell';
  return Capacitor.isPluginAvailable('PunchlistShell') ? 'PunchlistShell' : null;
}

/** The Android shell, through Capacitor; null in a browser or a shell without the plugin. */
export function createCapacitorShell(): NativeShell | null {
  const name = shellPluginName();
  if (!name) return null;
  const plugin = registerPlugin<ShellPlugin>(name);
  return {
    async info() {
      const answer = await plugin.info();
      return { ...answer, server: answer.server ?? null };
    },
    async checkServer(address): Promise<ServerCheck> {
      try {
        const { url, info } = await plugin.checkServer({ url: address });
        return { ok: true, url, info };
      } catch (error) {
        const url = (error as { data?: { url?: unknown } } | null)?.data?.url;
        return {
          ok: false,
          problem: problemOf(error),
          ...(typeof url === 'string' ? { url } : {}),
        };
      }
    },
    // A shell from before PL-116 answers these with an error: nothing to tell.
    usage: () => plugin.usage().catch(() => null),
    lastCrash: async () => (await plugin.lastCrash().catch(() => ({ crash: null }))).crash ?? null,
    connect: (url, trust) => plugin.connect({ url, ...trust }),
    disconnect: () => plugin.disconnect(),
    backgroundCheck: () => plugin.backgroundCheck(),
    setBackgroundCheck: (change) => plugin.setBackgroundCheck(change),
    allowBackground: () => plugin.allowBackground(),
    notificationSettings: () => plugin.notificationSettings(),
    carry: (data, server) => plugin.carry({ data, server }),
    carried: async () => (await plugin.carried()).data ?? null,
    clearCarried: () => plugin.clearCarried(),
    held: async () => heldPresses(await plugin.held()),
    onHeld(listener) {
      const listening = plugin.addListener('held', listener);
      return () => void listening.then((handle) => handle.remove());
    },
  };
}
