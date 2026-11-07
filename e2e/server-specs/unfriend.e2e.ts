import { browser, expect } from '@wdio/globals';
import { enterPassword, secondDevice, signIn } from './devices.ts';

// Unfriending against a real server (spec: Sharing & Permissions, Unfriending). What matters is what
// the other person's device ends up with, so that is a second browser session signed in as them.
// The dialog's wording and the rules for whose lists count are in the unit tests.

const adminPassword = process.env.E2E_ADMIN_PASSWORD!;
// A run id keeps reruns against the same server apart.
const run = Date.now().toString(36);
const friendName = `kim-${run}`;
const friendPassword = `kims own password ${run}`;
const wait = { wait: 30_000 };

/** The admin API, from the signed-in admin's own page. */
async function admin<T>(path: string, method: string, body?: unknown): Promise<T> {
  return browser.execute(
    async (path, method, text) => {
      const response = await fetch(`/api/admin${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...(text ? { body: text } : {}),
      });
      if (!response.ok) throw new Error(`${method} ${path}: ${response.status}`);
      return response.status === 204 ? null : ((await response.json()) as unknown);
    },
    path,
    method,
    body === undefined ? '' : JSON.stringify(body),
  ) as Promise<T>;
}

const inDialog = (rest: string) => `//div[@role='dialog']${rest}`;
const named = (text: string) =>
  `//*[@role='button' or self::button or self::a][.//*[normalize-space()='${text}'] or normalize-space()='${text}']`;
const openTask = (title: string) => `//*[@aria-label="Open ${title}"]`;
const assigned = "//*[@role='button' or self::button][contains(@aria-label, 'Assigned')]";

async function addTask(title: string): Promise<void> {
  const field = await browser.$('[data-add-task]');
  await field.click();
  await field.setValue(title);
  await browser.keys('Enter');
  await browser.$(openTask(title)).waitForDisplayed();
}

/** A new list of the admin's, with the friend on it and one of its two tasks assigned to them. */
async function shareNewList(name: string): Promise<void> {
  await browser.url('/today');
  await browser.$("button[aria-label='New list']").click();
  await browser.$("(//div[@role='dialog']//input)[1]").setValue(name);
  await browser.$(inDialog("//button[normalize-space()='Create']")).click();
  await browser.$(`//nav${named(name)}`).click();
  await expect(browser.$('h1')).toHaveText(name);

  await browser.$("button[aria-label='Share']").click();
  await browser.$("(//div[@role='dialog']//*[@role='combobox'])[1]").click();
  await browser.$(`//li[@role='option'][contains(., '${friendName}')]`).click();
  await browser.$(inDialog("//button[normalize-space()='Add']")).click();
  await browser.$(inDialog("//button[starts-with(@aria-label, 'Remove ')]")).waitForExist();
  await browser.$(inDialog("//button[normalize-space()='Done']")).click();
  await browser.$("//div[@role='dialog']").waitForExist({ reverse: true });

  await addTask(`${name} assigned`);
  await addTask(`${name} plain`);
  await browser.$(openTask(`${name} assigned`)).click();
  await browser.$(assigned).click();
  await browser.$(`//*[@role='menuitemcheckbox'][contains(., '${friendName}')]`).click();
  await browser.keys('Escape');
  // The creator stays on it too, as a new task starts with them.
  await expect(browser.$(assigned)).toHaveAttribute('aria-label', 'Assigned: Me and 1 more');
  await browser.keys('Escape');
}

/** One more task on the open list, assigned to the friend and then deleted. */
async function binAssignedTask(title: string): Promise<void> {
  await addTask(title);
  await browser.$(openTask(title)).click();
  await browser.$(assigned).click();
  await browser.$(`//*[@role='menuitemcheckbox'][contains(., '${friendName}')]`).click();
  await browser.keys('Escape');
  await browser.$("button[aria-label='Delete task']").click();
  await browser.$(openTask(title)).waitForExist({ reverse: true });
}

/** Press Unfriend on the friend, with the option to remove what you own on or off. */
async function unfriend(removeShares: boolean): Promise<void> {
  await browser.url('/friends');
  const row = `//section[@aria-label='Your friends']//li[contains(., '${friendName}')]`;
  await browser.$(`${row}//button[normalize-space()='Unfriend']`).click();
  const choice = browser.$(inDialog("//input[@type='checkbox']"));
  await expect(choice).toBeSelected();
  if (!removeShares) await choice.click();
  await browser.$(inDialog("//button[normalize-space()='Unfriend']")).click();
  await expect(browser.$(row)).not.toBeExisting(wait);
}

describe('unfriending', () => {
  let friend: WebdriverIO.Browser;
  let adminId = '';
  let friendId = '';

  before(async () => {
    await signIn(browser, 'admin', adminPassword);
    const made = await admin<{ id: string; password: string }>('/users', 'POST', {
      username: friendName,
    });
    friendId = made.id;
    const users = await admin<{ id: string; username: string }[]>('/users', 'GET');
    adminId = users.find((each) => each.username === 'admin')!.id;
    await admin('/friendships', 'POST', { userA: adminId, userB: friendId });

    // An account an admin makes starts by choosing its own password.
    friend = await secondDevice();
    await enterPassword(friend, friendName, made.password);
    const fresh = 'input[autocomplete="new-password"]';
    await friend.waitUntil(async () => (await friend.$$(fresh).length) === 2, { timeout: 30_000 });
    await friend.$('input[autocomplete="current-password"]').setValue(made.password);
    for (const field of await friend.$$(fresh)) await field.setValue(friendPassword);
    await friend.$('button[type="submit"]').click();
    await friend.$('[data-add-task]').waitForDisplayed({ timeout: 30_000 });
  });

  after(async () => {
    await friend?.deleteSession();
  });

  it('with the option off, the friend keeps the list and its tasks', async () => {
    const list = `Kept ${run}`;
    await shareNewList(list);
    await friend.url('/all');
    await expect(friend.$(openTask(`${list} plain`))).toBeDisplayed(wait);

    await unfriend(false);

    // Once their device has heard the friendship is over, the list must still be there.
    await friend.url('/friends');
    await friend.$(`//section[@aria-label='Your friends']`).waitForDisplayed({ timeout: 30_000 });
    await expect(
      friend.$(`//section[@aria-label='Your friends']//li[contains(., 'admin')]`),
    ).not.toBeExisting(wait);
    await friend.url('/all');
    await expect(friend.$(openTask(`${list} plain`))).toBeDisplayed(wait);
    await expect(friend.$(openTask(`${list} assigned`))).toBeDisplayed(wait);
  });

  it('with the option on, the list and its tasks leave their device, assigned or not', async () => {
    const kept = `Kept ${run}`;
    const list = `Removed ${run}`;
    await admin('/friendships', 'POST', { userA: adminId, userB: friendId });
    const binned = `${list} binned`;
    await shareNewList(list);
    await binAssignedTask(binned);
    await friend.url('/all');
    await expect(friend.$(openTask(`${list} assigned`))).toBeDisplayed(wait);

    await unfriend(true);

    // Watched from the page it was on: a reload could look empty only because it had not loaded.
    await browser.waitUntil(
      async () => !(await friend.$(openTask(`${list} assigned`)).isExisting()),
      { timeout: 60_000, interval: 1000, timeoutMsg: 'the assigned task stayed on their device' },
    );
    await expect(friend.$(openTask(`${list} plain`))).not.toBeExisting(wait);
    // The earlier list is one of the admin's too, so it goes with this one.
    await expect(friend.$(openTask(`${kept} plain`))).not.toBeExisting(wait);
    await expect(friend.$(`//nav${named(list)}`)).not.toBeExisting(wait);

    // What was in the Trash went too: restoring it shares nothing, and the server took the change.
    await browser.url('/trash');
    await browser.$(`//li[contains(., '${binned}')]//button[normalize-space()='Restore']`).click();
    await browser.url('/all');
    await browser.$(openTask(binned)).click();
    await expect(browser.$(assigned)).toHaveAttribute('aria-label', 'Assigned: Me');
    await friend.url('/all');
    await friend.$('h1').waitForDisplayed();
    await friend.pause(3000);
    await expect(friend.$(openTask(binned))).not.toBeExisting();

    // The owner keeps all of it, without them on it.
    await browser.url('/all');
    await expect(browser.$(openTask(`${list} assigned`))).toBeDisplayed(wait);
    await browser.$(openTask(`${list} assigned`)).click();
    await expect(browser.$(assigned)).toHaveAttribute('aria-label', 'Assigned: Me');
  });
});
