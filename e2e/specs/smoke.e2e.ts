import { $, browser, expect } from '@wdio/globals';

// XPath and CSS selectors only: text-matching selectors are not supported the same way by every
// browser's WebDriver BiDi implementation (Firefox rejects innerText locators).
describe('smoke', () => {
  it('loads the app shell on Today', async () => {
    await browser.url('/');
    await expect(browser).toHaveUrl(expect.stringContaining('/today'));
    await expect($('h1')).toHaveText('Today');
    await expect($("//p[contains(., 'All punched out')]")).toBeDisplayed();
  });

  it('navigates from the sidebar', async () => {
    await browser.url('/today');
    await $("//nav//*[@role='button' or self::button][.//span[normalize-space()='Inbox']]").click();
    await expect($('h1')).toHaveText('Inbox');
  });
});
