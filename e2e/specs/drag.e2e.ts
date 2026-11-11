import { $, $$, browser, expect } from '@wdio/globals';

// Real pointer drags in real browsers (PL-014 and PL-021 acceptance). XPath and CSS only, as in
// smoke.e2e.ts.

/** Add tasks through the page's add field. */
async function addTasks(titles: string[]) {
  const input = $("//textarea[starts-with(@placeholder, 'Add task')][not(@aria-hidden)]");
  for (const title of titles) {
    await input.click();
    await input.setValue(title);
    await browser.keys('Enter');
    await expect($(`//*[@aria-label='Open ${title}']`)).toBeExisting();
  }
}

/**
 * Wait until an element stands still: nothing moving on it, inside it, or around it. A menu grows
 * in from its button, so a click aimed at an item while it grows lands higher up once it has
 * grown, on the item above or a heading; on a busy machine that window is long enough to hit.
 * Animations elsewhere (the undo toast's countdown) and spinners that never stop don't count.
 */
async function settled(element: WebdriverIO.Element) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (at) =>
          document.getAnimations().every((each) => {
            if (each.playState !== 'running') return true;
            if (each.effect?.getTiming().iterations === Infinity) return true;
            const target = (each.effect as KeyframeEffect | null)?.target;
            return !target || !(target.contains(at) || at.contains(target));
          }),
        element as unknown as HTMLElement,
      ),
    { timeout: 5000, timeoutMsg: 'it never stopped moving' },
  );
}

/**
 * Press, travel in steps (drags start after a few pixels), let go. Task rows read sideways travel
 * as indent, so the pointer keeps its column unless `across` aims it at the target's middle.
 */
async function drag(
  from: WebdriverIO.Element,
  to: WebdriverIO.Element,
  offset: { y?: number; across?: boolean } = {},
) {
  // Where they are once they stand still, not halfway through a move.
  await settled(from);
  await settled(to);
  const start = await from.getLocation();
  const size = await from.getSize();
  const end = await to.getLocation();
  const endSize = await to.getSize();
  const x0 = Math.round(start.x + Math.min(40, size.width / 2));
  const y0 = Math.round(start.y + size.height / 2);
  const x1 = offset.across ? Math.round(end.x + endSize.width / 2) : x0;
  const y1 = Math.round(end.y + endSize.height / 2 + (offset.y ?? 0));
  const steps = 8;
  const pointer = browser
    .action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ x: x0, y: y0 })
    .down();
  for (let i = 1; i <= steps; i += 1) {
    pointer.move({
      x: Math.round(x0 + ((x1 - x0) * i) / steps),
      y: Math.round(y0 + ((y1 - y0) * i) / steps),
      duration: 40,
    });
  }
  await pointer.pause(100).up().perform();
}

const row = (title: string) => $(`//*[@aria-label='Open ${title}']/ancestor::*[@data-drag-row][1]`);

async function rowTitles(): Promise<string[]> {
  const rows = await $$('[data-drag-row]');
  const titles: string[] = [];
  for (const each of rows) {
    const label = await each.$("[aria-label^='Open ']").getAttribute('aria-label');
    titles.push(
      `${'  '.repeat(Number(await each.getAttribute('data-depth')))}${(label ?? '').replace(/^Open /, '')}`,
    );
  }
  return titles;
}

describe('dragging tasks', () => {
  it('reorders a list and nests a task by dropping it onto another', async () => {
    await browser.url('/inbox');
    await addTasks(['Wash', 'Dry', 'Fold']);
    // The list's own order: no grouping.
    await $("//button[@aria-label='View options']").click();
    // A click while the menu still grows picks Tag, or a heading: then the list stays grouped,
    // Fold still reorders within its group, and Dry is never nested.
    const none = await $("//*[@role='menuitem'][normalize-space()='None']");
    await none.waitForDisplayed();
    await settled(none);
    await none.click();
    // The menu's backdrop takes pointer presses until it has faded out.
    await $("//*[@role='menu']").waitForExist({ reverse: true });
    // The list's own order: its rows are one zone for the list, not groups.
    await expect($('[data-drag-zone][data-list]')).toBeDisplayed();
    await expect(row('Fold')).toBeDisplayed();

    // Fold to the top: drop on the upper edge of the first row.
    const first = await $$('[data-drag-row]')[0]!;
    await drag(await row('Fold'), first, { y: -(await first.getSize()).height / 2 + 2 });
    await browser.waitUntil(async () => (await rowTitles())[0] === 'Fold', {
      timeout: 5000,
      timeoutMsg: `Fold never reached the top: ${JSON.stringify(await rowTitles())}`,
    });

    // Dry onto the middle of Wash: Dry becomes Wash's subtask.
    await drag(await row('Dry'), await row('Wash'));
    await browser.waitUntil(async () => (await rowTitles()).includes('  Dry'), {
      timeout: 5000,
      timeoutMsg: `Dry never nested: ${JSON.stringify(await rowTitles())}`,
    });
    await expect(await rowTitles()).toEqual(['Fold', 'Wash', '  Dry']);
  });
});

