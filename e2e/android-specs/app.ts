// Helpers for the Android specs. The app's pages run in a WebView, which Android exposes to
// UiAutomator as native widgets (a button's label is its text, a field's label its hint), so the
// specs find everything by what a person sees, with no WebView context or chromedriver.
import { browser } from '@wdio/globals';

/** The server under test as the app reaches it (the emulator's name for its host). */
export const SERVER_IN_APP = 'http://10.0.2.2:8080';
export const PASSWORD = 'e2e-password-123';

/** An XPath string literal for any text. */
function literal(text: string): string {
  if (!text.includes('"')) return `"${text}"`;
  if (!text.includes("'")) return `'${text}'`;
  return `concat("${text.split('"').join(`", '"', "`)}")`;
}

export const button = (text: string) =>
  browser.$(`//android.widget.Button[@text=${literal(text)}]`);
export const buttonStarting = (text: string) =>
  browser.$(`//android.widget.Button[starts-with(@text, ${literal(text)})]`);
export const checkbox = (text: string) =>
  browser.$(`//android.widget.CheckBox[@text=${literal(text)}]`);
export const toggle = (text: string) =>
  browser.$(`//android.widget.ToggleButton[@text=${literal(text)}]`);
export const menuItem = (text: string) =>
  browser.$(`//android.view.MenuItem[@text=${literal(text)}]`);
export const withText = (text: string) => browser.$(`//*[@text=${literal(text)}]`);
/** A page's heading (the bottom bar has a button of the same name). */
export const heading = (text: string) =>
  browser.$(`//android.widget.TextView[@text=${literal(text)}]`);
/** The account button (its label grows a "1 new notification" when there is one). */
export const account = (user: string) => buttonStarting(`Account: ${user}`);

/**
 * A button inside the open task's details, waiting for them to be open first. The list behind
 * has buttons of the same names (a row's start date).
 */
export async function detailsButton(text: string): Promise<ChainablePromiseElement> {
  await withText('Task details').waitForExist();
  return browser.$(
    `//*[@text="Task details"]//android.widget.Button[starts-with(@text, ${literal(text)})]`,
  );
}
/** A text field by the start of its label (the add field's label names the list it adds to). */
export const field = (label: string) =>
  browser.$(`//android.widget.EditText[starts-with(@hint, ${literal(label)})]`);

/**
 * Wait for an element to show and stop moving, then tap it. The page's own CSS transitions (a menu
 * growing open) still run with Android's animations off, and a tap taken mid-way lands on whatever
 * is under the element's old place.
 */
export async function tap(target: ChainablePromiseElement | WebdriverIO.Element): Promise<void> {
  const element: WebdriverIO.Element = await target;
  await element.waitForDisplayed();
  let last = '';
  await browser.waitUntil(
    async () => {
      const now = JSON.stringify([await element.getLocation(), await element.getSize()]);
      const still = now === last;
      last = now;
      return still;
    },
    { interval: 150, timeoutMsg: 'it kept moving' },
  );
  await element.click();
}

type ChainablePromiseElement = ReturnType<typeof browser.$>;

/** Wait until an element is gone. */
export async function gone(element: ChainablePromiseElement, timeout = 20_000): Promise<void> {
  await element.waitForExist({ reverse: true, timeout });
}

/** The keyboard away, so it covers nothing a spec taps next. */
export async function hideKeyboard(): Promise<void> {
  if (await browser.isKeyboardShown()) await browser.hideKeyboard();
}

/**
 * After a sign-in the app asks once to run without battery optimization (the check-ins, PL-070);
 * a person allows it.
 */
export async function allowBackground(): Promise<void> {
  const allow = button('Allow');
  if (await allow.waitForExist({ timeout: 8_000 }).catch(() => false)) await allow.click();
}

/** Quick add: type into the page's add field and press Return. */
export async function quickAdd(text: string): Promise<void> {
  const add = field('Add task');
  await tap(add);
  await add.addValue(text);
}

/** Press Return (the keyboard's Enter). */
export async function enter(): Promise<void> {
  await browser.pressKeyCode(66);
}

/** Log out from the account menu (and its question, when it asks), back to the sign-in page. */
export async function logOut(name: string): Promise<void> {
  await tap(account(name));
  await tap(menuItem('Log out'));
  const confirm = button('Log out');
  if (await confirm.waitForExist({ timeout: 3_000 }).catch(() => false)) await tap(confirm);
  await withText('Sign in to PeckList').waitForDisplayed({ timeout: 30_000 });
}

/** Go to a page from the bottom bar. */
export async function goTo(page: 'Today' | 'Mess Drawer' | 'Calendar' | 'Search' | 'More') {
  await hideKeyboard();
  await tap(button(page));
}

/** The notification shade, until a notification with this title is in it (or the time is up). */
export async function notification(
  title: string,
  timeout: number,
): Promise<ChainablePromiseElement> {
  const deadline = Date.now() + timeout;
  const shown = browser.$(`//*[@resource-id="android:id/title" and @text=${literal(title)}]`);
  for (;;) {
    await browser.openNotifications();
    await browser.pause(1_500);
    if (await shown.isExisting()) return shown;
    if (Date.now() > deadline) throw new Error(`no notification "${title}" within ${timeout} ms`);
    await browser.back();
    await browser.pause(10_000);
  }
}
