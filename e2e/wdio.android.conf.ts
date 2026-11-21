// End-to-end tests of the Android app (foss debug APK) on an emulator, through Appium's
// UiAutomator2 driver. The stack (emulator with Appium, the server under test, a mock sign-in
// provider) is e2e/android/compose.yml; `pnpm e2e:android` brings it up, runs these, and takes it
// down. Run alone, point it at a stack that is already up:
//   E2E_APPIUM_HOST   Appium's host (default 127.0.0.1; port 4723)
//   E2E_SERVER_URL    the server as these specs reach it, for setup through the admin API
//                     (default http://127.0.0.1:6190)
//   E2E_APP           the APK's path inside the emulator container (default /tmp/pecklist.apk)
//   E2E_ADMIN_PASSWORD  the server's ADMIN_PASSWORD (default e2e-admin-password)
// The app reaches the same server at http://10.0.2.2:8080 (the emulator's name for its host).
import { browser } from '@wdio/globals';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: process.env.E2E_APPIUM_HOST ?? '127.0.0.1',
  port: 4723,
  path: '/',
  specs: ['./android-specs/**/*.e2e.ts'],
  // One emulator, and the specs build on each other's account and tasks: one at a time, in order.
  maxInstances: 1,
  specFileRetries: 0,
  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:app': process.env.E2E_APP ?? '/tmp/pecklist.apk',
      'appium:appPackage': 'com.pecklist.app',
      'appium:autoGrantPermissions': true,
      // Each run starts from a fresh app (its data cleared, still installed).
      'appium:noReset': false,
      'appium:newCommandTimeout': 300,
      'appium:uiautomator2ServerLaunchTimeout': 120_000,
      'appium:adbExecTimeout': 60_000,
    },
  ],
  logLevel: 'warn',
  waitforTimeout: 20_000,
  connectionRetryTimeout: 180_000,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 240_000 },
  // A failed test leaves what the phone showed: a screenshot and the screen's element tree.
  async afterTest(test, _context, { passed }) {
    if (passed) return;
    const name = `android-${test.title}`.replace(/[^a-z0-9]+/gi, '-');
    const folder = join(here, 'screenshots');
    mkdirSync(folder, { recursive: true });
    try {
      await browser.saveScreenshot(join(folder, `${name}.png`));
      writeFileSync(join(folder, `${name}.xml`), await browser.getPageSource());
    } catch (error) {
      console.warn(`No screenshot of "${test.title}": ${(error as Error).message}`);
    }
  },
};
