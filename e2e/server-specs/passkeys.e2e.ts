// Passkeys end to end (PL-123), with Chrome's virtual authenticator: no real key, no system prompt.
// CI only, headless: a run on a desktop must never bring up a passkey prompt, so outside CI (and
// in a browser without the WebDriver authenticator commands) the spec skips.
import { browser, expect } from '@wdio/globals';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, connect, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';
import { enterPassword } from './devices.ts';

/** Where a failed run leaves what it saw (the e2e jobs keep e2e/screenshots as artifacts). */
const evidence = fileURLToPath(new URL('../screenshots/', import.meta.url));

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
  const consoleLines: string[] = [];

  before(async function () {
    const chrome = (browser.capabilities as WebdriverIO.Capabilities).browserName === 'chrome';
    if (!process.env.CI || !chrome) this.skip();
    // The browser's console, kept for a failed run (WebDriver BiDi).
    try {
      await browser.sessionSubscribe({ events: ['log.entryAdded'] });
      browser.on(
        'log.entryAdded',
        (entry: { level?: string; type?: string; text?: string | null }) =>
          consoleLines.push(`${entry.level} ${entry.type}: ${entry.text}`),
      );
    } catch (error) {
      consoleLines.push(`no console capture: ${(error as Error).message}`);
    }
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

  // A failed run leaves what the page knew about passkeys beside the screenshot: the address, what
  // GET /api/account/passkeys answered (available), passkeysWork()'s inputs, the buttons on the page
  // and the browser's console.
  afterEach(async function () {
    if (this.currentTest?.state !== 'failed') return;
    const page = await browser
      .execute(async () => {
        const host = location.hostname;
        const onIpAddress = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[');
        let passkeysApi: unknown;
        try {
          const response = await fetch('/api/account/passkeys', { credentials: 'same-origin' });
          passkeysApi = { status: response.status, body: await response.text() };
        } catch (error) {
          passkeysApi = String(error);
        }
        return {
          url: location.href,
          secureContext: isSecureContext,
          passkeysWork:
            !onIpAddress &&
            typeof window.PublicKeyCredential === 'function' &&
            !!navigator.credentials,
          passkeysApi,
          buttons: [...document.querySelectorAll('button')]
            .map((b) => b.textContent?.trim() || b.getAttribute('aria-label') || '')
            .filter(Boolean),
        };
      })
      .catch((error: unknown) => String(error));
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      `${evidence}passkeys-diagnostics.txt`,
      `${JSON.stringify(page, null, 2)}\n\n--- browser console\n${consoleLines.join('\n')}\n`,
    );
  });

  it('adds a passkey in settings, then signs in with it and no password', async () => {
    // Signed in on the forward's origin: a session made on the server's own address is not this one.
    await enterPassword(browser, 'admin', password, `${origin}/`);
    await $('[data-add-task]').waitForDisplayed({ timeout: 30_000 });

    await browser.url(`${origin}/settings`);
    // The passkeys section shows only once GET /api/account/passkeys has answered: wait for it.
    const add = button('Add a passkey');
    await add.waitForDisplayed({
      timeout: 30_000,
      timeoutMsg: 'no "Add a passkey" in settings after 30 s',
    });
    await add.scrollIntoView({ block: 'center' });
    await add.waitForClickable({
      timeout: 15_000,
      timeoutMsg: '"Add a passkey" never became clickable',
    });
    await add.click();
    const naming = $('//h2[normalize-space()="Name this passkey"]');
    await naming.waitForDisplayed({ timeout: 15_000 });
    const name = $('//label[normalize-space()="Name"]/following::input[1]');
    // The field comes filled in ("Passkey"). clearValue empties the box but not React's state, so
    // the typing landed after it ("PasskeyCI virtual key", run of !404): select it and type over.
    await name.click();
    await browser.keys(['Control', 'a']);
    await browser.keys('Backspace');
    await name.addValue('CI virtual key');
    await expect(name).toHaveValue('CI virtual key');
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
    // The menu says Log out (profile.logOut); run 3 of 15c looked for "Sign out" and never found it.
    // It grows open, and a click while it grows lands higher up when it ends: on Change password,
    // the item above (rc.3, a busy runner). Click once it has stopped moving.
    const logOut = $("//li[@role='menuitem'][normalize-space()='Log out']");
    await logOut.waitForDisplayed({ timeout: 15_000 });
    await logOut.waitForStable({ timeout: 15_000 });
    await logOut.click();
    // Asked first only when something has not synced yet.
    const anyway = button('Log out anyway');
    const asked = await anyway.waitForExist({ timeout: 3_000 }).then(
      () => true,
      () => false,
    );
    if (asked) await anyway.click();
    // The sign-in page offers the passkey in the username field's autofill (conditional UI), and
    // this authenticator always agrees, so Chrome may sign in with it before the button is pressed
    // (run of !406: signed in again on /today, the key used, no button in sight). Either way is a
    // sign-in by the passkey alone: its count goes up, as only a passkey sign-in moves it.
    const signCount = async () => (await browser.getCredentials(authenticator))[0]?.signCount ?? 0;
    const passkeyButton = button('Sign in with a passkey');
    await browser.waitUntil(
      async () => (await signCount()) > signedBefore || (await passkeyButton.isDisplayed()),
      { timeout: 30_000, timeoutMsg: 'neither a passkey sign-in nor its button after Log out' },
    );
    if ((await signCount()) === signedBefore) await passkeyButton.click();
    await browser.waitUntil(async () => (await signCount()) > signedBefore, {
      timeout: 30_000,
      timeoutMsg: 'the passkey was never used to sign in',
    });
    await $('[data-add-task]').waitForDisplayed({ timeout: 30_000 });

    // Leave the shared server as it was: the passkey goes again.
    await browser.url(`${origin}/settings`);
    await $('button[aria-label="Remove CI virtual key"]').click();
    await $('button[aria-label="Remove CI virtual key"]').waitForExist({
      reverse: true,
      timeout: 15_000,
    });
  });
});
