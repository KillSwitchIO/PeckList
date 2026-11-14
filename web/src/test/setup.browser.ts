// Setup for the tests in real browsers (vitest.browser.config.ts): the jsdom setup's matchers and
// clean-up, without its stand-ins (fake-indexeddb, empty layout boxes), which a browser has for real.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
