import { $, $$, browser, expect } from '@wdio/globals';

// A notification's thumbs up opens the app on its task and leaves the comment. A real browser and
// the production build, because the bug this pins came from the timing between the router and
// the store.
//
// The press reaches the page as the service worker hands it over (public/sw-notifications.js): an
// entry in this origin's Cache Storage under a one-time name, and the task's address with
// ?act=<name>. A test cannot click a system notification, so it writes that entry as the worker
// does; the worker's side has its own test (sw-notifications.test.ts). A link from anywhere else
// can only carry the address, so like=1 alone must do nothing (security review 2026-11-19).

const thumbs = "//section[contains(@aria-label, 'Comments')]//*[normalize-space(text())='👍']";

/** A new task in the inbox, opened; its id. */
async function openNewTask(title: string): Promise<string> {
  await browser.url('/inbox');
  const add = $('[data-add-task]');
  await add.click();
  await add.setValue(title);
  await browser.keys('Enter');
  await $(`//*[@aria-label="Open ${title}"]`).click();
  await browser.waitUntil(async () => (await browser.getUrl()).includes('task='));
  const taskId = new URL(await browser.getUrl()).searchParams.get('task')!;
  // The next load reads what this one saved.
  await browser.pause(1000);
  return taskId;
}

/** A thumbs-up press on the task, kept as the service worker keeps it; its one-time name. */
async function pressThumbsUp(taskId: string): Promise<string> {
  return browser.execute(async (task: string) => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const name = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const cache = await caches.open('pecklist-actions');
    await cache.put(
      `/act/${name}`,
      new Response(JSON.stringify({ kind: 'like', taskId: task, at: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    return name;
  }, taskId);
}

describe('a thumbs up from a notification', () => {
  it('leaves one comment and no crash, and the address forgets it', async () => {
    const taskId = await openNewTask('Water the ferns');
    const name = await pressThumbsUp(taskId);

    await browser.url(`/inbox?task=${taskId}&act=${name}`);
    await browser.waitUntil(async () => !(await browser.getUrl()).includes('act='), {
      timeoutMsg: 'the address kept act=',
    });
    await $(thumbs).waitForDisplayed();
    await browser.pause(1000);
    expect(await $$(thumbs).length).toBe(1);
    await expect($('h1')).toHaveText('Mess Drawer');
    await expect(browser).toHaveUrl(expect.stringContaining(`task=${taskId}`));

    // The name works once: the same address again (a reload, a second tab) adds nothing.
    await browser.url(`/inbox?task=${taskId}&act=${name}`);
    await browser.waitUntil(async () => !(await browser.getUrl()).includes('act='), {
      timeoutMsg: 'the address kept act= the second time',
    });
    await $(thumbs).waitForDisplayed();
    await browser.pause(1500);
    expect(await $$(thumbs).length).toBe(1);
  });

  it('a typed like=1 opens the task and does nothing else', async () => {
    const taskId = await openNewTask('Feed the cat');

    await browser.url(`/inbox?task=${taskId}&like=1`);
    await browser.waitUntil(async () => !(await browser.getUrl()).includes('like=1'), {
      timeoutMsg: 'the address kept like=1',
    });
    await expect(browser).toHaveUrl(expect.stringContaining(`task=${taskId}`));
    await $("//section[contains(@aria-label, 'Comments')]").waitForDisplayed();
    await browser.pause(1500);
    expect(await $$(thumbs).length).toBe(0);
    await expect($('h1')).toHaveText('Mess Drawer');
  });
});
