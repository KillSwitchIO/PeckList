// Passkeys end to end (PL-123), with Chrome's virtual authenticator: no real key, no system prompt.
// CI only, headless: a run on a desktop must never bring up a passkey prompt, so outside CI (and
// in a browser without the WebDriver authenticator commands) the spec skips.
import { browser, expect } from '@wdio/globals';
import { createServer, connect, type Server } from 'node:net';
import { enterPassword } from './devices.ts';

const password = process.env.E2E_ADMIN_PASSWORD!;
const server = new URL(process.env.E2E_BASE_URL!);

/**
 * Passkeys need a secure origin, and plain http only counts on localhost. CI reaches the server as
 * http://pecklist:8080, so the spec talks to it through a forward on localhost: the server then sees
 * localhost as its address and makes that the passkeys' relying party.
 */
function forwardFromLocalhost(): Promise<{ origin: string; close: () => void }> {
  if (server.hostname === 'localhost' || server.hostname === '127.0.0.1') {
    return Promise.resolve({
      origin: server.origin.replace('127.0.0.1', 'localhost'),
      close: () => {},
    });
  }
  const forward: Server = createServer((incoming) => {
    const outgoing = connect(Number(server.port || 80), server.hostname);
    incoming.pipe(outgoing).pipe(incoming);
    const end = () => {
      incoming.destroy();
      outgoing.destroy();
    };
    incoming.on('error', end);
    outgoing.on('error', end);
  });
  return new Promise((resolve) => {
    forward.listen(0, '127.0.0.1', () => {
      const { port } = forward.address() as { port: number };
      resolve({ origin: `http://localhost:${port}`, close: () => forward.close() });
    });
  });
}

const button = (text: string) => $(`//button[normalize-space()='${text}']`);

describe('passkeys (PL-123)', function () {
  let close = () => {};
  let authenticator = '';
  let origin = '';

  before(async function () {
    const chrome = (browser.capabilities as WebdriverIO.Capabilities).browserName === 'chrome';
    if (!process.env.CI || !chrome) this.skip();
    ({ origin, close } = await forwardFromLocalhost());
    authenticator = await browser.addVirtualAuthenticator(
      'ctap2',
      'internal',
      true, // a discoverable credential, so sign-in needs no username
      true, // it verifies the user
      true, // the "user" always agrees
      true, // and is always verified
    );
  });

  after(async () => {
    if (authenticator) await browser.removeVirtualAuthenticator(authenticator);
    close();
  });

  it('adds a passkey in settings, then signs in with it and no password', async () => {
    await browser.url(`${origin}/`);
    await enterPassword(browser, 'admin', password);
    await $('[data-add-task]').waitForDisplayed({ timeout: 30_000 });

    await browser.url(`${origin}/settings`);
    await (await button('Add a passkey')).click();
    const naming = $('//h2[normalize-space()="Name this passkey"]');
    await naming.waitForDisplayed({ timeout: 15_000 });
    const name = $('//label[normalize-space()="Name"]/following::input[1]');
    await name.clearValue();
    await name.setValue('CI virtual key');
    await (await button('Save')).click();
    await $('button[aria-label="Remove CI virtual key"]').waitForDisplayed({ timeout: 15_000 });

    const [credential] = await browser.getCredentials(authenticator);
    expect(credential?.isResidentCredential).toBe(true);
    expect(credential?.rpId).toBe('localhost');
    const signedBefore = credential!.signCount;

    // Signed out from the profile menu, and in again by the passkey alone.
    await browser.url(`${origin}/today`);
    // "Account: admin" or "Your account", with any unread count after it.
    await $('button[aria-haspopup="menu"][aria-label*="ccount"]').click();
    await $("//li[@role='menuitem'][normalize-space()='Sign out']").click();
    const passkeyButton = button('Sign in with a passkey');
    await passkeyButton.waitForDisplayed({ timeout: 30_000 });
    await passkeyButton.click();
    await $('[data-add-task]').waitForDisplayed({ timeout: 30_000 });
    const [used] = await browser.getCredentials(authenticator);
    expect(used!.signCount).toBeGreaterThan(signedBefore);

    // Leave the shared server as it was: the passkey goes again.
    await browser.url(`${origin}/settings`);
    await $('button[aria-label="Remove CI virtual key"]').click();
    await $('button[aria-label="Remove CI virtual key"]').waitForExist({
      reverse: true,
      timeout: 15_000,
    });
  });
});
