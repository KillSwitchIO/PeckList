import { defineConfig, mergeConfig } from 'vitest/config';
import { webdriverio } from '@vitest/browser-webdriverio';
import viteConfig from './vite.config.ts';

// A few tests in real browsers (PL-002), where jsdom stands in for something: real IndexedDB in
// place of fake-indexeddb, and real layout. Run weekly in CI (web-browser-tests), headless, in the
// browsers image; locally the same: pnpm --dir web test:browser.
//
// CI points CHROME_BIN, CHROMEDRIVER_BIN and FIREFOX_BIN at the image's own browsers and drivers;
// unset, WebdriverIO finds or fetches them.
const { CHROME_BIN, CHROMEDRIVER_BIN, FIREFOX_BIN, CI } = process.env;

// The jsdom settings are left out, not merged: mergeConfig joins arrays, which would add every
// jsdom test and its setup file to these.
const app = { ...viteConfig, test: undefined };

export default mergeConfig(
  app,
  defineConfig({
    // Scan the tests' imports before the browsers start: a dependency found mid-run makes Vite
    // bundle it and reload, and a test file loading at that moment fails to import.
    // The schema validator's helper is imported by a virtual module, which the scan does not read.
    optimizeDeps: {
      entries: ['src/**/*.browser.test.{ts,tsx}'],
      include: ['ajv/dist/runtime/ucs2length.js'],
    },
    test: {
      include: ['src/**/*.browser.test.{ts,tsx}'],
      setupFiles: ['./src/test/setup.browser.ts'],
      testTimeout: 30_000,
      browser: {
        enabled: true,
        headless: true,
        // A phone's screen, for the layout tests (phoneWidth.browser.test.tsx); IndexedDB does not
        // mind. Set here, not with vitest/browser's page.viewport, whose matcher types clash with
        // jest-dom's in the jsdom tests' type check.
        viewport: { width: 375, height: 812 },
        instances: [
          {
            browser: 'chrome',
            provider: webdriverio({
              capabilities: {
                'goog:chromeOptions': {
                  // Root in a container has no sandbox to drop into.
                  args: CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [],
                  ...(CHROME_BIN ? { binary: CHROME_BIN } : {}),
                },
                ...(CHROMEDRIVER_BIN
                  ? { 'wdio:chromedriverOptions': { binary: CHROMEDRIVER_BIN } }
                  : {}),
              },
            }),
          },
          {
            browser: 'firefox',
            provider: webdriverio({
              capabilities: {
                'moz:firefoxOptions': FIREFOX_BIN ? { binary: FIREFOX_BIN } : {},
              },
            }),
          },
        ],
      },
    },
  }),
);
