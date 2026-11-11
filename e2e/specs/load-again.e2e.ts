import { $, browser, expect } from '@wdio/globals';
import { mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A page split off the first load (Calendar here) that could not be fetched. A browser may keep a
// failed import() per address for the page's life and never ask the server again (Firefox does),
// so the next visit asks by a new address. Only a real browser shows this: a mocked import()
// cannot. A small server in front of the app answers 503 for the page's part until told otherwise,
// and notes every address the browser asks for, so this sees what really reached a server.
const CALENDAR = /\/assets\/CalendarPage-[^/?]*\.js/;
const sidebar = (name: string) =>
  $(`//nav//*[@role='button' or self::button][.//span[normalize-space()='${name}']]`);

/** With E2E_PROOF set, keep what the browser showed at this step. */
async function proof(step: string): Promise<void> {
  if (!process.env.E2E_PROOF) return;
  const folder = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
  mkdirSync(folder, { recursive: true });
  const name = (await browser.capabilities).browserName ?? 'browser';
  await browser.saveScreenshot(join(folder, `load-again-${name}-${step}.png`));
}

describe('a page that could not be fetched', () => {
  let server: Server;
  let failing = true;
  const asked: string[] = [];
  let front = '';

  before(async () => {
    const app = browser.options.baseUrl!;
    server = createServer((request, response) => {
      const path = request.url ?? '/';
      asked.push(path);
      if (failing && CALENDAR.test(path)) {
        response.writeHead(503).end('Service unavailable');
        return;
      }
      // No service worker: its precache would fetch the part ahead, around this server's answer.
      if (path.startsWith('/sw.js')) {
        response.writeHead(404).end();
        return;
      }
      fetch(new URL(path, app), { headers: { 'accept-encoding': 'identity' } }).then(
        async (upstream) => {
          const headers = Object.fromEntries(
            [...upstream.headers].filter(
              ([key]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(key),
            ),
          );
          const body = Buffer.from(await upstream.arrayBuffer());
          response.writeHead(upstream.status, headers).end(body);
        },
        () => response.writeHead(502).end(),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    front = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('says so in the page area, and the next visit fetches it again', async () => {
    await browser.url(`${front}/today`);
    await expect($('h1')).toHaveText('Today');
    await sidebar('Calendar').click();
    await expect($('h1')).toHaveText('This page could not load');
    await expect($('button=Reload')).toBeDisplayed();
    await proof('1-could-not-load');
    expect(asked.some((path) => CALENDAR.test(path))).toBe(true);

    // The server answers again. Another page still opens, and Calendar opens on the next visit.
    failing = false;
    asked.length = 0;
    await sidebar('Today').click();
    await expect($('h1')).toHaveText('Today');
    await sidebar('Calendar').click();
    await expect($('h1')).toHaveText('Calendar');
    await proof('2-opened-again');

    // The page's part reached the server again: by its own address in a browser that did not keep
    // the failure, else by a new one.
    const again = asked.filter((path) => CALENDAR.test(path));
    expect(again.length).toBeGreaterThan(0);
    for (const path of again) expect(path).toMatch(/\.js(\?retry=\d+)?$/);
    console.log(`Calendar's part asked for again as: ${again.join(', ')}`);
    // Only the page's own part was asked for again: no script it shares with the rest of the app
    // was, so no second copy of a shared module.
    const others = asked.filter((path) => /\.js(\?|$)/.test(path) && !CALENDAR.test(path));
    expect(others).toEqual([]);
  });
});
