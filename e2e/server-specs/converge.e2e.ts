import { $, browser, expect } from '@wdio/globals';
import { secondDevice, signIn as signInAs } from './devices.ts';

// Two devices of one account against a real server (PL-032): what one does reaches the other.
// The second device is a separate browser session (its own storage), like a second phone.

const password = process.env.E2E_ADMIN_PASSWORD!;
// A run id keeps reruns against the same server apart.
const run = Date.now().toString(36);
const signIn = (device: WebdriverIO.Browser) => signInAs(device, 'admin', password);

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
    second = await secondDevice();
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
