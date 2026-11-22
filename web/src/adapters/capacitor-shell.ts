import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type {
  BackgroundCheck,
  ConnectTrust,
  ExactAlarms,
  HeldPress,
  NativeShell,
  NativeStoreCalls,
  PhoneChannelKind,
  PhoneChannels,
  ServerCheck,
  ShortcutList,
  ServerProblem,
  ShellCrash,
  ShellInfo,
  ShellUsage,
  StorePage,
  StoreSave,
  StoreWhole,
  WidgetFeed,
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
  allowBackground(options: { pressed: boolean }): Promise<BackgroundCheck>;
  notificationSettings(): Promise<void>;
  carry(options: { data: string; server: string }): Promise<void>;
  carried(): Promise<{ data?: string }>;
  clearCarried(): Promise<void>;
  held(): Promise<{ presses?: unknown }>;
  addListener(event: 'held', listener: () => void): Promise<PluginListenerHandle>;
  exactAlarms(): Promise<ExactAlarms>;
  allowExactAlarms(): Promise<ExactAlarms>;
  notificationChannels(): Promise<Partial<PhoneChannels>>;
  openNotificationChannel(options: { kind: PhoneChannelKind }): Promise<void>;
  setShortcuts(options: { lists: ShortcutList[] }): Promise<void>;
  showKeyboard(): Promise<void>;
  setWidgetTasks(feed: WidgetFeed): Promise<void>;
  takeAddText(): Promise<{ text?: unknown }>;
  saveSignIn(): Promise<void>;
  setLanguage(options: { language: string | null }): Promise<void>;
  setClock(options: { twentyFour: boolean | null }): Promise<void>;
  storeLoad(options: { origin: string; after: string | null; budget?: number }): Promise<unknown>;
  storeSave(options: { origin: string } & StoreSave): Promise<void>;
  storeClear(options: { origin: string }): Promise<void>;
  storeGet(options: { origin: string; key: string }): Promise<{ json?: unknown }>;
  storePut(options: { origin: string; entries: [string, string | null][] }): Promise<void>;
  storeKeys(options: { origin: string; prefix: string }): Promise<{ keys?: unknown }>;
  storeWipe(options: { origin: string }): Promise<void>;
}

const isPair = (row: unknown): row is [string, string] =>
  Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string';

/** A page the shell answered with; anything else is an error, not an empty store. */
export function storePage(answer: unknown): StorePage {
  const page = answer as { header?: unknown; rows?: unknown; next?: unknown } | null;
  const header = page?.header ?? null;
  const next = page?.next ?? null;
  if (
    (header !== null && typeof header !== 'string') ||
    (next !== null && typeof next !== 'string') ||
    !Array.isArray(page?.rows) ||
    !page.rows.every(isPair)
  ) {
    throw new Error('the native store answered with something unreadable');
  }
  return { header, rows: page.rows, next };
}

/**
 * Api 18: the whole native store in one read, a GET on the page's own origin that the shell answers
 * itself (ShellWebViewClient), rows and all as one JSON text: no bridge message, no JSON inside
 * JSON, which made a cold start on Android wait seconds (PL-149). The header asks for it; a page on
 * another origin cannot send it without asking first, and the shell answers nothing to that.
 */
export const WHOLE_STORE_API = 18;
export const WHOLE_STORE_PATH = '/__pecklist/native-store';
export const WHOLE_STORE_HEADER = 'X-PeckList-Store';

const isRow = (row: unknown): row is [string, unknown] =>
  Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && isObject(row[1]);
const isObject = (value: unknown) => typeof value === 'object' && value !== null;

/**
 * The shell's answer to the whole read: null when it is not the shell's (no read to be had, so
 * pages instead); anything else unreadable is an error, not an empty store.
 */
export async function storeWhole(answer: Response): Promise<StoreWhole | null> {
  if (answer.status !== 200 || answer.headers.get(WHOLE_STORE_HEADER) !== '1') return null;
  const body = (await answer.json()) as { header?: unknown; rows?: unknown } | null;
  const header = body?.header ?? null;
  if (
    (header !== null && !isObject(header)) ||
    !Array.isArray(body?.rows) ||
    !body.rows.every(isRow)
  ) {
    throw new Error('the native store answered with something unreadable');
  }
  return { header, rows: body.rows };
}

/**
 * Android's own storage (api 16), for the origin this page is on: every call says it, and the shell
 * refuses one that arrives once the WebView is somewhere else (PL-070).
 */
