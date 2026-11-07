import { browser } from '@wdio/globals';
import { remote } from 'webdriverio';

/** Another device: a separate browser session with its own storage, like a second phone. */
export async function secondDevice(): Promise<WebdriverIO.Browser> {
  // The same browser and flags, but nothing that ties it to the first session (its profile).
  const asked = browser.requestedCapabilities as WebdriverIO.Capabilities;
  const capabilities: WebdriverIO.Capabilities = { browserName: asked.browserName! };
  for (const key of ['goog:chromeOptions', 'moz:firefoxOptions', 'ms:edgeOptions'] as const) {
    const options = asked[key] as { args?: string[]; binary?: string } | undefined;
    if (options) {
      (capabilities as Record<string, unknown>)[key] = {
        args: (options.args ?? []).filter((arg) => !arg.startsWith('--user-data-dir')),
        ...(options.binary ? { binary: options.binary } : {}),
      };
    }
  }
  const device = await remote({
    capabilities,
    baseUrl: browser.options.baseUrl!,
    logLevel: 'warn',
  });
  await device.setWindowSize(1400, 900);
  return device;
}

/** Fill in the sign-in page. "username webauthn" on it since PL-123, so match the word. */
export async function enterPassword(
  device: WebdriverIO.Browser,
  username: string,
  password: string,
): Promise<void> {
  await device.url('/');
  const field = await device.$('input[autocomplete~="username"]');
  await field.waitForDisplayed({ timeout: 30_000 });
  await field.setValue(username);
  await device.$('input[autocomplete="current-password"]').setValue(password);
  await device.$('button[type="submit"]').click();
}

/** Sign in and wait for the app. */
export async function signIn(
  device: WebdriverIO.Browser,
  username: string,
  password: string,
): Promise<void> {
  await enterPassword(device, username, password);
  await device.$('[data-add-task]').waitForDisplayed({ timeout: 30_000 });
}
