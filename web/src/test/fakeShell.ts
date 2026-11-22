import type {
  BackgroundCheck,
  ExactAlarms,
  HeldPress,
  NativeShell,
  ShellInfo,
} from '../ports/nativeShell.ts';

/**
 * An Android shell for tests: connected to a server, at the api and build a test asks for. It
 * counts what the web app asks of it (Android's battery page, the exact alarms page).
 */
export class FakeShell implements NativeShell {
  background: BackgroundCheck = {
    enabled: true,
    minutes: 5,
    choices: [5, 15, 30, 60],
    unrestricted: false,
    asked: false,
    maker: 'google',
  };
  exact: ExactAlarms = { allowed: true, canAsk: false };
  /** What Android's exact alarms page does when opened: the person allows them, or backs out. */
  allowsExact = true;
  batteryOpened = 0;
  exactOpened = 0;
  /** The app that installed this one (`info().installer`); undefined: an older shell's answer. */
  installer: string | null | undefined = undefined;
  /** The app that asked for the install (`info().installRequestedBy`); undefined: not sent. */
  installRequestedBy: string | null | undefined = undefined;
  /** The phone's 12/24-hour setting (`info().clock24`, api 17); undefined: not sent. */
  clock24: boolean | undefined = undefined;

  constructor(
    public api = 9,
    public distribution: ShellInfo['distribution'] = undefined,
    public version = '0.1.0',
  ) {}

  info(): Promise<ShellInfo> {
    return Promise.resolve({
      api: this.api,
      server: 'https://tasks.example.com',
      version: this.version,
      ...(this.distribution ? { distribution: this.distribution } : {}),
      ...(this.installer === undefined ? {} : { installer: this.installer }),
      ...(this.installRequestedBy === undefined
        ? {}
        : { installRequestedBy: this.installRequestedBy }),
      ...(this.clock24 === undefined ? {} : { clock24: this.clock24 }),
    });
  }
  checkServer() {
    return Promise.resolve({ ok: false as const, problem: 'unreachable' as const });
  }
  connect() {
    return Promise.resolve();
  }
  disconnect() {
    return Promise.resolve();
  }
  backgroundCheck() {
    return Promise.resolve({ ...this.background });
  }
  setBackgroundCheck(change: { enabled?: boolean; minutes?: number }) {
    this.background = { ...this.background, ...change };
    return this.backgroundCheck();
  }
  /** Each allowBackground call's `pressed`. */
  pressed: (boolean | undefined)[] = [];
  allowBackground(pressed?: boolean) {
    this.pressed.push(pressed);
    this.batteryOpened += 1;
    this.background = { ...this.background, asked: true };
    return this.backgroundCheck();
  }
  notificationSettings() {
    return Promise.resolve();
  }
  carry() {
    return Promise.resolve();
  }
  carried() {
    return Promise.resolve(null);
  }
  clearCarried() {
    return Promise.resolve();
  }
  held(): Promise<HeldPress[]> {
    return Promise.resolve([]);
  }
  onHeld() {
    return () => undefined;
  }
  exactAlarms() {
    return Promise.resolve({ ...this.exact });
  }
  allowExactAlarms() {
    if (this.exact.canAsk) {
      this.exactOpened += 1;
      if (this.allowsExact) this.exact = { allowed: true, canAsk: false };
    }
    return this.exactAlarms();
  }
}
