import { $, browser, expect } from '@wdio/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store, type Document } from './storage';

// PL-149: the workspace is already on the device, so the app opens straight to it. A spinner shows
// only once the page has been open a second and is still waiting (LoadingScreen), and leaves a
// mark in the page's performance timeline when it does: none here. A start that waits on the
// network, a language's catalog or anything else slow before the lists brings the spinner back.

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../schema/fixtures/migrations');
// The newest migration's output is a workspace in the app's own schema.
const current = Math.max(
  ...readdirSync(fixtures).map((name) => Number(/^(\d+)-expected\.json$/.exec(name)?.[1] ?? 0)),
);
const SPINNER_MARK = 'pecklist:spinner';
const TASKS = 500;

/** The newest fixture's workspace: its first task is copied for the many (store). */
const workspace = () =>
  JSON.parse(readFileSync(join(fixtures, `${current}-expected.json`), 'utf8')) as Document;

const task = (title: string) => $(`//*[@aria-label='Open ${title}']`);

describe('opening the app (PL-149)', () => {
  it(`shows ${TASKS} stored tasks without a spinner first`, async function () {
    // A busy runner can be slow now and then (two browsers start at once, Firefox the slower);
    // a start that waits on something slow is slow every time, and fails each try.
    this.retries(2);
    await browser.url('/all');
    await expect($("//h1[normalize-space()='All']")).toBeDisplayed();
    await store(workspace(), 'records', TASKS);

    await browser.url('/all');
    await expect(task('Task 1')).toBeDisplayed();
    const seen = await browser.execute((mark) => {
      const page = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        spinners: performance.getEntriesByName(mark).length,
        timing: `page loaded at ${Math.round(page.loadEventEnd)} ms`,
      };
    }, SPINNER_MARK);
    if (seen.spinners > 0) throw new Error(`the spinner showed (${seen.timing})`);
  });
});
