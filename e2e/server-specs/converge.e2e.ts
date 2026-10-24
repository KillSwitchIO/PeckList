import { $, browser, expect } from '@wdio/globals';
import { remote } from 'webdriverio';

// Two devices of one account against a real server (PL-032): what one does reaches the other.
// The second device is a separate browser session (its own storage), like a second phone.

const password = process.env.E2E_ADMIN_PASSWORD!;
// A run id keeps reruns against the same server apart.
const run = Date.now().toString(36);

async function signIn(device: WebdriverIO.Browser): Promise<void> {
  await device.url('/');
  const username = await device.$('input[autocomplete="username"]');
  await username.waitForDisplayed({ timeout: 30_000 });
  await username.setValue('admin');
  await device.$('input[autocomplete="current-password"]').setValue(password);
  await device.$('button[type="submit"]').click();
  await device.$('[data-add-task]').waitForDisplayed({ timeout: 30_000 });
}

async function addTask(device: WebdriverIO.Browser, title: string): Promise<void> {
  const field = await device.$('[data-add-task]');
  await field.click();
  await field.setValue(title);
  await device.keys('Enter');
  await device.$(`//*[@aria-label="Open ${title}"]`).waitForDisplayed();
}

describe('two devices', () => {
  let second: WebdriverIO.Browser;

  before(async () => {
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
    second = await remote({
      capabilities,
      baseUrl: browser.options.baseUrl!,
      logLevel: 'warn',
    });
    await second.setWindowSize(1400, 900);
  });

  after(async () => {
    await second?.deleteSession();
  });

  it("see each other's tasks and completions without reloading", async () => {
    await signIn(browser);
    await signIn(second);
    await browser.url('/inbox');
    await second.url('/inbox');
    await browser.$('[data-add-task]').waitForDisplayed();
    await second.$('[data-add-task]').waitForDisplayed();

    // The server tells the other device at once (server-sent events), which then syncs.
    const first = `Converge from one ${run}`;
    await addTask(browser, first);
    await expect(second.$(`//*[@aria-label="Open ${first}"]`)).toBeDisplayed({ wait: 20_000 });

    const other = `Converge from two ${run}`;
    await addTask(second, other);
    await expect($(`//*[@aria-label="Open ${other}"]`)).toBeDisplayed({ wait: 20_000 });

    // Completing on one device closes it on the other.
    await second.$(`//*[@aria-label="Complete ${first}"]`).click();
    await expect($(`//*[@aria-label="Reopen ${first}"]`)).toBeExisting({ wait: 20_000 });
  });
});
