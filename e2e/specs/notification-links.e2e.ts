import { $, $$, browser, expect } from '@wdio/globals';

// A notification's button opens the app with what it asks in the address. A real browser and the
// production build, because the bug this pins came from the timing between the router and the store.
describe('a thumbs up from a notification', () => {
  it('leaves one comment and no crash, and the address forgets it', async () => {
    await browser.url('/inbox');
    const add = $('[data-add-task]');
    await add.click();
    await add.setValue('Water the ferns');
    await browser.keys('Enter');
    await $('//*[@aria-label="Open Water the ferns"]').click();
    await browser.waitUntil(async () => (await browser.getUrl()).includes('task='));
    const taskId = new URL(await browser.getUrl()).searchParams.get('task')!;
    // The next load reads what this one saved.
    await browser.pause(1000);

    await browser.url(`/inbox?task=${taskId}&like=1`);
    await browser.waitUntil(async () => !(await browser.getUrl()).includes('like=1'), {
      timeoutMsg: 'the address kept like=1',
    });
    const thumbs = "//section[contains(@aria-label, 'Comments')]//*[normalize-space(text())='👍']";
    await $(thumbs).waitForDisplayed();
    await browser.pause(1000);
    expect(await $$(thumbs).length).toBe(1);
    await expect($('h1')).toHaveText('Mess Drawer');
    await expect(browser).toHaveUrl(expect.stringContaining(`task=${taskId}`));
  });
});