describe('dragging on the calendar', () => {
  it('drags a task in, moves it to a time, and resizes it', async () => {
    await browser.url('/inbox');
    await addTasks(['Calendar probe']);
    await browser.url('/calendar');
    // Unscheduled is hidden at first; its toggle sits in the calendar's row.
    await $("button[aria-label='Unscheduled']").click();
    const waiting = $(
      "//*[@role='list'][@aria-label='Unscheduled']//*[@data-task-id][normalize-space()='Calendar probe']",
    );
    await expect(waiting).toBeDisplayed();

    // Onto today in the month view.
    const today = await $("[role='gridcell'][aria-label='Today']");
    const date = await today.getAttribute('data-cal-day');
    await drag(await waiting, today, { across: true });
    await expect(
      $(`[data-cal-day='${date}'] [data-cal-item][title='Calendar probe']`),
    ).toBeDisplayed();

    // In the Days view, from the all-day row onto 10:00.
    await $("//button[normalize-space()='Days']").click();
    const allDay = await $(`[data-cal-day='${date}'] [data-cal-item][title='Calendar probe']`);
    await expect(allDay).toBeDisplayed();
    const column = await $(`[data-cal-slots='${date}']`);
    const hour = Number(await column.getAttribute('data-hour-height'));
    // Bring 9:00 to the top of the grid, so 10:00 is in sight whatever the time now.
    await browser.execute((h) => {
      const body = document.querySelector<HTMLElement>('[data-cal-body]');
      if (body) body.scrollTop = 9 * h;
    }, hour);
    await browser.pause(200);
    const start = await allDay.getLocation();
    const size = await allDay.getSize();
    const columnBox = await column.getLocation();
    const columnSize = await column.getSize();
    const tenY = Math.round(columnBox.y + 10 * hour + 4);
    await browser
      .action('pointer', { parameters: { pointerType: 'mouse' } })
      .move({ x: Math.round(start.x + size.width / 2), y: Math.round(start.y + size.height / 2) })
      .down()
      .move({
        x: Math.round(start.x + size.width / 2),
        y: Math.round(start.y + size.height / 2 + 10),
        duration: 50,
      })
      .move({ x: Math.round(columnBox.x + columnSize.width / 2), y: tenY, duration: 250 })
      .pause(100)
      .up()
      .perform();
    const timed = $(`[data-cal-slots='${date}'] [data-cal-item]`);
    await browser.waitUntil(
      async () =>
        (await timed.isExisting()) && /10:00/.test((await timed.getAttribute('aria-label')) ?? ''),
      { timeout: 5000 },
    );

    // Pull its bottom edge down an hour: a longer block.
    const box = await timed.getLocation();
    const height = (await timed.getSize()).height;
    await browser
      .action('pointer', { parameters: { pointerType: 'mouse' } })
      .move({ x: Math.round(box.x + 20), y: Math.round(box.y + height - 2) })
      .down()
      .move({ x: Math.round(box.x + 20), y: Math.round(box.y + height + hour / 2), duration: 100 })
      .move({ x: Math.round(box.x + 20), y: Math.round(box.y + height + hour), duration: 100 })
      .pause(100)
      .up()
      .perform();
    await browser.waitUntil(async () => (await timed.getSize()).height > height + hour / 2, {
      timeout: 5000,
    });
  });
});
