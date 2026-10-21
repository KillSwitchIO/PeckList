import { defineConfig, mergeConfig } from 'vitest/config';
import { webdriverio } from '@vitest/browser-webdriverio';
import viteConfig from './vite.config.ts';

// Component tests in real, system-installed browsers (any OS, any Linux distro).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.browser.test.{ts,tsx}'],
      browser: {
        enabled: true,
        headless: true,
        provider: webdriverio(),
        instances: [{ browser: 'chrome' }, { browser: 'firefox' }],
      },
    },
  }),
);
