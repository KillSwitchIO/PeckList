// End-to-end tests against the production build, in system-installed browsers.
// Browsers: set E2E_BROWSERS=chrome,firefox,edge (default chrome,firefox).
// Base URL: set E2E_BASE_URL to test an already running instance (e.g. a server container);
// otherwise `vite preview` is started for the run.
import { browser } from '@wdio/globals';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:6174';
const browsers = (process.env.E2E_BROWSERS ?? 'chrome,firefox')
  .split(',')
  .map((name) => name.trim());

const headless: Record<string, Record<string, unknown>> = {
  chrome: { 'goog:chromeOptions': { args: ['--headless=new', '--window-size=1400,900'] } },
  edge: { 'ms:edgeOptions': { args: ['--headless=new', '--window-size=1400,900'] } },
  firefox: { 'moz:firefoxOptions': { args: ['-headless', '--width=1400', '--height=900'] } },
};
const browserName: Record<string, string> = {
  chrome: 'chrome',
  edge: 'MicrosoftEdge',
  firefox: 'firefox',
};

let preview: ChildProcess | undefined;

/** Stop the preview server and everything it started (pnpm -> vite). */
function stopPreview(): void {
  if (!preview?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    process.kill(-preview.pid, 'SIGTERM');
  }
  preview = undefined;
}

function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url)
        .then(() => resolve())
        .catch(() =>
          Date.now() > deadline
            ? reject(new Error(`no server at ${url}`))
            : setTimeout(attempt, 250),
        );
    };
    attempt();
  });
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
  maxInstances: 2,
  capabilities: browsers.map((name) => ({
    browserName: browserName[name] ?? name,
    ...headless[name],
  })),
  logLevel: 'warn',
  baseUrl,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
  // Window-size flags differ per browser; set the desktop viewport explicitly instead.
  async before() {
    await browser.setWindowSize(1400, 900);
  },
  async onPrepare() {
    if (process.env.E2E_BASE_URL) return;
    preview = spawn('pnpm', ['--dir', join(here, '..', 'web'), 'preview'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
    });
    await waitForServer(baseUrl, 30_000);
  },
  onComplete() {
    stopPreview();
  },
};
