import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  BackgroundCheck,
  NativeShell,
  ServerCheck,
  ServerProblem,
  ShellInfo,
} from '../ports/nativeShell.ts';
import type { ServerInfo } from '../ports/sync.ts';

/** `ShellPlugin.java` in mobile/android: what it takes and answers. */
interface ShellPlugin {
  info(): Promise<ShellInfo>;
  checkServer(options: { url: string }): Promise<{ url: string; info: ServerInfo }>;
  connect(options: { url: string }): Promise<void>;
  disconnect(): Promise<void>;
  backgroundCheck(): Promise<BackgroundCheck>;
  setBackgroundCheck(options: { enabled?: boolean; minutes?: number }): Promise<BackgroundCheck>;
  allowBackground(): Promise<BackgroundCheck>;
}

const PROBLEMS: readonly ServerProblem[] = [
  'invalid',
  'unreachable',
  'certificate',
  'not-punchlist',
  'gated',
];

/** A rejected call's code, as the plugin names the problem; anything else is "unreachable". */
export function problemOf(error: unknown): ServerProblem {
  const code = (error as { code?: unknown } | null)?.code;
  return PROBLEMS.find((each) => each === code) ?? 'unreachable';
}

/** The Android shell, through Capacitor; null in a browser or a shell without the plugin. */
export function createCapacitorShell(): NativeShell | null {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PunchlistShell')) return null;
  const plugin = registerPlugin<ShellPlugin>('PunchlistShell');
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
    connect: (url) => plugin.connect({ url }),
    disconnect: () => plugin.disconnect(),
    backgroundCheck: () => plugin.backgroundCheck(),
    setBackgroundCheck: (change) => plugin.setBackgroundCheck(change),
    allowBackground: () => plugin.allowBackground(),
  };
}
