import { $, $$, browser, expect } from '@wdio/globals';

// The calendar's Year view in a real browser (PL-093). The unit tests cover what it says and does;
// these are what only a layout engine and real key presses can show: twelve months that fill the
// pane without scrolling, shades that really are drawn, and the keyboard walk. XPath and CSS
// only, as in smoke.e2e.ts.

const modes = "[role='group'][aria-label='Calendar view']";
const dayFor = (date: string) => `[data-year-day='${date}']`;

/** Add a task for today on the Today page, so one day of the year is busy. */
async function addTaskForToday(title: string) {
  await browser.url('/today');
  const input = $("//textarea[starts-with(@placeholder, 'Add task')][not(@aria-hidden)]");
  await input.click();
  await input.setValue(title);
  await browser.keys('Enter');
  await expect($(`//*[@aria-label='Open ${title}']`)).toBeExisting();
}

async function openYear() {
  await browser.url('/calendar');
  await $(`${modes} button[aria-label='Year']`).click();
  await expect($('.year-months')).toBeDisplayed();
}

/** Today's date as the page draws it, `YYYY-MM-DD`. */
async function today(): Promise<string> {
  return (await $('[data-year-day][data-today]').getAttribute('data-year-day'))!;
}

describe('the calendar year view', () => {
  it('fits twelve months in four columns and three rows, without scrolling', async () => {
    await openYear();
    await expect($$('[data-year-month]')).toBeElementsArrayOfSize(12);
    const layout = await browser.execute(() => {
      const months = [...document.querySelectorAll<HTMLElement>('[data-year-month]')];
      const boxes = months.map((month) => month.getBoundingClientRect());
      const distinct = (values: number[]) => new Set(values.map(Math.round)).size;
      let pane: HTMLElement | null = document.querySelector<HTMLElement>('.year-months');
      while (pane && pane.scrollHeight <= pane.clientHeight + 1) pane = pane.parentElement;
      return {
        columns: distinct(boxes.map((box) => box.left)),
        rows: distinct(boxes.map((box) => box.top)),
        lowest: Math.max(...boxes.map((box) => box.bottom)),
        viewport: window.innerHeight,
        // The first ancestor that scrolls, if any, apart from the page's own side menu.
        scrolls: pane && !pane.closest('nav') ? pane.tagName : null,
      };
    });
    await expect(layout.columns).toBe(4);
    await expect(layout.rows).toBe(3);
    await expect(layout.lowest).toBeLessThanOrEqual(layout.viewport);
    await expect(layout.scrolls).toBeNull();
  });

  it('shades a busy day, leaves a free one bare, and names each day for a pointer', async () => {
    await addTaskForToday('Year probe');
    await openYear();
    const date = await today();
    const busy = $(dayFor(date));
    await expect(busy).toHaveAttribute('data-heat', expect.stringMatching(/^[123]$/));
    await expect(busy).toHaveAttribute(
      'title',
      expect.stringMatching(/^Today, .+, \d+ open tasks?$/),
    );
    // The shade is painted, and the number on it is not the same color as it.
    const colors = await browser.execute((selector) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return { background: style.backgroundColor, text: style.color };
    }, dayFor(date));
    await expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
    await expect(colors.background).not.toBe(colors.text);

    const free = $$('[data-year-day][data-heat="0"]')[0]!;
    await expect(free).toHaveAttribute('title', expect.stringMatching(/no open tasks$/));
    const bare = await browser.execute((el) => getComputedStyle(el).backgroundColor, await free);
    await expect(bare).toBe('rgba(0, 0, 0, 0)');
    // The legend runs from free to busy.
    await expect($("//*[normalize-space()='Free']")).toBeDisplayed();
    await expect($("//*[normalize-space()='Busy']")).toBeDisplayed();
  });

  it('opens a day in Days and a month by its name', async () => {
    await openYear();
    const year = (await today()).slice(0, 4);
    await $(dayFor(`${year}-03-10`)).click();
    await expect($(`[data-cal-slots='${year}-03-10']`)).toBeDisplayed();

    await openYear();
    await $("button[aria-label='Open March']").click();
    await expect($(`[data-cal-day='${year}-03-01']`)).toBeDisplayed();
  });

  it('pages by a year, comes back to this one, and takes the paged year to Month', async () => {
    await openYear();
    const now = await today();
    const year = Number(now.slice(0, 4));
    await expect($('h2')).toHaveText(expect.stringContaining(String(year)));
    await $("button[aria-label='Next']").click();
    await expect($('h2')).toHaveText(expect.stringContaining(String(year + 1)));
    await expect($(dayFor(`${year + 1}-01-01`))).toBeDisplayed();
    await $("button[aria-label='Go to today']").click();
    await expect($('h2')).toHaveText(expect.stringContaining(String(year)));
    await $("button[aria-label='Previous']").click();
    await $(`${modes} button[aria-label='Month']`).click();
    await expect($(`[data-cal-day='${year - 1}-${now.slice(5)}']`)).toBeDisplayed();
  });

  it('walks the days with the arrow keys and opens one with Enter', async () => {
    await openYear();
    const year = (await today()).slice(0, 4);
    await expect($$('[data-year-day][tabindex="0"]')).toBeElementsArrayOfSize(1);
    await browser.execute(
      (selector) => document.querySelector<HTMLElement>(selector)!.focus(),
      dayFor(`${year}-06-15`),
    );
    await browser.keys(['ArrowRight', 'ArrowDown']);
    const focused = await browser.execute(
      () => document.activeElement?.getAttribute('data-year-day') ?? null,
    );
    // 15 June, a day on, a week down: 23 June (the arrows follow the dates, not the grid).
    await expect(focused).toBe(`${year}-06-23`);
    await expect($$('[data-year-day][tabindex="0"]')).toBeElementsArrayOfSize(1);
    await browser.keys('Enter');
    await expect($(`[data-cal-slots='${year}-06-23']`)).toBeDisplayed();
  });

  it('sets Unscheduled aside in Year and brings it back in Month', async () => {
    await browser.url('/calendar');
    await $("button[aria-label='Unscheduled']").click();
    await expect($("[role='list'][aria-label='Unscheduled']")).toBeDisplayed();
    await $(`${modes} button[aria-label='Year']`).click();
    await expect($("[role='list'][aria-label='Unscheduled']")).not.toBeExisting();
    await expect($("button[aria-label='Unscheduled']")).not.toBeExisting();
    await $(`${modes} button[aria-label='Month']`).click();
    await expect($("[role='list'][aria-label='Unscheduled']")).toBeDisplayed();
  });

  it('stays in Year after a reload', async () => {
    await openYear();
    await browser.refresh();
    await expect($('.year-months')).toBeDisplayed();
  });
});