export function nativeStoreCalls(plugin: ShellPlugin): NativeStoreCalls {
  // Read as each call is made, never kept: it is what the shell checks against the WebView.
  const origin = () => location.origin;
  let api: Promise<number> | null = null;
  return {
    whole: async () => {
      // No whole read to be had (an older shell, or info or the fetch failing: offline, or a
      // service worker passing the request on to a server that is not there) means pages, never a
      // failed load. A failed info() is not kept, so the next load asks again.
      let answer: Response;
      try {
        api ??= plugin.info().then((info) => shellInfo(info).api);
        if ((await api) < WHOLE_STORE_API) return null;
        answer = await fetch(WHOLE_STORE_PATH, {
          headers: { [WHOLE_STORE_HEADER]: '1' },
          cache: 'no-store',
          credentials: 'omit',
        });
      } catch {
        api = null;
        return null;
      }
      // The shell's own answer that does not read is an error, not an empty store.
      return storeWhole(answer);
    },
    load: async (after, budget) =>
      storePage(
        await plugin.storeLoad({
          origin: origin(),
          after,
          ...(budget === undefined ? {} : { budget }),
        }),
      ),
    save: (change) => plugin.storeSave({ origin: origin(), ...change }),
    clear: () => plugin.storeClear({ origin: origin() }),
    async get(key) {
      const { json } = await plugin.storeGet({ origin: origin(), key });
      if (json === null || json === undefined) return null;
      if (typeof json !== 'string')
        throw new Error('the native store answered with something unreadable');
      return json;
    },
    put: (entries) => plugin.storePut({ origin: origin(), entries }),
    async keys(prefix) {
      const { keys } = await plugin.storeKeys({ origin: origin(), prefix });
      return Array.isArray(keys)
        ? keys.filter((key): key is string => typeof key === 'string')
        : [];
    },
    wipe: () => plugin.storeWipe({ origin: origin() }),
  };
}

const CHANNEL_KINDS: PhoneChannelKind[] = [
  'reminders',
  'assignments',
  'shares',
  'comments',
  'constant',
];

/** The channels the shell answered with, keeping only the kinds it knows and true or false values. */
export function phoneChannels(answer: Partial<PhoneChannels> | null | undefined): PhoneChannels {
  const pick = (from: unknown, kinds: PhoneChannelKind[]) => {
    const out: Partial<Record<PhoneChannelKind, boolean>> = {};
    if (from && typeof from === 'object')
      for (const kind of kinds) {
        const value = (from as Record<string, unknown>)[kind];
        if (typeof value === 'boolean') out[kind] = value;
      }
    return out;
  };
  return {
    channels: pick(answer?.channels, CHANNEL_KINDS),
    changed: pick(
      answer?.changed,
      CHANNEL_KINDS.filter((kind) => kind !== 'constant'),
    ) as PhoneChannels['changed'],
  };
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

/** The shell's info() answer, kept to what the web app knows. */
export function shellInfo(answer: ShellInfo): ShellInfo {
  const { distribution, installer, installRequestedBy, ...rest } = answer;
  return {
    ...rest,
    server: answer.server ?? null,
    // Only the two names it knows; anything else (or nothing, an older shell) is foss.
    ...(distribution === 'play' || distribution === 'foss' ? { distribution } : {}),
    // A package name or null; an older shell sends none, and stays without.
    ...packageField('installer', installer),
    ...packageField('installRequestedBy', installRequestedBy),
  };
}

/** A package name or null under its key; nothing when an older shell sent none. */
function packageField<K extends 'installer' | 'installRequestedBy'>(
  key: K,
  value: unknown,
): Partial<Record<K, string | null>> {
  if (value === undefined) return {};
  return { [key]: typeof value === 'string' ? value : null } as Partial<Record<K, string | null>>;
}

/** The Android shell, through Capacitor; null in a browser or a shell without the plugin. */
export function createCapacitorShell(): NativeShell | null {
  const name = shellPluginName();
  if (!name) return null;
  const plugin = registerPlugin<ShellPlugin>(name);
  return {
    async info() {
      return shellInfo(await plugin.info());
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
    allowBackground: (pressed) => plugin.allowBackground({ pressed: pressed === true }),
    notificationSettings: () => plugin.notificationSettings(),
    carry: (data, server) => plugin.carry({ data, server }),
    carried: async () => (await plugin.carried()).data ?? null,
    clearCarried: () => plugin.clearCarried(),
    held: async () => heldPresses(await plugin.held()),
    onHeld(listener) {
      const listening = plugin.addListener('held', listener);
      return () => void listening.then((handle) => handle.remove());
    },
    exactAlarms: () => plugin.exactAlarms(),
    allowExactAlarms: () => plugin.allowExactAlarms(),
    notificationChannels: async () => phoneChannels(await plugin.notificationChannels()),
    openNotificationChannel: (kind) => plugin.openNotificationChannel({ kind }),
    setShortcuts: (lists) => plugin.setShortcuts({ lists }),
    // An older shell has none: the field is focused, a tap brings the keyboard.
    showKeyboard: () => plugin.showKeyboard().catch(() => undefined),
    setWidgetTasks: (feed) => plugin.setWidgetTasks(feed),
    // An older shell has none (the call fails): nothing waiting.
    takeAddText: () =>
      plugin.takeAddText().then(
        ({ text }) => (typeof text === 'string' && text.trim() ? text : null),
        () => null,
      ),
    saveSignIn: () => plugin.saveSignIn(),
    setLanguage: (language) => plugin.setLanguage({ language }),
    setClock: (twentyFour) => plugin.setClock({ twentyFour }),
    store: nativeStoreCalls(plugin),
  };
}
