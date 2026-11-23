// The Android app's main flows on an emulator, against a real server (PL-070). One account per
// run, and the steps build on each other: connect and sign up, quick add, a date, complete and
// undo, a reminder's notification, a list shared with a friend who opens it, then a sign-in
// through a provider in the browser.
import { browser, expect } from '@wdio/globals';
import {
  account,
  allowBackground,
  button,
  buttonStarting,
  checkbox,
  detailsButton,
  enter,
  field,
  fill,
  goTo,
  heading,
  hideKeyboard,
  logOut,
  menuItem,
  notification,
  PASSWORD,
  quickAdd,
  SERVER_IN_APP,
  tap,
  toggle,
  withText,
} from './app';
import { friendFor } from './server';

// Unique per run, so a second run against the same server makes its own accounts.
const run = Date.now().toString(36);
const user = `kim${run}`;
const friend = `lee${run}`;
const list = `Garden ${run}`;

describe('the Android app', () => {
  it('connects to a server over plain http and makes an account', async () => {
    const address = field('Server address');
    await address.waitForDisplayed({ timeout: 60_000 });
    await address.setValue(SERVER_IN_APP);
    await tap(button('Connect'));
    // Plain http asks first (fine at home, not on public Wi-Fi).
    await tap(button('Connect anyway'));
    await expect(withText('Sign in to PeckList')).toBeDisplayed({ wait: 30_000 });

    await tap(button('Create an account'));
    await field('Username').setValue(user);
    await field('Password').setValue(PASSWORD);
    await tap(button('Create account'));
    await allowBackground();
    await expect(account(user)).toBeDisplayed({ wait: 30_000 });
    await expect(heading('Today')).toBeDisplayed();
  });

  it('quick adds a task, reading its date from the words', async () => {
    await quickAdd('Water plants tomorrow 9am');
    // The words it read show under the field before the task is made.
    await expect(withText('Tomorrow 9:00 AM')).toBeDisplayed();
    await enter();
    await hideKeyboard();
    await goTo('Mess Drawer');
    await expect(heading('Mess Drawer')).toBeDisplayed();
    await expect(button('Open Water plants')).toBeDisplayed();
    await expect(button('Start date: Tomorrow 9:00 AM')).toBeDisplayed();
  });

  it('sets a date from the date picker', async () => {
    await tap(button('Open Water plants'));
    await tap(await detailsButton('Start date'));
    // A quick pick sets the date and closes the picker.
    await tap(toggle('Next week'));
    const start = await detailsButton('Start date');
    await browser.waitUntil(async () => !(await start.getText()).includes('Tomorrow'), {
      timeoutMsg: 'the start date did not change',
    });
    await tap(await detailsButton('Close'));
  });

  it('completes a task, and Undo brings it back', async () => {
    await tap(checkbox('Complete Water plants'));
    // Done: it moves to the Closed section, and its box now reopens it.
    await expect(checkbox('Reopen Water plants')).toBeDisplayed();
    await expect(withText('Task completed')).toBeDisplayed();
    await tap(button('Undo'));
    await expect(checkbox('Complete Water plants')).toBeDisplayed({ wait: 10_000 });
  });

  it("completes a task from its reminder's notification", async () => {
    await quickAdd('Stretch in 2 minutes');
    await enter();
    // Open it from Today. On the Mess Drawer the new "Today" group goes in above the others, and
    // the WebView's accessibility tree can miss that (the page shows the task, UiAutomator never
    // sees it); a new page gives a fresh tree.
    await goTo('Today');
    await tap(button('Open Stretch'));
    await tap(await detailsButton('Reminders'));
    await tap(menuItem('On time'));
    const ok = button('OK');
    if (await ok.isExisting()) await ok.click();
    await expect(await detailsButton('Reminders: On time')).toBeDisplayed();
    await tap(await detailsButton('Close'));

    await notification('Stretch', 200_000);
    await tap(button('Complete'));
    await browser
      .$('//*[@resource-id="android:id/title" and @text="Stretch"]')
      .waitForExist({ reverse: true });
    await browser.back();
    // Done on the phone at once (and on the server, POST /api/reminders/act).
    await expect(checkbox('Reopen Stretch')).toBeExisting({ wait: 20_000 });
  });

  it('shares a list with a friend, who opens it on their own sign-in', async () => {
    // The friend and the friendship come from the admin API; the sharing is the phone's.
    await friendFor(user, friend, PASSWORD);
    await goTo('More');
    await tap(button('New list'));
    await field('Name').addValue(list);
    await enter();
    await expect(heading(list)).toBeDisplayed();
    await tap(button('View options'));
    await tap(menuItem('Share'));
    await tap(field('Add a friend'));
    await field('Add a friend').addValue(friend);
    await tap(browser.$(`//android.view.View[starts-with(@text, "${friend} ")]`));
    await tap(button('Add'));
    await expect(button(`Remove ${friend}`)).toBeDisplayed();
    await tap(button('Done'));
    await quickAdd('Buy seeds');
    await enter();
    await hideKeyboard();
    await expect(button('Open Buy seeds')).toBeDisplayed();

    // The friend, on this phone: the list is theirs to open, with the task on it.
    await logOut(user);
    await field('Username').setValue(friend);
    await field('Password').setValue(PASSWORD);
    await tap(button('Sign in'));
    await allowBackground();
    await expect(account(friend)).toBeDisplayed({ wait: 30_000 });
    await goTo('More');
    await tap(buttonStarting(list));
    await expect(heading(list)).toBeDisplayed();
    await expect(button('Open Buy seeds')).toBeDisplayed({ wait: 20_000 });
  });

  it('signs in through a provider in the browser and comes back signed in', async () => {
    // Log out, then the provider's button: a Custom Tab, the provider's sign-in (the mock takes
    // any name), the server's "Open PeckList on this device?", and the app again.
    await logOut(friend);
    await tap(withText('Continue with Test provider'));
    // The provider's form, unless the browser is still signed in at the server from a run before
    // (Chrome keeps its own cookies), when the server asks straight away.
    // The question is the page's title and its heading: two matches.
    const asking = () => browser.$$('//*[@text="Open PeckList on this device?"]').length;
    const fields = browser.$$('//android.widget.EditText');
    await browser.waitUntil(async () => (await asking()) > 0 || (await fields.length) >= 2, {
      timeout: 30_000,
      timeoutMsg: "the provider's sign-in did not open",
    });
    if ((await asking()) === 0) {
      const claims = JSON.stringify({
        email: 'amy@example.com',
        email_verified: true,
        preferred_username: 'amy',
        name: 'Amy',
      });
      await fill(fields[0]!, 'amy');
      await fill(fields[1]!, claims);
      // Filling taps each field, and the keyboard it brings up can cover the button.
      await hideKeyboard();
      await tap(button('Sign-in'));
    }
    await browser.waitUntil(async () => (await asking()) > 0, {
      timeout: 30_000,
      timeoutMsg: 'the server did not ask to open PeckList',
    });
    await tap(button('Continue'));
    await allowBackground();
    // The account menu shows the name the provider gave, not the user name.
    await expect(account('Amy')).toBeDisplayed({ wait: 30_000 });
  });
});
